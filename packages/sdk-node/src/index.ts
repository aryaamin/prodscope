import type { ProdScopeConfig, LogLevel } from "./types.js";
import { Transport } from "./transport.js";
import { generateId, generateSpanId, now } from "./utils.js";
import { captureCallSite } from "./callsite.js";

export type { ProdScopeConfig, SpanData, ErrorData, DbQueryData, LogData, LogLevel, IngestBatch } from "./types.js";
export { tracked, traced } from "./decorator.js";

let transport: Transport | null = null;
let config: ProdScopeConfig | null = null;

export function getTransport(): Transport | null {
  return transport;
}

export function getConfig(): ProdScopeConfig | null {
  return config;
}

/**
 * Initialize ProdScope for Node.js.
 *
 * ```ts
 * import { init } from "@prodscope/sdk-node";
 *
 * init({
 *   projectId: "your-project-id",
 *   apiKey: process.env.PRODSCOPE_API_KEY!,
 *   ingestUrl: "https://ingest.prodscope.dev",
 * });
 * ```
 */
export function init(cfg: ProdScopeConfig): void {
  if (transport) return;

  config = cfg;
  const ingestUrl = cfg.ingestUrl ?? "https://ingest.prodscope.dev";
  transport = new Transport(ingestUrl, cfg.apiKey);
  transport.setupGracefulShutdown();

  // Capture unhandled errors
  if (cfg.capture?.errors !== false) {
    process.on("uncaughtException", (err) => {
      transport?.enqueue({
        errors: [
          {
            message: err.message,
            stack: err.stack ?? "",
            type: err.name,
            timestamp: now(),
            gitSha: cfg.gitSha ?? "",
          },
        ],
      });
      // Node's default behavior after an uncaught exception is to exit, and the
      // 2s flush timer would never fire. Flush synchronously before exiting.
      void (async () => {
        try {
          await transport?.flush();
        } finally {
          process.exit(1);
        }
      })();
    });

    process.on("unhandledRejection", (reason) => {
      const err =
        reason instanceof Error ? reason : new Error(String(reason));
      transport?.enqueue({
        errors: [
          {
            message: `Unhandled Rejection: ${err.message}`,
            stack: err.stack ?? "",
            type: err.name,
            timestamp: now(),
            gitSha: cfg.gitSha ?? "",
          },
        ],
      });
    });
  }
}

/**
 * Track a function for call count, duration, and error monitoring.
 */
export function track<T extends (...args: any[]) => any>(
  name: string,
  fn: T,
  file = "",
  line = 0,
): T {
  if (!transport) return fn;

  // Runtime fallback if build plugin didn't inject file:line
  if (!file) {
    const site = captureCallSite();
    if (site) {
      file = site.file;
      line = site.line;
    }
  }

  const wrapped = function (this: any, ...args: any[]) {
    const traceId = generateId();
    const spanId = generateSpanId();
    const startTime = now();
    const start = process.hrtime.bigint();

    const argShapes = args.map((a) => {
      if (a === null) return "null";
      if (Array.isArray(a)) return `Array(${a.length})`;
      return typeof a;
    });

    try {
      const result = fn.apply(this, args);

      if (result instanceof Promise) {
        return result.then(
          (val) => {
            emit("ok", Number(process.hrtime.bigint() - start) / 1_000_000);
            return val;
          },
          (err) => {
            emit("error", Number(process.hrtime.bigint() - start) / 1_000_000, err);
            throw err;
          },
        );
      }

      emit("ok", Number(process.hrtime.bigint() - start) / 1_000_000);
      return result;
    } catch (err) {
      emit("error", Number(process.hrtime.bigint() - start) / 1_000_000, err);
      throw err;
    }

    function emit(status: "ok" | "error", durationMs: number, error?: any) {
      transport!.enqueue({
        spans: [
          {
            traceId,
            spanId,
            name: `function.${name}`,
            kind: "internal",
            status,
            startTime,
            endTime: now(),
            durationMs,
            attributes: {
              "function.name": name,
              "function.args": argShapes.join(", "),
              ...(error
                ? { "error.message": error instanceof Error ? error.message : String(error) }
                : {}),
            },
            file,
            line,
            function: name,
            gitSha: config?.gitSha ?? "",
          },
        ],
      });
    }
  } as unknown as T;

  Object.defineProperty(wrapped, "name", { value: name });
  return wrapped;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let logsInWindow = 0;
let logWindowResetAt = 0;

function defaultMinLevel(): LogLevel {
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

/**
 * Emit a user-land structured log. Captured file:line is attached via the
 * build plugin (preferred) or a runtime stack walk as a fallback.
 *
 * ```ts
 * import { log } from "@prodscope/sdk-node";
 * log("warn", "cart empty after checkout", { userId });
 * ```
 */
export function log(
  level: LogLevel,
  message: string,
  attributes: Record<string, unknown> = {},
  file = "",
  line = 0,
): void {
  if (!transport || !config) return;
  if (config.capture?.logs === false) return;

  const minLevel = config.logs?.minLevel ?? defaultMinLevel();
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;

  // Simple per-flush-window rate limit so a hot loop can't flood the wire.
  const windowMs = 2000;
  const maxPerFlush = config.logs?.maxPerFlush ?? 200;
  const ts = Date.now();
  if (ts > logWindowResetAt) {
    logWindowResetAt = ts + windowMs;
    logsInWindow = 0;
  }
  if (logsInWindow >= maxPerFlush) return;
  logsInWindow++;

  if (!file) {
    const site = captureCallSite();
    if (site) {
      file = site.file;
      line = site.line;
    }
  }

  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (v === undefined || v === null) continue;
    attrs[k] = typeof v === "string" ? v : JSON.stringify(v);
  }

  transport.enqueue({
    logs: [
      {
        level,
        message,
        attributes: attrs,
        file,
        line,
        timestamp: now(),
        gitSha: config.gitSha ?? "",
      },
    ],
  });
}

/** Send a custom named event. */
export function event(name: string, metadata: Record<string, string> = {}): void {
  if (!transport) return;

  transport.enqueue({
    spans: [
      {
        traceId: generateId(),
        spanId: generateSpanId(),
        name: `custom.${name}`,
        kind: "internal",
        status: "ok",
        startTime: now(),
        endTime: now(),
        durationMs: 0,
        attributes: { "custom.name": name, ...metadata },
        gitSha: config?.gitSha ?? "",
      },
    ],
  });
}

/** Flush pending data and shut down. */
export async function destroy(): Promise<void> {
  await transport?.flush();
  transport = null;
  config = null;
}
