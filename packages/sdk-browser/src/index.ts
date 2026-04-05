import type { ProdScopeConfig } from "./types.js";
import { Transport } from "./transport.js";
import { captureClicks } from "./capture/clicks.js";
import { captureFetches } from "./capture/fetches.js";
import { captureErrors } from "./capture/errors.js";
import { trackFunction } from "./capture/functions.js";
import { generateId, generateSpanId, getSessionId, now } from "./utils.js";

export type { ProdScopeConfig, SpanData, ErrorData, DbQueryData, IngestBatch } from "./types.js";
export { trackFunction } from "./capture/functions.js";
export { tracked, traced } from "./decorator.js";

let transport: Transport | null = null;
const teardowns: Array<() => void> = [];

/**
 * Initialize ProdScope in the browser.
 *
 * ```ts
 * import { init } from "@prodscope/sdk-browser";
 *
 * init({
 *   projectId: "your-project-id",
 *   apiKey: import.meta.env.VITE_PRODSCOPE_API_KEY,
 *   ingestUrl: "https://ingest.prodscope.dev",
 * });
 * ```
 */
export function init(config: ProdScopeConfig): void {
  if (transport) return; // Already initialized

  const ingestUrl = config.ingestUrl ?? "https://ingest.prodscope.dev";
  transport = new Transport(ingestUrl, config.apiKey);
  transport.setupUnloadFlush();

  const capture = {
    clicks: true,
    fetches: true,
    errors: true,
    dbQueries: true,
    functions: true,
    ...config.capture,
  };

  if (capture.clicks) teardowns.push(captureClicks(transport));
  if (capture.fetches) teardowns.push(captureFetches(transport));
  if (capture.errors) teardowns.push(captureErrors(transport));
}

/** Track a function for call count, duration, and error monitoring. */
export function track<T extends (...args: any[]) => any>(
  name: string,
  fn: T,
  file = "",
  line = 0,
): T {
  // If transport is ready now, wrap immediately
  if (transport) {
    return trackFunction(transport, name, fn, file, line);
  }

  // Lazy wrapper: defer transport check to call time so that track() can be
  // called before init() (e.g. at module-load time by the Vite auto-track plugin)
  let wrapped: T | null = null;
  const lazy = function (this: any, ...args: any[]) {
    if (!wrapped) {
      if (transport) {
        wrapped = trackFunction(transport, name, fn, file, line);
      } else {
        // SDK still not initialized — run the original function untracked
        return fn.apply(this, args);
      }
    }
    return wrapped.apply(this, args);
  } as unknown as T;

  Object.defineProperty(lazy, "name", { value: name });
  return lazy;
}

/** Send a custom named event with metadata. */
export function event(name: string, metadata: Record<string, string> = {}): void {
  if (!transport) return;

  transport.enqueue({
    spans: [
      {
        traceId: generateId(),
        spanId: generateSpanId(),
        name: `custom.${name}`,
        kind: "internal" as const,
        status: "ok" as const,
        startTime: now(),
        endTime: now(),
        durationMs: 0,
        attributes: { "custom.name": name, ...metadata },
        sessionId: getSessionId(),
        userAgent: navigator.userAgent,
      },
    ],
  });
}

/** Tear down all listeners and flush remaining data. */
export function destroy(): void {
  for (const teardown of teardowns) teardown();
  teardowns.length = 0;
  transport?.flush();
  transport = null;
}
