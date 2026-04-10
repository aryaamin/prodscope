/**
 * AI Analysis Engine — deep production intelligence beyond simple insights.
 *
 * Capabilities:
 *  - Anomaly detection: spots deviations from historical baselines
 *  - Root cause analysis: when something breaks, correlates across functions/errors/queries
 *  - Pattern recognition: finds recurring behaviors (time-of-day, weekday/weekend, deploy-driven)
 *  - Issue detection: proactively surfaces real problems ranked by user impact
 *  - Weekly digest: comprehensive summary of what changed, regressed, or improved
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

// ─── Data Gathering ────────────────────────────────────────────────────

async function getBaselineVsCurrent(projectId: string) {
  const ch = getClickHouse();

  // Current 24h vs previous 24h
  const result = await ch.query({
    query: `
      SELECT
        function, file,
        sumIf(call_count, date = today()) AS today_calls,
        sumIf(call_count, date = today() - 1) AS yesterday_calls,
        avgIf(avg_ms, date = today()) AS today_avg_ms,
        avgIf(avg_ms, date = today() - 1) AS yesterday_avg_ms,
        avgIf(p99_ms, date = today()) AS today_p99_ms,
        avgIf(p99_ms, date = today() - 1) AS yesterday_p99_ms,
        sumIf(error_count, date = today()) AS today_errors,
        sumIf(error_count, date = today() - 1) AS yesterday_errors,
        avgIf(error_rate, date = today()) AS today_error_rate,
        avgIf(error_rate, date = today() - 1) AS yesterday_error_rate
      FROM daily_snapshots FINAL
      WHERE project_id = {projectId:String}
        AND hour_bucket = 0
        AND date >= today() - 1
      GROUP BY function, file
      HAVING today_calls > 0 OR yesterday_calls > 0
      ORDER BY today_calls DESC
      LIMIT 50
    `,
    query_params: { projectId },
    format: "JSONEachRow",
  });
  return result.json();
}

async function getWeekOverWeekTrends(projectId: string) {
  const ch = getClickHouse();

  const result = await ch.query({
    query: `
      SELECT
        function, file,
        sumIf(call_count, date >= today() - 7 AND date < today()) AS this_week_calls,
        sumIf(call_count, date >= today() - 14 AND date < today() - 7) AS last_week_calls,
        avgIf(avg_ms, date >= today() - 7 AND date < today()) AS this_week_avg_ms,
        avgIf(avg_ms, date >= today() - 14 AND date < today() - 7) AS last_week_avg_ms,
        sumIf(error_count, date >= today() - 7 AND date < today()) AS this_week_errors,
        sumIf(error_count, date >= today() - 14 AND date < today() - 7) AS last_week_errors,
        avgIf(session_reach_pct, date >= today() - 7 AND date < today()) AS this_week_reach,
        avgIf(session_reach_pct, date >= today() - 14 AND date < today() - 7) AS last_week_reach
      FROM daily_snapshots FINAL
      WHERE project_id = {projectId:String}
        AND hour_bucket = 0
        AND date >= today() - 14
      GROUP BY function, file
      HAVING this_week_calls > 0 OR last_week_calls > 0
      ORDER BY this_week_calls DESC
      LIMIT 50
    `,
    query_params: { projectId },
    format: "JSONEachRow",
  });
  return result.json();
}

async function getHourlyPatterns(projectId: string) {
  const ch = getClickHouse();

  const result = await ch.query({
    query: `
      SELECT
        hour_bucket AS hour,
        toDayOfWeek(date) AS dow,
        sum(call_count) AS call_count,
        avg(avg_ms) AS avg_ms,
        sum(error_count) AS error_count,
        if(sum(call_count) > 0, sum(error_count) / sum(call_count), 0) AS error_rate
      FROM daily_snapshots FINAL
      WHERE project_id = {projectId:String}
        AND hour_bucket > 0
        AND date >= today() - 7
      GROUP BY hour, dow
      ORDER BY dow, hour
    `,
    query_params: { projectId },
    format: "JSONEachRow",
  });
  return result.json();
}

async function getRecentErrorSpikes(projectId: string) {
  const ch = getClickHouse();

  const result = await ch.query({
    query: `
      SELECT
        error_type,
        message,
        file,
        function,
        sumIf(count, date = today()) AS today_count,
        sumIf(count, date = today() - 1) AS yesterday_count,
        sumIf(count, date >= today() - 7) AS week_count,
        sumIf(unique_sessions, date = today()) AS today_sessions,
        max(last_seen) AS last_seen
      FROM error_daily_rollups FINAL
      WHERE project_id = {projectId:String}
        AND date >= today() - 7
      GROUP BY error_type, message, file, function
      HAVING today_count > 0
      ORDER BY today_count DESC
      LIMIT 30
    `,
    query_params: { projectId },
    format: "JSONEachRow",
  });
  return result.json();
}

async function getQueryPerformanceTrends(projectId: string) {
  const ch = getClickHouse();

  const result = await ch.query({
    query: `
      SELECT
        table_name,
        operation,
        file,
        avgIf(avg_ms, date >= today() - 7 AND date < today()) AS this_week_avg_ms,
        avgIf(avg_ms, date >= today() - 14 AND date < today() - 7) AS last_week_avg_ms,
        avgIf(p99_ms, date >= today() - 7 AND date < today()) AS this_week_p99_ms,
        avgIf(p99_ms, date >= today() - 14 AND date < today() - 7) AS last_week_p99_ms,
        sumIf(call_count, date >= today() - 7 AND date < today()) AS this_week_calls,
        maxIf(max_ms, date >= today() - 7) AS worst_ms
      FROM query_daily_rollups FINAL
      WHERE project_id = {projectId:String}
        AND date >= today() - 14
      GROUP BY table_name, operation, file
      HAVING this_week_calls > 0
      ORDER BY this_week_avg_ms DESC
      LIMIT 20
    `,
    query_params: { projectId },
    format: "JSONEachRow",
  });
  return result.json();
}

async function getDeployImpact(projectId: string) {
  const ch = getClickHouse();

  const result = await ch.query({
    query: `
      SELECT
        git_sha,
        min(start_time) AS first_seen,
        max(start_time) AS last_seen,
        count() AS total_spans,
        countIf(status = 'error') AS error_count,
        if(count() > 0, countIf(status = 'error') / count(), 0) AS error_rate,
        avg(duration_ms) AS avg_ms,
        quantile(0.99)(duration_ms) AS p99_ms
      FROM spans
      WHERE project_id = {projectId:String}
        AND start_time >= now() - toIntervalDay(7)
        AND git_sha != ''
      GROUP BY git_sha
      ORDER BY first_seen DESC
      LIMIT 10
    `,
    query_params: { projectId },
    format: "JSONEachRow",
  });
  return result.json();
}

// ─── Analysis Types ────────────────────────────────────────────────────

export type AnalysisType =
  | "anomalies"
  | "root_cause"
  | "patterns"
  | "issues"
  | "weekly_digest";

interface AnalysisRequest {
  projectId: string;
  type: AnalysisType;
  file?: string;
  function?: string;
}

interface AnalysisResult {
  type: AnalysisType;
  analysis: string;
  generatedAt: string;
  dataPoints: number;
}

export async function runAnalysis(req: AnalysisRequest): Promise<AnalysisResult> {
  const client = getAnthropic();

  // Gather all relevant data in parallel
  const [baseline, weekTrends, hourly, errorSpikes, queryTrends, deploys] =
    await Promise.all([
      getBaselineVsCurrent(req.projectId),
      getWeekOverWeekTrends(req.projectId),
      getHourlyPatterns(req.projectId),
      getRecentErrorSpikes(req.projectId),
      getQueryPerformanceTrends(req.projectId),
      getDeployImpact(req.projectId),
    ]);

  const dataPoints =
    (baseline as any[]).length +
    (weekTrends as any[]).length +
    (hourly as any[]).length +
    (errorSpikes as any[]).length +
    (queryTrends as any[]).length +
    (deploys as any[]).length;

  const dataContext = `
## Today vs Yesterday (function-level baselines)
${JSON.stringify(baseline, null, 2)}

## This Week vs Last Week
${JSON.stringify(weekTrends, null, 2)}

## Hourly Traffic Patterns (last 7 days, by day-of-week and hour)
${JSON.stringify(hourly, null, 2)}

## Error Spikes (today vs yesterday vs weekly totals)
${JSON.stringify(errorSpikes, null, 2)}

## Database Query Performance Trends (week-over-week)
${JSON.stringify(queryTrends, null, 2)}

## Recent Deploys and Their Impact
${JSON.stringify(deploys, null, 2)}
`;

  const prompts: Record<AnalysisType, string> = {
    anomalies: `You are a production observability expert analyzing telemetry data for anomaly detection.

${dataContext}

Analyze this data and find ANOMALIES — things that deviate significantly from their baseline:

1. **Latency anomalies**: Functions where avg or p99 latency increased >30% vs yesterday or last week
2. **Error rate anomalies**: Functions where error rate spiked vs baseline
3. **Traffic anomalies**: Unexpected increases or drops in call volume
4. **Session impact anomalies**: Changes in how many users are affected
5. **Query anomalies**: DB queries that degraded significantly

For each anomaly found:
- State what changed and by how much (use numbers)
- When it likely started (correlate with deploys if possible)
- Severity: critical (user-facing degradation), warning (trending bad), or info (notable but not urgent)
- Which file:function is affected

If there are no significant anomalies, say so — don't invent problems. Be precise with numbers.`,

    root_cause: `You are a production observability expert performing root cause analysis.

${dataContext}

Look at all the data holistically and find ROOT CAUSES — not just symptoms:

1. **Correlation analysis**: If function A slowed down at the same time function B started erroring, are they related? Look at the timeline.
2. **Deploy correlation**: Did a recent deploy (git SHA) coincide with degradation? Compare error rates and latency before/after.
3. **Cascade detection**: Is a slow DB query causing a downstream function to timeout? Is one error propagating through multiple functions?
4. **Resource contention**: Are multiple functions hitting the same table with degraded performance?

For each root cause identified:
- The probable cause (deploy X, query Y degraded, etc.)
- The chain of effects (A caused B which caused C)
- Evidence (specific numbers from the data)
- Recommended fix

Be specific. Reference actual function names, files, error messages, and git SHAs from the data.`,

    patterns: `You are a production observability expert analyzing behavioral patterns.

${dataContext}

Find PATTERNS in how this application behaves:

1. **Time-of-day patterns**: Is there a rush hour? Do errors cluster at certain times? Is latency worse in mornings?
2. **Day-of-week patterns**: Weekday vs weekend differences in traffic, errors, latency
3. **Cyclical patterns**: Any recurring spikes (e.g., every Monday, every end-of-hour)?
4. **Growth/decline trends**: Is traffic growing or shrinking week-over-week? Are error rates trending up?
5. **User behavior patterns**: Do session reach numbers change by time/day? Are certain functions only hit during peak hours?

For each pattern:
- Describe the pattern clearly with numbers
- Explain why it matters for operations
- Suggest whether it's expected (normal business cycle) or concerning

Include patterns that are ABSENT too — e.g., "weekday/weekend traffic is nearly identical, suggesting non-consumer traffic."`,

    issues: `You are a production observability expert proactively identifying issues.

${dataContext}

Find REAL ISSUES that need attention, ranked by user impact. Don't surface noise — only actionable problems.

For each issue, provide:
- **Title**: One-line description
- **Severity**: critical / high / medium / low
- **Impact**: How many users affected, what they experience
- **Evidence**: Specific numbers from the data
- **Recommendation**: What to do about it

Categories to check:
1. **Active incidents**: Error spikes, latency blowups happening right now
2. **Slow degradation**: Things getting worse week-over-week that haven't triggered alerts yet
3. **Silent failures**: High error rates on functions that don't get much attention
4. **Performance debt**: DB queries getting slower, functions accumulating latency
5. **Reliability risks**: Functions with growing session reach but also growing error rates

Rank by: (error_rate * session_reach * call_count) — prioritize things that affect many users frequently.
Only include issues where you have concrete evidence. If there are no issues, say so.`,

    weekly_digest: `You are a production observability expert writing a weekly digest for the engineering team.

${dataContext}

Write a comprehensive weekly digest covering:

## Health Summary
Overall system health — is it better, worse, or stable vs last week? One paragraph.

## Key Metrics (This Week vs Last Week)
- Total traffic trend (growing/stable/shrinking)
- Overall error rate change
- Latency trends (improving/degrading)

## What Improved
Functions or queries that got better (lower latency, fewer errors). Credit deploys if applicable.

## What Regressed
Functions or queries that got worse. Identify when it started and possible causes.

## Notable Patterns
Any interesting behavioral patterns discovered (time-of-day, weekday/weekend, deploy-driven changes).

## Top Issues to Address
Ranked list of the most important things to fix, with evidence and impact.

## Deploy Impact
For each recent deploy, was it positive, negative, or neutral?

Use real numbers throughout. Be concise but thorough. This digest should give a team a complete picture of their production health in 2 minutes of reading.`,
  };

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompts[req.type] }],
  });

  const analysis =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Cache the result
  const db = getPostgres();
  await db.query(
    `INSERT INTO ai_analyses (project_id, type, analysis, data_points, generated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (project_id, type) DO UPDATE SET
       analysis = EXCLUDED.analysis, data_points = EXCLUDED.data_points,
       generated_at = EXCLUDED.generated_at`,
    [req.projectId, req.type, analysis, dataPoints],
  );

  return {
    type: req.type,
    analysis,
    generatedAt: new Date().toISOString(),
    dataPoints,
  };
}

