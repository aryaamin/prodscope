/**
 * AI Code Intelligence — developer-level analysis tied to specific code locations.
 *
 * Unlike ai-analysis.ts (manager-level dashboards), this service answers:
 *  - "I'm editing this function. What should I know?" (pre-edit briefing)
 *  - "This function keeps failing. What's the actual fix?" (fix suggestions with real user context)
 *  - "I just deployed a fix. Did it work?" (verify-fix with before/after data)
 *  - "What should I work on next?" (developer priority queue ranked by fixability * impact)
 *  - "Users report X. Which code is responsible?" (symptom → code tracing)
 */

import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env.js";
import { getClickHouse } from "../db/clickhouse.js";
import { getPostgres } from "../db/postgres.js";

let anthropic: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (!env.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: env.anthropicApiKey });
  }
  return anthropic;
}

// ─── Data Gathering (function-scoped, not project-wide) ────────────────

async function getFunctionDetail(projectId: string, file: string, fn?: string) {
  const ch = getClickHouse();

  const params: Record<string, string> = { projectId, file };
  const fnFilter = fn ? " AND function = {fn:String}" : "";
  if (fn) params.fn = fn;

  // Recent raw errors with full stacks (not rollups — devs need the actual error)
  const errorsResult = await ch.query({
    query: `
      SELECT message, type, stack, resolved_stack, line, column, function,
             user_agent, session_id, git_sha, timestamp
      FROM errors
      WHERE project_id = {projectId:String} AND file = {file:String}
        ${fnFilter}
      ORDER BY timestamp DESC
      LIMIT 25
    `,
    query_params: params,
    format: "JSONEachRow",
  });
  const errors = await errorsResult.json();

  // Function stats across all windows for context
  const statsResult = await ch.query({
    query: `
      SELECT function, window, call_count, avg_ms, p50_ms, p99_ms,
             error_count, error_rate, unique_sessions, session_reach_pct
      FROM function_stats FINAL
      WHERE project_id = {projectId:String} AND file = {file:String}
        ${fnFilter}
      ORDER BY window, function
    `,
    query_params: params,
    format: "JSONEachRow",
  });
  const stats = await statsResult.json();

  // DB queries triggered from this file
  const queriesResult = await ch.query({
    query: `
      SELECT table_name, operation, statement, duration_ms, row_count, line, timestamp
      FROM db_queries
      WHERE project_id = {projectId:String} AND file = {file:String}
      ORDER BY duration_ms DESC
      LIMIT 15
    `,
    query_params: params,
    format: "JSONEachRow",
  });
  const queries = await queriesResult.json();

  // Trend (last 7 days)
  const trendResult = await ch.query({
    query: `
      SELECT date, sum(call_count) AS calls, avg(avg_ms) AS avg_ms,
             sum(error_count) AS errors,
             if(sum(call_count) > 0, sum(error_count)/sum(call_count), 0) AS error_rate,
             avg(session_reach_pct) AS reach
      FROM daily_snapshots FINAL
      WHERE project_id = {projectId:String} AND file = {file:String}
        AND hour_bucket = 0 AND date >= today() - 7
        ${fnFilter}
      GROUP BY date
      ORDER BY date
    `,
    query_params: params,
    format: "JSONEachRow",
  });
  const trend = await trendResult.json();

  // What user agents / sessions are hitting this
  const sessionResult = await ch.query({
    query: `
      SELECT
        user_agent,
        count() AS hit_count,
        uniqExact(session_id) AS unique_sessions,
        avg(duration_ms) AS avg_ms,
        countIf(status = 'error') AS errors
      FROM spans
      WHERE project_id = {projectId:String} AND file = {file:String}
        AND start_time >= now() - toIntervalDay(1)
        ${fnFilter}
        AND user_agent != ''
      GROUP BY user_agent
      ORDER BY hit_count DESC
      LIMIT 10
    `,
    query_params: params,
    format: "JSONEachRow",
  });
  const sessions = await sessionResult.json();

  return { errors, stats, queries, trend, sessions };
}

