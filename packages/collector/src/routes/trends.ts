import { Router, type Request, type Response } from "express";
import { getClickHouse } from "../db/clickhouse.js";

const router: ReturnType<typeof Router> = Router();

/**
 * GET /api/v1/trends/function?file=X&function=Y&days=30
 * Returns daily time series for a function — call count, avg latency, error rate, session reach.
 */
router.get("/api/v1/trends/function", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { file, function: fn } = req.query;
  const days = Math.min(Number.parseInt(req.query.days as string, 10) || 30, 365);
  const ch = getClickHouse();

  if (!file) {
    res.status(400).json({ error: "file parameter is required" });
    return;
  }

  const params: Record<string, string> = { projectId, file: file as string, days: String(days) };
  let fnFilter = "";
  if (fn) {
    fnFilter = " AND function = {fn:String}";
    params.fn = fn as string;
  }

  const result = await ch.query({
    query: `
      SELECT
        date,
        day_of_week,
        sum(call_count) AS call_count,
        avg(avg_ms) AS avg_ms,
        avg(p50_ms) AS p50_ms,
        avg(p99_ms) AS p99_ms,
        sum(error_count) AS error_count,
        if(sum(call_count) > 0, sum(error_count) / sum(call_count), 0) AS error_rate,
        sum(unique_sessions) AS unique_sessions,
        avg(session_reach_pct) AS session_reach_pct
      FROM daily_snapshots FINAL
      WHERE project_id = {projectId:String}
        AND file = {file:String}
        AND hour_bucket = 0
        AND date >= today() - toIntervalDay({days:UInt32})
        ${fnFilter}
      GROUP BY date, day_of_week
      ORDER BY date
    `,
    query_params: params,
    format: "JSONEachRow",
  });
  const rows = await result.json();
  res.json({ data: rows, file, function: fn ?? null, days });
});

/**
 * GET /api/v1/trends/errors?file=X&days=30
 * Returns daily error counts grouped by error type, showing trends over time.
 */
router.get("/api/v1/trends/errors", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { file } = req.query;
  const days = Math.min(Number.parseInt(req.query.days as string, 10) || 30, 365);
  const ch = getClickHouse();

  const params: Record<string, string> = { projectId, days: String(days) };
  let fileFilter = "";
  if (file) {
    fileFilter = " AND file = {file:String}";
    params.file = file as string;
  }

  const result = await ch.query({
    query: `
      SELECT
        date,
        error_type,
        message,
        file,
        function,
        sum(count) AS total_count,
        sum(unique_sessions) AS affected_sessions,
        min(first_seen) AS first_seen,
        max(last_seen) AS last_seen
      FROM error_daily_rollups FINAL
      WHERE project_id = {projectId:String}
        AND date >= today() - toIntervalDay({days:UInt32})
        ${fileFilter}
      GROUP BY date, error_type, message, file, function
      ORDER BY date DESC, total_count DESC
      LIMIT 500
    `,
    query_params: params,
    format: "JSONEachRow",
  });
  const rows = await result.json();
  res.json({ data: rows, days });
});

/**
 * GET /api/v1/trends/queries?file=X&days=30
 * Returns daily DB query performance trends.
 */
router.get("/api/v1/trends/queries", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { file } = req.query;
  const days = Math.min(Number.parseInt(req.query.days as string, 10) || 30, 365);
  const ch = getClickHouse();

  const params: Record<string, string> = { projectId, days: String(days) };
  let fileFilter = "";
  if (file) {
    fileFilter = " AND file = {file:String}";
    params.file = file as string;
  }

  const result = await ch.query({
    query: `
      SELECT
        date,
        table_name,
        operation,
        file,
        sum(call_count) AS call_count,
        avg(avg_ms) AS avg_ms,
        avg(p50_ms) AS p50_ms,
        avg(p99_ms) AS p99_ms,
        max(max_ms) AS max_ms,
        sum(total_rows) AS total_rows
      FROM query_daily_rollups FINAL
      WHERE project_id = {projectId:String}
        AND date >= today() - toIntervalDay({days:UInt32})
        ${fileFilter}
      GROUP BY date, table_name, operation, file
      ORDER BY date DESC, avg_ms DESC
      LIMIT 500
    `,
    query_params: params,
    format: "JSONEachRow",
  });
  const rows = await result.json();
  res.json({ data: rows, days });
});

/**
 * GET /api/v1/patterns/time-of-day?file=X&function=Y
 * Returns hourly heatmap data — which hours of the day have the most traffic, errors, latency.
 */
