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

interface FileContext {
  projectId: string;
  file: string;
  functionName?: string;
}

async function gatherContext(ctx: FileContext) {
  const ch = getClickHouse();

  const statsResult = await ch.query({
    query: `
      SELECT function, window, call_count, avg_ms, p99_ms, error_rate
      FROM function_stats
      WHERE project_id = {projectId:String}
        AND file = {file:String}
        ${ctx.functionName ? "AND function = {fn:String}" : ""}
      ORDER BY window, function
    `,
    query_params: {
      projectId: ctx.projectId,
      file: ctx.file,
      ...(ctx.functionName ? { fn: ctx.functionName } : {}),
    },
    format: "JSONEachRow",
  });
  const stats = await statsResult.json();

  const errorsResult = await ch.query({
    query: `
      SELECT message, type, line, function, count() as occurrences,
             max(timestamp) as last_seen
      FROM errors
      WHERE project_id = {projectId:String}
        AND file = {file:String}
        AND timestamp >= now() - INTERVAL 24 HOUR
      GROUP BY message, type, line, function
      ORDER BY occurrences DESC
      LIMIT 20
    `,
    query_params: {
      projectId: ctx.projectId,
      file: ctx.file,
    },
    format: "JSONEachRow",
  });
  const errors = await errorsResult.json();

  const slowQueriesResult = await ch.query({
    query: `
      SELECT table_name, operation, avg(duration_ms) as avg_ms,
             quantile(0.99)(duration_ms) as p99_ms, count() as call_count
      FROM db_queries
      WHERE project_id = {projectId:String}
        AND file = {file:String}
        AND timestamp >= now() - INTERVAL 24 HOUR
      GROUP BY table_name, operation
      ORDER BY avg_ms DESC
      LIMIT 10
    `,
    query_params: {
      projectId: ctx.projectId,
      file: ctx.file,
    },
    format: "JSONEachRow",
  });
  const slowQueries = await slowQueriesResult.json();

  return { stats, errors, slowQueries };
}

export async function generateInsight(ctx: FileContext): Promise<string> {
  const data = await gatherContext(ctx);
  const client = getAnthropic();

  const prompt = `You are a developer observability assistant. Analyze the following production telemetry data for the file "${ctx.file}"${ctx.functionName ? ` (function: ${ctx.functionName})` : ""} and provide a concise, actionable insight.

Function stats (across time windows):
${JSON.stringify(data.stats, null, 2)}

Recent errors (last 24h):
${JSON.stringify(data.errors, null, 2)}

Database query performance:
${JSON.stringify(data.slowQueries, null, 2)}

Provide:
1. A brief summary of what's happening in this code in production
2. Any performance concerns (latency, error rates)
3. Who is affected (if determinable from user agents or session patterns)
4. Specific, actionable suggestions for improvement

Keep it under 200 words. Be direct and specific.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const insight =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Store the insight
  const db = getPostgres();
  await db.query(
    `INSERT INTO ai_insights (project_id, file, function, insight, generated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (project_id, file, function) DO UPDATE SET
       insight = EXCLUDED.insight, generated_at = EXCLUDED.generated_at`,
    [ctx.projectId, ctx.file, ctx.functionName ?? "", insight],
  );

  return insight;
}
