import { getTransport, getConfig } from "../index.js";
import { generateId, generateSpanId, now } from "../utils.js";
import { captureCallSite } from "../callsite.js";

/**
 * Patches a pg Pool or Client to trace database queries.
 * Automatically captures the file and line where each query was called.
 *
 * ```ts
 * import pg from "pg";
 * import { patchPg } from "@prodscope/sdk-node/pg";
 *
 * const pool = new pg.Pool({ connectionString: "..." });
 * patchPg(pool);
 * ```
 */
export function patchPg(client: any): void {
  const originalQuery = client.query.bind(client);

  client.query = async function (...args: any[]) {
    const transport = getTransport();
    const config = getConfig();
    if (!transport) return originalQuery(...args);

    // Capture WHERE in user code this query was called
    const site = captureCallSite();

    const statement =
      typeof args[0] === "string" ? args[0] : args[0]?.text ?? "";
    const { tableName, operation } = parseSQL(statement);

    const start = process.hrtime.bigint();
    const startTime = now();
    const traceId = generateId();
    const spanId = generateSpanId();

    try {
      const result = await originalQuery(...args);
      const durationMs =
        Number(process.hrtime.bigint() - start) / 1_000_000;

      transport.enqueue({
        dbQueries: [
          {
            traceId,
            spanId,
            tableName,
            operation,
            durationMs,
            rowCount: result?.rowCount ?? 0,
            file: site?.file ?? "",
            line: site?.line ?? 0,
            statement: statement.slice(0, 500),
            timestamp: startTime,
          },
        ],
      });

      return result;
    } catch (err) {
      const durationMs =
        Number(process.hrtime.bigint() - start) / 1_000_000;

      transport.enqueue({
        dbQueries: [
          {
            traceId,
            spanId,
            tableName,
            operation,
            durationMs,
            rowCount: 0,
            file: site?.file ?? "",
            line: site?.line ?? 0,
            statement: statement.slice(0, 500),
            timestamp: startTime,
          },
        ],
        errors: [
          {
            traceId,
            message:
              err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack ?? "" : "",
            file: site?.file ?? "",
            line: site?.line ?? 0,
            function: site?.function ?? "",
            type: "PostgresError",
            timestamp: now(),
            gitSha: config?.gitSha ?? "",
          },
        ],
      });

      throw err;
    }
  };
}

function parseSQL(sql: string): { tableName: string; operation: string } {
  const trimmed = sql.trim().toUpperCase();
  const operation = trimmed.split(/\s+/)[0] ?? "UNKNOWN";

  const fromMatch = sql.match(
    /(?:FROM|INTO|UPDATE|TABLE)\s+["']?(\w+)["']?/i,
  );
  const tableName = fromMatch?.[1] ?? "unknown";

  return { tableName, operation };
}
