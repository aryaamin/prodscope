import type { Transport } from "../transport.js";
import { generateId, generateSpanId, getSessionId, now } from "../utils.js";
import { captureCallSite } from "../callsite.js";

/**
 * Wraps a function to track call count, duration, and errors.
 * File and line are auto-injected by the Vite plugin at build time,
 * or captured at runtime as a fallback.
 */
export function trackFunction<T extends (...args: any[]) => any>(
  transport: Transport,
  name: string,
  fn: T,
  file = "",
  line = 0,
): T {
  // Runtime fallback if Vite plugin didn't inject file:line
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
    const start = performance.now();

    // Capture argument shapes (not values) for debugging
    const argShapes = args.map((a) => {
      if (a === null) return "null";
      if (Array.isArray(a)) return `Array(${a.length})`;
      return typeof a;
    });

    try {
      const result = fn.apply(this, args);

      // Handle async functions
      if (result instanceof Promise) {
        return result.then(
          (val) => {
            const durationMs = performance.now() - start;
            emitSpan("ok", durationMs);
            return val;
          },
          (err) => {
            const durationMs = performance.now() - start;
            emitSpan("error", durationMs, err);
            throw err;
          },
        );
      }

      const durationMs = performance.now() - start;
      emitSpan("ok", durationMs);
      return result;
    } catch (err) {
      const durationMs = performance.now() - start;
      emitSpan("error", durationMs, err);
      throw err;
    }

    function emitSpan(
      status: "ok" | "error",
      durationMs: number,
      error?: any,
    ) {
      const endTime = now();
      transport.enqueue({
        spans: [
          {
            traceId,
            spanId,
            name: `function.${name}`,
            kind: "internal",
            status,
            startTime,
            endTime,
            durationMs,
            attributes: {
              "function.name": name,
              "function.args": argShapes.join(", "),
              ...(error
                ? {
                    "error.message":
                      error instanceof Error
                        ? error.message
                        : String(error),
                  }
                : {}),
            },
            file,
            line,
            function: name,
            sessionId:
              typeof window !== "undefined" ? getSessionId() : "",
            userAgent:
              typeof navigator !== "undefined"
                ? navigator.userAgent
                : "",
          },
        ],
        ...(error
          ? {
              errors: [
                {
                  message:
                    error instanceof Error
                      ? error.message
                      : String(error),
                  stack:
                    error instanceof Error ? error.stack ?? "" : "",
                  file,
                  line,
                  function: name,
                  type:
                    error instanceof Error ? error.name : "Error",
                  timestamp: endTime,
                },
              ],
            }
          : {}),
      });
    }
  } as unknown as T;

  // Preserve function name
  Object.defineProperty(wrapped, "name", { value: name });
  return wrapped;
}