async function getDeployComparison(projectId: string, file: string, fn: string | undefined, sha1: string, sha2: string) {
  const ch = getClickHouse();

  const params: Record<string, string> = { projectId, file, sha1, sha2 };
  const fnFilter = fn ? " AND function = {fn:String}" : "";
  if (fn) params.fn = fn;

  const result = await ch.query({
    query: `
      SELECT
        git_sha,
        count() AS call_count,
        avg(duration_ms) AS avg_ms,
        quantile(0.5)(duration_ms) AS p50_ms,
        quantile(0.99)(duration_ms) AS p99_ms,
        countIf(status = 'error') AS error_count,
        if(count() > 0, countIf(status = 'error') / count(), 0) AS error_rate,
        uniqExact(session_id) AS unique_sessions
      FROM spans
      WHERE project_id = {projectId:String} AND file = {file:String}
        AND git_sha IN ({sha1:String}, {sha2:String})
        ${fnFilter}
      GROUP BY git_sha
    `,
    query_params: params,
    format: "JSONEachRow",
  });
  return result.json();
}

async function getWorstFunctions(projectId: string) {
  const ch = getClickHouse();

  // Rank functions by impact score: error_rate * session_reach * call_count
  const result = await ch.query({
    query: `
      SELECT
        function, file, line,
        call_count, avg_ms, p50_ms, p99_ms,
        error_count, error_rate,
        unique_sessions, session_reach_pct,
        (error_rate * session_reach_pct * log2(call_count + 1)) AS impact_score
      FROM function_stats FINAL
      WHERE project_id = {projectId:String} AND window = '24h'
        AND error_count > 0
      ORDER BY impact_score DESC
      LIMIT 20
    `,
    query_params: { projectId },
    format: "JSONEachRow",
  });
  return result.json();
}

async function traceSymptomToCode(projectId: string, symptom: string) {
  const ch = getClickHouse();

  // Search errors matching the symptom description
  const errorResult = await ch.query({
    query: `
      SELECT message, type, file, function, line, stack, resolved_stack,
             count() AS occurrences, uniqExact(session_id) AS affected_sessions,
             max(timestamp) AS last_seen
      FROM errors
      WHERE project_id = {projectId:String}
        AND (positionCaseInsensitive(message, {symptom:String}) > 0
             OR positionCaseInsensitive(type, {symptom:String}) > 0
             OR positionCaseInsensitive(stack, {symptom:String}) > 0)
        AND timestamp >= now() - toIntervalDay(7)
      GROUP BY message, type, file, function, line, stack, resolved_stack
      ORDER BY occurrences DESC
      LIMIT 10
    `,
    query_params: { projectId, symptom },
    format: "JSONEachRow",
  });
  const matchingErrors = await errorResult.json();

  // Also search spans for related function names or attributes
  const spanResult = await ch.query({
    query: `
      SELECT function, file, line, name,
             count() AS call_count,
             avg(duration_ms) AS avg_ms,
             countIf(status = 'error') AS error_count,
             uniqExact(session_id) AS sessions
      FROM spans
      WHERE project_id = {projectId:String}
        AND (positionCaseInsensitive(function, {symptom:String}) > 0
             OR positionCaseInsensitive(name, {symptom:String}) > 0)
        AND start_time >= now() - toIntervalDay(7)
      GROUP BY function, file, line, name
      ORDER BY error_count DESC, call_count DESC
      LIMIT 10
    `,
    query_params: { projectId, symptom },
    format: "JSONEachRow",
  });
  const matchingSpans = await spanResult.json();

  // Slow queries that might relate
  const queryResult = await ch.query({
    query: `
      SELECT table_name, operation, file, line, statement,
             avg(duration_ms) AS avg_ms, max(duration_ms) AS max_ms, count() AS call_count
      FROM db_queries
      WHERE project_id = {projectId:String}
        AND (positionCaseInsensitive(statement, {symptom:String}) > 0
             OR positionCaseInsensitive(table_name, {symptom:String}) > 0)
        AND timestamp >= now() - toIntervalDay(7)
      GROUP BY table_name, operation, file, line, statement
      ORDER BY avg_ms DESC
      LIMIT 10
    `,
    query_params: { projectId, symptom },
    format: "JSONEachRow",
  });
  const matchingQueries = await queryResult.json();

  return { matchingErrors, matchingSpans, matchingQueries };
}

