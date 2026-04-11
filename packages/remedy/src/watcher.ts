import { getClickHouse } from "./db/clickhouse.js";
import { env } from "./env.js";
import type { ErrorSignature } from "./types.js";

interface ErrorRow {
  project_id: string;
  file: string;
  line: number;
  function: string;
  type: string;
  message: string;
  occurrences: string;
  unique_sessions: string;
  first_seen: string;
  last_seen: string;
}

export async function findCandidateSignatures(): Promise<ErrorSignature[]> {
  const ch = getClickHouse();

  const result = await ch.query({
    query: `
      SELECT
        project_id,
        file,
        line,
        function,
        type,
        message,
        count() AS occurrences,
        uniq(session_id) AS unique_sessions,
        min(timestamp) AS first_seen,
        max(timestamp) AS last_seen
      FROM errors
      WHERE timestamp >= now() - INTERVAL {windowHours:UInt32} HOUR
        AND file != ''
      GROUP BY project_id, file, line, function, type, message
      HAVING occurrences >= {threshold:UInt32}
      ORDER BY occurrences DESC
      LIMIT 50
    `,
    query_params: {
      windowHours: env.errorWindowHours,
      threshold: env.errorThreshold,
    },
    format: "JSONEachRow",
  });

  const rows = (await result.json()) as ErrorRow[];

  return rows.map((r) => ({
    projectId: r.project_id,
    file: r.file,
    line: Number(r.line) || 0,
    functionName: r.function,
    errorType: r.type,
    message: r.message,
    occurrences: Number(r.occurrences),
    uniqueSessions: Number(r.unique_sessions),
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
  }));
}
