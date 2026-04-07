import { Router, type Request, type Response } from "express";
import { getClickHouse } from "../db/clickhouse.js";
import { getPostgres } from "../db/postgres.js";
import { generateInsight } from "../services/ai-insights.js";

const router: ReturnType<typeof Router> = Router();

/** GET /api/v1/function-stats?function=X&file=Y&window=1h|24h|7d */
router.get("/api/v1/function-stats", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { function: fn, file, window: w } = req.query;
  const ch = getClickHouse();

  let query = `
    SELECT function, file, line, window, call_count, avg_ms, p50_ms, p99_ms,
           error_count, error_rate, unique_sessions, total_sessions,
           calls_per_session, session_reach_pct
    FROM function_stats FINAL
    WHERE project_id = {projectId:String}
  `;
  const params: Record<string, string> = { projectId };

  if (fn) {
    query += " AND function = {fn:String}";
    params.fn = fn as string;
  }
  if (file) {
    query += " AND file = {file:String}";
    params.file = file as string;
  }
  if (w) {
    query += " AND window = {window:String}";
    params.window = w as string;
  }

  query += " ORDER BY call_count DESC LIMIT 100";

  const result = await ch.query({ query, query_params: params, format: "JSONEachRow" });
  const rows = await result.json();
  res.json(rows);
});

/** GET /api/v1/errors?file=X&line=Y */
router.get("/api/v1/errors", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { file, line, limit } = req.query;
  const ch = getClickHouse();

  let query = `
    SELECT message, type, stack, resolved_stack, file, line, column, function,
           user_agent, session_id, git_sha, timestamp
    FROM errors
    WHERE project_id = {projectId:String}
  `;
  const params: Record<string, string> = { projectId };

  if (file) {
    query += " AND file = {file:String}";
    params.file = file as string;
  }
  if (line) {
    query += " AND line = {line:UInt32}";
    params.line = line as string;
  }

  query += ` ORDER BY timestamp DESC LIMIT ${parseInt(limit as string, 10) || 50}`;

  const result = await ch.query({ query, query_params: params, format: "JSONEachRow" });
  const rows = await result.json();
  res.json(rows);
});

/** GET /api/v1/slow-queries?threshold=100&file=X */
router.get("/api/v1/slow-queries", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const threshold = parseInt(req.query.threshold as string, 10) || 100;
  const { file } = req.query;
  const ch = getClickHouse();

  let query = `
    SELECT table_name, operation, duration_ms, row_count, file, line, statement,
           session_id, timestamp
    FROM db_queries
    WHERE project_id = {projectId:String}
      AND duration_ms >= {threshold:Float64}
  `;
  const params: Record<string, string> = { projectId, threshold: String(threshold) };

  if (file) {
    query += " AND file = {file:String}";
    params.file = file as string;
  }

  query += " ORDER BY duration_ms DESC LIMIT 50";

  const result = await ch.query({ query, query_params: params, format: "JSONEachRow" });
  const rows = await result.json();
  res.json(rows);
});

/** GET /api/v1/ai-insight?file=X&function=Y */
router.get("/api/v1/ai-insight", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { file, function: fn, refresh } = req.query;

  if (!file) {
    res.status(400).json({ error: "file parameter is required" });
    return;
  }

  // Try cached first
  const db = getPostgres();
  const cached = await db.query(
    `SELECT insight, generated_at FROM ai_insights
     WHERE project_id = $1 AND file = $2 AND function = $3`,
    [projectId, file, fn ?? ""],
  );

  if (cached.rows.length > 0 && refresh !== "true") {
    res.json({
      file,
      function: fn ?? "",
      insight: cached.rows[0].insight,
      generatedAt: cached.rows[0].generated_at,
      fresh: false,
    });
    return;
  }

  // Generate fresh — requires Anthropic API key
  try {
    const insight = await generateInsight({
      projectId,
      file: file as string,
      functionName: fn as string | undefined,
    });
    res.json({ file, function: fn ?? "", insight, fresh: true });
  } catch (err: any) {
    if (err.message?.includes("ANTHROPIC_API_KEY")) {
      res.json({ file, function: fn ?? "", insight: "AI insights are not configured on this server.", fresh: false });
    } else {
      throw err;
    }
  }
});

