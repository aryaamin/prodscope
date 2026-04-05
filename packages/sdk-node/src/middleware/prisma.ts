import { getTransport, getConfig } from "../index.js";
import { generateId, generateSpanId, now } from "../utils.js";
import { captureCallSite } from "../callsite.js";

/**
 * Prisma client extension that traces database queries.
 * Automatically captures the file and line where the query was called.
 *
 * ```ts
 * import { PrismaClient } from "@prisma/client";
 * import { prodscopePrisma } from "@prodscope/sdk-node/prisma";
 *
 * const prisma = new PrismaClient().$extends(prodscopePrisma());
 * ```
 */
export function prodscopePrisma() {
  return {
    name: "prodscope-prisma",
    query: {
      $allModels: {
        async $allOperations({
          model,
          operation,
          args,
          query,
        }: {
          model: string;
          operation: string;
          args: any;
          query: (args: any) => Promise<any>;
        }) {
          const transport = getTransport();
          const config = getConfig();
          if (!transport) return query(args);

          // Capture WHERE in user code this query was called
          const site = captureCallSite(1);

          const start = process.hrtime.bigint();
          const startTime = now();
          const traceId = generateId();
          const spanId = generateSpanId();

          try {
            const result = await query(args);
            const durationMs =
              Number(process.hrtime.bigint() - start) / 1_000_000;

            const rowCount = Array.isArray(result)
              ? result.length
              : result
                ? 1
                : 0;

            transport.enqueue({
              dbQueries: [
                {
                  traceId,
                  spanId,
                  tableName: model,
                  operation,
                  durationMs,
                  rowCount,
                  file: site?.file ?? "",
                  line: site?.line ?? 0,
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
                  tableName: model,
                  operation,
                  durationMs,
                  rowCount: 0,
                  file: site?.file ?? "",
                  line: site?.line ?? 0,
                  timestamp: startTime,
                },
              ],
              errors: [
                {
                  traceId,
                  message:
                    err instanceof Error
                      ? err.message
                      : String(err),
                  stack:
                    err instanceof Error ? err.stack ?? "" : "",
                  file: site?.file ?? "",
                  line: site?.line ?? 0,
                  function: site?.function ?? "",
                  type: "PrismaError",
                  timestamp: now(),
                  gitSha: config?.gitSha ?? "",
                },
              ],
            });

            throw err;
          }
        },
      },
    },
  };
}
