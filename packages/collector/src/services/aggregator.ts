import { getClickHouse } from "../db/clickhouse.js";

/** Rolls up per-function stats across multiple time windows. */
export async function runAggregation(): Promise<void> {
  const ch = getClickHouse();

  const windows: Array<{ name: string; intervalExpr: string }> = [
    { name: "1h", intervalExpr: "toIntervalHour(1)" },
    { name: "24h", intervalExpr: "toIntervalHour(24)" },
    { name: "7d", intervalExpr: "toIntervalDay(7)" },
    { name: "30d", intervalExpr: "toIntervalDay(30)" },
    { name: "90d", intervalExpr: "toIntervalDay(90)" },
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

/** Rolls up per-day snapshots for historical trend analysis. Stored permanently. */
export async function runDailySnapshots(): Promise<void> {
  const ch = getClickHouse();

  // Function performance snapshots by day
  await ch.command({
    query: `
      INSERT INTO daily_snapshots
      SELECT
        fn.project_id,
        fn.function,
        fn.file,
        fn.line,
        fn.date,
        toDayOfWeek(fn.date) AS day_of_week,
        0 AS hour_bucket,
        fn.call_count,
        fn.total_ms,
        fn.avg_ms,
        fn.p50_ms,
        fn.p99_ms,
        fn.error_count,
        fn.error_rate,
        fn.unique_sessions,
        total_sess.total_sessions,
        if(total_sess.total_sessions > 0, fn.unique_sessions / total_sess.total_sessions * 100, 0) AS session_reach_pct,
        now64(3) AS updated_at
      FROM (
        SELECT
          project_id,
          function,
          file,
          min(line) AS line,
          toDate(start_time) AS date,
          count()                             AS call_count,
          sum(duration_ms)                    AS total_ms,
          avg(duration_ms)                    AS avg_ms,
          quantile(0.5)(duration_ms)          AS p50_ms,
          quantile(0.99)(duration_ms)         AS p99_ms,
          countIf(status = 'error')           AS error_count,
          if(count() > 0, countIf(status = 'error') / count(), 0) AS error_rate,
          uniqExact(session_id)               AS unique_sessions
        FROM spans
        WHERE start_time >= now() - toIntervalDay(2)
          AND function != ''
        GROUP BY project_id, function, file, date
      ) AS fn
      LEFT JOIN (
        SELECT
          project_id,
          toDate(start_time) AS date,
          uniqExact(session_id) AS total_sessions
        FROM spans
        WHERE start_time >= now() - toIntervalDay(2) AND session_id != ''
        GROUP BY project_id, date
      ) AS total_sess ON fn.project_id = total_sess.project_id AND fn.date = total_sess.date
    `,
  });

  // Hourly buckets for time-of-day pattern detection (last 7 days)
  await ch.command({
    query: `
      INSERT INTO daily_snapshots
      SELECT
        project_id,
        function,
        file,
        min(line) AS line,
        toDate(start_time) AS date,
        toDayOfWeek(toDate(start_time)) AS day_of_week,
        toHour(start_time) AS hour_bucket,
        count() AS call_count,
        sum(duration_ms) AS total_ms,
        avg(duration_ms) AS avg_ms,
        quantile(0.5)(duration_ms) AS p50_ms,
        quantile(0.99)(duration_ms) AS p99_ms,
        countIf(status = 'error') AS error_count,
        if(count() > 0, countIf(status = 'error') / count(), 0) AS error_rate,
        uniqExact(session_id) AS unique_sessions,
        0 AS total_sessions,
        0 AS session_reach_pct,
        now64(3) AS updated_at
      FROM spans
      WHERE start_time >= now() - toIntervalDay(7)
        AND function != ''
      GROUP BY project_id, function, file, date, hour_bucket
    `,
  });

  // Error daily rollups
  await ch.command({
    query: `
      INSERT INTO error_daily_rollups
      SELECT
        project_id,
        file,
        function,
        type AS error_type,
        message,
        toDate(timestamp) AS date,
        toDayOfWeek(toDate(timestamp)) AS day_of_week,
        count() AS count,
        uniqExact(session_id) AS unique_sessions,
        min(timestamp) AS first_seen,
        max(timestamp) AS last_seen,
        now64(3) AS updated_at
      FROM errors
      WHERE timestamp >= now() - toIntervalDay(2)
      GROUP BY project_id, file, function, error_type, message, date
    `,
  });

  // Query daily rollups
  await ch.command({
    query: `
      INSERT INTO query_daily_rollups
      SELECT
        project_id,
        file,
        table_name,
        operation,
        toDate(timestamp) AS date,
        toDayOfWeek(toDate(timestamp)) AS day_of_week,
        count() AS call_count,
        avg(duration_ms) AS avg_ms,
        quantile(0.5)(duration_ms) AS p50_ms,
        quantile(0.99)(duration_ms) AS p99_ms,
        max(duration_ms) AS max_ms,
        sum(row_count) AS total_rows,
        now64(3) AS updated_at
      FROM db_queries
      WHERE timestamp >= now() - toIntervalDay(2)
      GROUP BY project_id, file, table_name, operation, date
    `,
  });
}

let aggregationInterval: ReturnType<typeof setInterval> | null = null;
let snapshotInterval: ReturnType<typeof setInterval> | null = null;

export function startAggregator(intervalMs = 10_000): void {
  // Real-time rollups — every 10s
  runAggregation().catch(console.error);
  aggregationInterval = setInterval(() => {
    runAggregation().catch(console.error);
  }, intervalMs);

  // Daily snapshots — every 5 minutes (idempotent via ReplacingMergeTree)
  runDailySnapshots().catch(console.error);
  snapshotInterval = setInterval(() => {
    runDailySnapshots().catch(console.error);
  }, 5 * 60 * 1000);
}

export function stopAggregator(): void {
  if (aggregationInterval) {
    clearInterval(aggregationInterval);
    aggregationInterval = null;
  }
  if (snapshotInterval) {
    clearInterval(snapshotInterval);
    snapshotInterval = null;
  }
}