/** GET /api/v1/live-sessions?route=X */
router.get("/api/v1/live-sessions", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { route } = req.query;
  const ch = getClickHouse();

  let query = `
    SELECT count(DISTINCT session_id) AS active_sessions
    FROM spans
    WHERE project_id = {projectId:String}
      AND start_time >= now() - INTERVAL 5 MINUTE
      AND session_id != ''
  `;
  const params: Record<string, string> = { projectId };

  if (route) {
    query += " AND attributes['http.route'] = {route:String}";
    params.route = route as string;
  }

  const result = await ch.query({ query, query_params: params, format: "JSONEachRow" });
  const rows: Array<{ active_sessions: string }> = await result.json();
  res.json({ activeSessions: parseInt(rows[0]?.active_sessions ?? "0", 10) });
});

/** GET /api/v1/trace/:traceId */
router.get("/api/v1/trace/:traceId", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { traceId } = req.params;
  const ch = getClickHouse();

  const spansResult = await ch.query({
    query: `
      SELECT span_id, parent_span_id, name, kind, status,
             start_time, end_time, duration_ms, attributes, file, line, function
      FROM spans
      WHERE project_id = {projectId:String} AND trace_id = {traceId:String}
      ORDER BY start_time
    `,
    query_params: { projectId, traceId },
    format: "JSONEachRow",
  });
  const spans = await spansResult.json();

  const errorsResult = await ch.query({
    query: `
      SELECT message, type, stack, resolved_stack, file, line, timestamp
      FROM errors
      WHERE project_id = {projectId:String} AND trace_id = {traceId:String}
      ORDER BY timestamp
    `,
    query_params: { projectId, traceId },
    format: "JSONEachRow",
  });
  const errors = await errorsResult.json();

  const queriesResult = await ch.query({
    query: `
      SELECT table_name, operation, duration_ms, row_count, file, line, timestamp
      FROM db_queries
      WHERE project_id = {projectId:String} AND trace_id = {traceId:String}
      ORDER BY timestamp
    `,
    query_params: { projectId, traceId },
    format: "JSONEachRow",
  });
  const dbQueries = await queriesResult.json();

  res.json({ traceId, spans, errors, dbQueries });
});

/** GET /api/v1/hot-paths?window=1h|24h|7d */
router.get("/api/v1/hot-paths", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const window = (req.query.window as string) ?? "1h";
  const ch = getClickHouse();

  const result = await ch.query({
    query: `
      SELECT function, file, line, call_count, avg_ms, p50_ms, p99_ms,
             error_count, error_rate, unique_sessions, total_sessions,
             calls_per_session, session_reach_pct
      FROM function_stats FINAL
      WHERE project_id = {projectId:String} AND window = {window:String}
      ORDER BY call_count DESC
      LIMIT 20
    `,
    query_params: { projectId, window },
    format: "JSONEachRow",
  });
  const rows = await result.json();
  res.json(rows);
});

/** GET /api/v1/compare-deploys?sha1=X&sha2=Y */
router.get("/api/v1/compare-deploys", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { sha1, sha2 } = req.query;

  if (!sha1 || !sha2) {
    res.status(400).json({ error: "sha1 and sha2 query params are required" });
    return;
  }

  const ch = getClickHouse();

  async function getDeployStats(sha: string) {
    const result = await ch.query({
      query: `
        SELECT
          count() AS total_spans,
          countIf(status = 'error') AS error_count,
          if(count() > 0, countIf(status = 'error') / count(), 0) AS error_rate,
          avg(duration_ms) AS avg_latency,
          quantile(0.99)(duration_ms) AS p99_latency
        FROM spans
        WHERE project_id = {projectId:String} AND git_sha = {sha:String}
      `,
      query_params: { projectId, sha },
      format: "JSONEachRow",
    });
    const rows: any[] = await result.json();
    return rows[0] ?? {};
  }

  const [stats1, stats2] = await Promise.all([
    getDeployStats(sha1 as string),
    getDeployStats(sha2 as string),
  ]);

  res.json({
    sha1: { sha: sha1, ...stats1 },
    sha2: { sha: sha2, ...stats2 },
    diff: {
      errorRateChange: (stats2.error_rate ?? 0) - (stats1.error_rate ?? 0),
      avgLatencyChange: (stats2.avg_latency ?? 0) - (stats1.avg_latency ?? 0),
      p99LatencyChange: (stats2.p99_latency ?? 0) - (stats1.p99_latency ?? 0),
    },
  });
});

export default router;
