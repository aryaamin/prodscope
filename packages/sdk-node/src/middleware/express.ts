import "../express-augment.js";
import type { Request, Response, NextFunction } from "express";
import { getTransport, getConfig } from "../index.js";
import { generateId, generateSpanId, now } from "../utils.js";

/**
 * Express middleware that traces incoming HTTP requests.
 *
 * ```ts
 * import express from "express";
 * import { prodscopeMiddleware } from "@prodscope/sdk-node/express";
 *
 * const app = express();
 * app.use(prodscopeMiddleware());
 * ```
 */
export function prodscopeMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const transport = getTransport();
    const config = getConfig();
    if (!transport) return next();

    // Propagate trace ID from browser SDK if present
    const traceId =
      (req.headers["x-prodscope-trace-id"] as string) ?? generateId();
    const spanId = generateSpanId();
    const startTime = now();
    const start = process.hrtime.bigint();

    req.prodscopeTraceId = traceId;

    res.on("finish", () => {
      const durationMs =
        Number(process.hrtime.bigint() - start) / 1_000_000;
      const endTime = now();

      transport.enqueue({
        spans: [
          {
            traceId,
            spanId,
            name: "http.server",
            kind: "server",
            status: res.statusCode >= 400 ? "error" : "ok",
            startTime,
            endTime,
            durationMs,
            attributes: {
              "http.method": req.method,
              "http.url": req.originalUrl,
              "http.route": req.route?.path ?? req.path,
              "http.status_code": String(res.statusCode),
              "http.user_agent": req.headers["user-agent"] ?? "",
            },
            gitSha: config?.gitSha ?? "",
            sessionId:
              (req.headers["x-prodscope-session-id"] as string) ?? "",
            userAgent: req.headers["user-agent"] ?? "",
          },
        ],
      });
    });

    next();
  };
}
