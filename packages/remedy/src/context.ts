import { getClickHouse } from "./db/clickhouse.js";
import { getPostgres } from "./db/postgres.js";
import type { ErrorSignature } from "./types.js";

export interface TelemetryContext {
  signature: ErrorSignature;
  recentErrors: Array<{
    message: string;
    stack: string;
    line: number;
    count: number;
    last_seen: string;
  }>;
  functionStats: Array<{
    window: string;
    call_count: number;
    avg_ms: number;
    p99_ms: number;
    error_rate: number;
  }>;
  slowQueries: Array<{
    table_name: string;
    operation: string;
    avg_ms: number;
    p99_ms: number;
    call_count: number;
  }>;
  existingInsight: string;
}

/**
 * Gathers all the telemetry the agent will need to understand the problem,
 * so the prompt can be self-contained (no agent tool calls back to ClickHouse).
 */
export async function gatherTelemetryContext(
  sig: ErrorSignature,
): Promise<TelemetryContext> {
  const ch = getClickHouse();

  const errorsRes = await ch.query({
    query: `
      SELECT message, any(stack) as stack, line, count() AS count,
             max(timestamp) AS last_seen
      FROM errors
      WHERE project_id = {projectId:String}
        AND file = {file:String}
        AND timestamp >= now() - INTERVAL 24 HOUR
      GROUP BY message, line
      ORDER BY count DESC
      LIMIT 10
    `,
    query_params: { projectId: sig.projectId, file: sig.file },
    format: "JSONEachRow",
  });
  const recentErrors = (await errorsRes.json()) as TelemetryContext["recentErrors"];

  const statsRes = await ch.query({
    query: `
      SELECT window, call_count, avg_ms, p99_ms, error_rate
      FROM function_stats
      WHERE project_id = {projectId:String}
        AND file = {file:String}
        AND function = {fn:String}
      ORDER BY window
    `,
    query_params: {
      projectId: sig.projectId,
      file: sig.file,
      fn: sig.functionName,
    },
    format: "JSONEachRow",
  });
  const functionStats = (await statsRes.json()) as TelemetryContext["functionStats"];

  const queriesRes = await ch.query({
    query: `
      SELECT table_name, operation, avg(duration_ms) AS avg_ms,
             quantile(0.99)(duration_ms) AS p99_ms, count() AS call_count
      FROM db_queries
      WHERE project_id = {projectId:String}
        AND file = {file:String}
        AND timestamp >= now() - INTERVAL 24 HOUR
      GROUP BY table_name, operation
      ORDER BY avg_ms DESC
      LIMIT 10
    `,
    query_params: { projectId: sig.projectId, file: sig.file },
    format: "JSONEachRow",
  });
  const slowQueries = (await queriesRes.json()) as TelemetryContext["slowQueries"];

  const db = getPostgres();
  const { rows } = await db.query<{ insight: string }>(
    `SELECT insight FROM ai_insights
     WHERE project_id = $1 AND file = $2 AND (function = $3 OR function = '')
     ORDER BY generated_at DESC LIMIT 1`,
    [sig.projectId, sig.file, sig.functionName],
  );

  return {
    signature: sig,
    recentErrors,
    functionStats,
    slowQueries,
    existingInsight: rows[0]?.insight ?? "",
  };
}

export function formatContextForPrompt(ctx: TelemetryContext): string {
  const { signature: sig } = ctx;
  const lines: string[] = [];
  lines.push(`## Error signature`);
  lines.push(`- File: \`${sig.file}:${sig.line}\``);
  lines.push(`- Function: \`${sig.functionName || "(unknown)"}\``);
  lines.push(`- Type: \`${sig.errorType}\``);
  lines.push(`- Message: ${sig.message}`);
  lines.push(
    `- Occurrences (last ${(new Date().toString(), "window")}): **${sig.occurrences}** across **${sig.uniqueSessions}** sessions`,
  );
  lines.push(`- First seen: ${sig.firstSeen}`);
  lines.push(`- Last seen: ${sig.lastSeen}`);
  lines.push("");

  if (ctx.existingInsight) {
    lines.push(`## Existing AI insight for this file`);
    lines.push(ctx.existingInsight);
    lines.push("");
  }

  if (ctx.recentErrors.length > 0) {
    lines.push(`## Recent errors in this file (last 24h)`);
    for (const e of ctx.recentErrors) {
      lines.push(
        `- line ${e.line}, ×${e.count} (last: ${e.last_seen}): ${e.message}`,
      );
      if (e.stack) {
        const firstFrames = e.stack.split("\n").slice(0, 4).join("\n    ");
        lines.push(`    ${firstFrames}`);
      }
    }
    lines.push("");
  }

  if (ctx.functionStats.length > 0) {
    lines.push(`## Function stats`);
    for (const s of ctx.functionStats) {
      lines.push(
        `- ${s.window}: calls=${s.call_count}, avg=${s.avg_ms?.toFixed?.(1) ?? s.avg_ms}ms, p99=${s.p99_ms?.toFixed?.(1) ?? s.p99_ms}ms, error_rate=${(Number(s.error_rate) * 100).toFixed(2)}%`,
      );
    }
    lines.push("");
  }

  if (ctx.slowQueries.length > 0) {
    lines.push(`## Database queries from this file`);
    for (const q of ctx.slowQueries) {
      lines.push(
        `- ${q.operation} ${q.table_name}: avg=${Number(q.avg_ms).toFixed(1)}ms, p99=${Number(q.p99_ms).toFixed(1)}ms, calls=${q.call_count}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}