router.get("/api/v1/patterns/time-of-day", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { file, function: fn } = req.query;
  const ch = getClickHouse();

  const params: Record<string, string> = { projectId };
  let filters = "";
  if (file) {
    filters += " AND file = {file:String}";
    params.file = file as string;
  }
  if (fn) {
    filters += " AND function = {fn:String}";
    params.fn = fn as string;
  }

  const result = await ch.query({
    query: `
      SELECT
        hour_bucket AS hour,
        sum(call_count) AS call_count,
        avg(avg_ms) AS avg_ms,
        avg(p99_ms) AS p99_ms,
        sum(error_count) AS error_count,
        if(sum(call_count) > 0, sum(error_count) / sum(call_count), 0) AS error_rate
      FROM daily_snapshots FINAL
      WHERE project_id = {projectId:String}
        AND hour_bucket > 0
        AND date >= today() - toIntervalDay(7)
        ${filters}
      GROUP BY hour_bucket
      ORDER BY hour_bucket
    `,
    query_params: params,
    format: "JSONEachRow",
  });
  const rows = await result.json();
  res.json({ data: rows });
});

/**
 * GET /api/v1/patterns/weekday-weekend?file=X&function=Y
 * Compares weekday (Mon-Fri) vs weekend (Sat-Sun) behavior.
 */
router.get("/api/v1/patterns/weekday-weekend", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { file, function: fn } = req.query;
  const ch = getClickHouse();

  const params: Record<string, string> = { projectId };
  let filters = "";
  if (file) {
    filters += " AND file = {file:String}";
    params.file = file as string;
  }
  if (fn) {
    filters += " AND function = {fn:String}";
    params.fn = fn as string;
  }

  const result = await ch.query({
    query: `
      SELECT
        if(day_of_week >= 6, 'weekend', 'weekday') AS period,
        sum(call_count) AS call_count,
        avg(avg_ms) AS avg_ms,
        avg(p50_ms) AS p50_ms,
        avg(p99_ms) AS p99_ms,
        sum(error_count) AS error_count,
        if(sum(call_count) > 0, sum(error_count) / sum(call_count), 0) AS error_rate,
        sum(unique_sessions) AS unique_sessions
      FROM daily_snapshots FINAL
      WHERE project_id = {projectId:String}
        AND hour_bucket = 0
        AND date >= today() - toIntervalDay(30)
        ${filters}
      GROUP BY period
      ORDER BY period
    `,
    query_params: params,
    format: "JSONEachRow",
  });
  const rows = await result.json();
  res.json({ data: rows });
});

/**
 * GET /api/v1/patterns/compare-periods?file=X&function=Y&period1_start=2025-01-01&period1_end=2025-01-07&period2_start=2025-01-08&period2_end=2025-01-14
 * Compare two arbitrary date ranges side by side.
 */
router.get("/api/v1/patterns/compare-periods", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { file, function: fn, period1_start, period1_end, period2_start, period2_end } = req.query;
  const ch = getClickHouse();

  if (!period1_start || !period1_end || !period2_start || !period2_end) {
    res.status(400).json({ error: "period1_start, period1_end, period2_start, period2_end are all required" });
    return;
  }

  const params: Record<string, string> = { projectId };
  let filters = "";
  if (file) {
    filters += " AND file = {file:String}";
    params.file = file as string;
  }
  if (fn) {
    filters += " AND function = {fn:String}";
    params.fn = fn as string;
  }

  async function getPeriodStats(start: string, end: string, label: string) {
    const p = { ...params, start, end };
    const result = await ch.query({
      query: `
        SELECT
          sum(call_count) AS call_count,
          avg(avg_ms) AS avg_ms,
          avg(p50_ms) AS p50_ms,
          avg(p99_ms) AS p99_ms,
          sum(error_count) AS error_count,
          if(sum(call_count) > 0, sum(error_count) / sum(call_count), 0) AS error_rate,
          sum(unique_sessions) AS unique_sessions,
          avg(session_reach_pct) AS session_reach_pct
        FROM daily_snapshots FINAL
        WHERE project_id = {projectId:String}
          AND hour_bucket = 0
          AND date >= {start:Date}
          AND date <= {end:Date}
          ${filters}
      `,
      query_params: p,
      format: "JSONEachRow",
    });
    const rows: any[] = await result.json();
    return { period: label, start, end, ...(rows[0] ?? {}) };
  }

  const [period1, period2] = await Promise.all([
    getPeriodStats(period1_start as string, period1_end as string, "period1"),
    getPeriodStats(period2_start as string, period2_end as string, "period2"),
  ]);

  res.json({
    period1,
    period2,
    diff: {
      call_count_change: (period2.call_count ?? 0) - (period1.call_count ?? 0),
      avg_ms_change: (period2.avg_ms ?? 0) - (period1.avg_ms ?? 0),
      error_rate_change: (period2.error_rate ?? 0) - (period1.error_rate ?? 0),
      session_reach_change: (period2.session_reach_pct ?? 0) - (period1.session_reach_pct ?? 0),
    },
  });
});

export default router;