// ─── Analysis Types ────────────────────────────────────────────────────

export type CodeIntelType =
  | "pre_edit_briefing"
  | "suggest_fix"
  | "verify_fix"
  | "dev_priority_queue"
  | "trace_symptom";

interface CodeIntelRequest {
  projectId: string;
  type: CodeIntelType;
  file?: string;
  function?: string;
  // For verify_fix
  beforeSha?: string;
  afterSha?: string;
  // For trace_symptom
  symptom?: string;
}

export async function runCodeIntel(req: CodeIntelRequest): Promise<{ type: CodeIntelType; result: string }> {
  const client = getAnthropic();

  let dataContext = "";
  let prompt = "";

  switch (req.type) {
    case "pre_edit_briefing": {
      if (!req.file) throw new Error("file is required for pre_edit_briefing");
      const data = await getFunctionDetail(req.projectId, req.file, req.function);
      dataContext = JSON.stringify(data, null, 2);

      prompt = `You are a senior developer's assistant. A developer is about to edit ${req.file}${req.function ? ` (function: ${req.function})` : ""}. Brief them on what they need to know from production.

Production data:
${dataContext}

Write a concise briefing covering:

1. **Current state**: Is this code healthy or on fire? Call volume, latency, error rate — one line.
2. **Who uses this**: What user agents / platforms are hitting it? How many unique sessions?
3. **Known issues**: List every distinct error happening here. For each: the actual error message, how often, which line, which user segments are affected. Include stack trace excerpts if available.
4. **Performance concerns**: Any slow DB queries triggered from this code? Latency trending up or down?
5. **Trend context**: Is this getting better or worse over the past week?
6. **Danger zones**: Specific lines or code paths the developer should be careful with (based on where errors cluster).

Be SPECIFIC. Reference line numbers, exact error messages, actual latency numbers. This should read like a handoff note from the previous on-call engineer. No generic advice — only things backed by the data.

If there are no issues, say "This code is clean — no production issues detected." Don't pad.`;
      break;
    }

    case "suggest_fix": {
      if (!req.file) throw new Error("file is required for suggest_fix");
      const data = await getFunctionDetail(req.projectId, req.file, req.function);
      dataContext = JSON.stringify(data, null, 2);

      prompt = `You are a senior developer analyzing production errors to suggest specific code fixes.

File: ${req.file}${req.function ? ` | Function: ${req.function}` : ""}

Production data (real errors with stacks, performance stats, DB queries, user context):
${dataContext}

For each distinct error pattern you find:

1. **Error**: The exact error message and type
2. **Where**: File:line where it happens
3. **Frequency**: How often, trend direction, % of users affected
4. **Root cause analysis**: Based on the stack trace and context, what's actually going wrong? Consider:
   - Is it a null/undefined access? What's null and why?
   - Is it a timing issue? (race condition, async ordering)
   - Is it input-dependent? (certain user agents, certain request patterns)
   - Is it a DB issue? (query timeouts, missing data, constraint violations)
5. **Suggested fix**: Actual pseudocode or code pattern to fix it. Be specific — don't say "add error handling", say exactly what to check and where.
6. **How to verify**: What metric should change after the fix is deployed?

Also check for performance fixes:
- DB queries that could use an index or be batched
- Functions with high p99 that suggest an intermittent slow path
- N+1 query patterns visible in the data

Rank issues by (frequency * user_impact). Only suggest fixes you're confident about based on the evidence.`;
      break;
    }

    case "verify_fix": {
      if (!req.file) throw new Error("file is required for verify_fix");
      if (!req.beforeSha || !req.afterSha) throw new Error("beforeSha and afterSha are required for verify_fix");

      const [detail, comparison] = await Promise.all([
        getFunctionDetail(req.projectId, req.file, req.function),
        getDeployComparison(req.projectId, req.file, req.function, req.beforeSha, req.afterSha),
      ]);
      dataContext = JSON.stringify({ currentState: detail, deployComparison: comparison }, null, 2);

      prompt = `You are verifying whether a code fix actually worked in production.

File: ${req.file}${req.function ? ` | Function: ${req.function}` : ""}
Before deploy: ${req.beforeSha}
After deploy: ${req.afterSha}

Production data:
${dataContext}

Analyze the before/after comparison and current state:

1. **Verdict**: Did the fix work? (YES / PARTIALLY / NO / NOT ENOUGH DATA)
2. **Error rate change**: Specific numbers — before vs after
3. **Latency impact**: Did the fix help, hurt, or not affect performance?
4. **Session impact**: Are fewer users hitting the error now?
5. **Remaining issues**: Any errors still happening? New errors introduced?
6. **Recommendation**: Keep, revert, or iterate?

Use actual numbers. If there's not enough data in the after-deploy SHA (too recent), say so and estimate how long to wait.`;
      break;
    }

    case "dev_priority_queue": {
      const worstFunctions = await getWorstFunctions(req.projectId);
      // Get error details for the top 5
      const topFiles = [...new Set((worstFunctions as any[]).slice(0, 5).map((f: any) => f.file))];
      const details: Record<string, any> = {};
      for (const file of topFiles) {
        details[file] = await getFunctionDetail(req.projectId, file);
      }
      dataContext = JSON.stringify({ ranked: worstFunctions, details }, null, 2);

      prompt = `You are a tech lead helping a developer decide what to work on next based on production data.

Ranked functions (sorted by impact_score = error_rate * session_reach * log2(calls)):
${dataContext}

Create a developer priority queue — a numbered list of the most impactful things to fix, ordered by "if I fix this one thing, how many users benefit and how much?"

For each item:

1. **Title**: One line — what to fix (e.g., "Fix null pointer in createOrder when address is empty")
2. **Location**: file:line:function
3. **Impact**: X users affected, Y errors/day, Z% of total traffic
4. **Difficulty estimate**: Easy (null check, validation) / Medium (logic fix, query optimization) / Hard (architectural, race condition)
5. **What to do**: Specific action — not "investigate", but "add null check for req.body.address before line 42" based on the error evidence
6. **Expected result**: "Error rate on createOrder should drop from 3.2% to ~0%, saving ~150 users/day from hitting the error"

Maximum 10 items. Skip functions where the fix isn't clear from the data. Rank by (impact * inverse_difficulty) — easy high-impact fixes first.`;
      break;
    }

    case "trace_symptom": {
      if (!req.symptom) throw new Error("symptom is required for trace_symptom");
      const data = await traceSymptomToCode(req.projectId, req.symptom);
      dataContext = JSON.stringify(data, null, 2);

      prompt = `You are a developer tracing a user-reported symptom back to the responsible code.

User-reported symptom: "${req.symptom}"

Search results from production data (errors, spans, and queries matching the symptom):
${dataContext}

Trace this symptom to its source:

1. **Most likely cause**: Which function/file/line is responsible? Why do you think so?
2. **Evidence chain**: User reports "${req.symptom}" → this hits endpoint X → which calls function Y → which fails at line Z because...
3. **Error details**: The actual error message and stack trace from production
4. **Affected users**: How many, which platforms/browsers, how often
5. **Related code paths**: Other functions that might be involved (upstream callers, downstream dependencies)
6. **Suggested investigation**: Where should the developer look first? What to log/check?

If the symptom doesn't match any production data, say so — it might be a client-side-only issue, or the telemetry might not cover that code path.`;
      break;
    }
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const result =
    response.content[0].type === "text" ? response.content[0].text : "";

  return { type: req.type, result };
}
