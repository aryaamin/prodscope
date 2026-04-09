import { getClickHouse } from "../db/clickhouse.js";

/** Rolls up per-function stats across 1h, 24h, 7d windows. */
export async function runAggregation(): Promise<void> {
  const ch = getClickHouse();

  // Each window uses a ClickHouse interval function to avoid string interpolation in SQL
  const windows: Array<{ name: string; intervalExpr: string }> = [
    { name: "1h", intervalExpr: "toIntervalHour(1)" },
    { name: "24h", intervalExpr: "toIntervalHour(24)" },
    { name: "7d", intervalExpr: "toIntervalDay(7)" },
  ];

  for (const w of windows) {
    await ch.command({
      query: `
        INSERT INTO function_stats
        SELECT
          fn.project_id,
          fn.function,
          fn.file,
          fn.line,
          {windowName:String} AS window,
          fn.call_count,
          fn.total_ms,
          fn.avg_ms,
          fn.p99_ms,
          fn.error_count,
          fn.error_rate,
          now64(3) AS updated_at,
          fn.unique_sessions,
          total_sess.total_sessions,
          if(fn.unique_sessions > 0, fn.call_count / fn.unique_sessions, 0) AS calls_per_session,
          if(total_sess.total_sessions > 0, fn.unique_sessions / total_sess.total_sessions * 100, 0) AS session_reach_pct,
          fn.p50_ms
        FROM (
          SELECT
            project_id,
            function,
            file,
            min(line) AS line,
            count()                             AS call_count,
            sum(duration_ms)                    AS total_ms,
            avg(duration_ms)                    AS avg_ms,
            quantile(0.99)(duration_ms)         AS p99_ms,
            quantile(0.5)(duration_ms)          AS p50_ms,
            countIf(status = 'error')           AS error_count,
            if(count() > 0, countIf(status = 'error') / count(), 0) AS error_rate,
            uniqExact(session_id)               AS unique_sessions
          FROM spans
          WHERE
            start_time >= now() - ${w.intervalExpr}
            AND function != ''
          GROUP BY project_id, function, file
        ) AS fn
        LEFT JOIN (
          SELECT
            project_id,
            uniqExact(session_id) AS total_sessions
          FROM spans
          WHERE
            start_time >= now() - ${w.intervalExpr}
            AND session_id != ''
          GROUP BY project_id
        ) AS total_sess ON fn.project_id = total_sess.project_id
      `,
      query_params: { windowName: w.name },
    });
  }
}

let aggregationInterval: ReturnType<typeof setInterval> | null = null;

export function startAggregator(intervalMs = 10_000): void {
  // Run once immediately, then on interval
  runAggregation().catch(console.error);
  aggregationInterval = setInterval(() => {
    runAggregation().catch(console.error);
  }, intervalMs);
}

export function stopAggregator(): void {
  if (aggregationInterval) {
    clearInterval(aggregationInterval);
    aggregationInterval = null;
  }
}
