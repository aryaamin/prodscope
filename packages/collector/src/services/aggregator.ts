import { getClickHouse } from "../db/clickhouse.js";

/** Rolls up per-function stats across 1h, 24h, 7d windows. */
export async function runAggregation(): Promise<void> {
  const ch = getClickHouse();

  const windows: Array<{ name: string; interval: string }> = [
    { name: "1h", interval: "1 HOUR" },
    { name: "24h", interval: "24 HOUR" },
    { name: "7d", interval: "7 DAY" },
  ];

  for (const w of windows) {
    await ch.command({
      query: `
        INSERT INTO function_stats
        SELECT
          project_id,
          function,
          file,
          min(line) AS line,
          '${w.name}' AS window,
          count()                             AS call_count,
          sum(duration_ms)                    AS total_ms,
          avg(duration_ms)                    AS avg_ms,
          quantile(0.99)(duration_ms)         AS p99_ms,
          countIf(status = 'error')           AS error_count,
          if(count() > 0, countIf(status = 'error') / count(), 0) AS error_rate,
          now64(3)                            AS updated_at
        FROM spans
        WHERE
          start_time >= now() - INTERVAL ${w.interval}
          AND function != ''
        GROUP BY project_id, function, file
      `,
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
