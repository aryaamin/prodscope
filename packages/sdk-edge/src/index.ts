/**
 * @prodscope/sdk-edge — Deno/Edge-compatible thin SDK.
 *
 * Works in Supabase Edge Functions, Cloudflare Workers, and Deno Deploy.
 * Uses only Web APIs (fetch, crypto.getRandomValues) — no Node.js dependencies.
 */

export interface ProdScopeEdgeConfig {
  projectId: string;
  apiKey: string;
  ingestUrl?: string;
  gitSha?: string;
  /** Optional callback for flush errors — by default errors are logged to console. */
  onError?: (err: unknown) => void;
}

interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: string;
  status?: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  attributes?: Record<string, string>;
  file?: string;
  line?: number;
  function?: string;
  gitSha?: string;
}

interface ErrorData {
  traceId?: string;
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  type?: string;
  gitSha?: string;
  timestamp: string;
}

interface IngestBatch {
  spans?: SpanData[];
  errors?: ErrorData[];
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let _config: ProdScopeEdgeConfig | null = null;
let _batch: IngestBatch = {};

export function init(config: ProdScopeEdgeConfig): void {
  _config = config;
}

function enqueue(batch: IngestBatch): void {
  if (batch.spans) _batch.spans = (_batch.spans ?? []).concat(batch.spans);
  if (batch.errors) _batch.errors = (_batch.errors ?? []).concat(batch.errors);
}

function mergeFailedBatchIntoBuffer(batch: IngestBatch): void {
  if (batch.spans?.length) _batch.spans = batch.spans.concat(_batch.spans ?? []);
  if (batch.errors?.length) _batch.errors = batch.errors.concat(_batch.errors ?? []);
}

/** Flush all buffered events to the collector. Call at the end of your edge function. */
export async function flush(): Promise<void> {
  if (!_config) return;

  const batch = _batch;
  _batch = {};

  const totalItems = (batch.spans?.length ?? 0) + (batch.errors?.length ?? 0);
  if (totalItems === 0) return;

  const ingestUrl = _config.ingestUrl ?? "https://ingest.prodscope.dev";

  try {
    const res = await fetch(`${ingestUrl}/v1/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": _config.apiKey,
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const msg = `ProdScope flush failed: ${res.status} ${res.statusText}`;
      (_config.onError ?? console.error)(msg);
      mergeFailedBatchIntoBuffer(batch);
    }
  } catch (err) {
    (_config.onError ?? console.error)(err);
    mergeFailedBatchIntoBuffer(batch);
  }
}

/** Track a function for call count, duration, and error monitoring. */
export function track<T extends (...args: any[]) => any>(
  name: string,
  fn: T,
  file = "",
  line = 0,
): T {
  if (!_config) return fn;

  const config = _config;

  const wrapped = async function (this: any, ...args: any[]) {
    const traceId = generateId();
    const spanId = generateSpanId();
    const startTime = new Date().toISOString();
    const start = performance.now();

    try {
      const result = await fn.apply(this, args);
      const durationMs = performance.now() - start;

      enqueue({
        spans: [
          {
            traceId,
            spanId,
            name: `function.${name}`,
            kind: "internal",
            status: "ok",
            startTime,
            endTime: new Date().toISOString(),
            durationMs,
            attributes: { "function.name": name },
            file,
            line,
            function: name,
            gitSha: config.gitSha ?? "",
          },
        ],
      });

      return result;
    } catch (err) {
      const durationMs = performance.now() - start;

      enqueue({
        spans: [
          {
            traceId,
            spanId,
            name: `function.${name}`,
            kind: "internal",
            status: "error",
            startTime,
            endTime: new Date().toISOString(),
            durationMs,
            attributes: {
              "function.name": name,
              "error.message":
                err instanceof Error ? err.message : String(err),
            },
            file,
            line,
            function: name,
            gitSha: config.gitSha ?? "",
          },
        ],
        errors: [
          {
            traceId,
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack ?? "" : "",
            file,
            line,
            type: err instanceof Error ? err.name : "Error",
            gitSha: config.gitSha ?? "",
            timestamp: new Date().toISOString(),
          },
        ],
      });

      throw err;
    }
  } as unknown as T;

  Object.defineProperty(wrapped, "name", { value: name });
  return wrapped;
}

/** Send a custom named event. */
export function event(name: string, metadata: Record<string, string> = {}): void {
  if (!_config) return;

  const timestamp = new Date().toISOString();
  enqueue({
    spans: [
      {
        traceId: generateId(),
        spanId: generateSpanId(),
        name: `custom.${name}`,
        kind: "internal",
        status: "ok",
        startTime: timestamp,
        endTime: timestamp,
        durationMs: 0,
        attributes: { "custom.name": name, ...metadata },
        gitSha: _config.gitSha ?? "",
      },
    ],
  });
}

/**
 * Wrap a Supabase Edge Function handler to auto-flush at the end.
 *
 * ```ts
 * import { init, wrapHandler } from "@prodscope/sdk-edge";
 *
 * init({ projectId: "...", apiKey: Deno.env.get("PRODSCOPE_API_KEY")! });
 *
 * Deno.serve(wrapHandler(async (req) => {
 *   return new Response("ok");
 * }));
 * ```
 */
export function wrapHandler(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const traceId = generateId();
    const spanId = generateSpanId();
    const startTime = new Date().toISOString();
    const start = performance.now();

    try {
      const response = await handler(req);
      const durationMs = performance.now() - start;

      enqueue({
        spans: [
          {
            traceId,
            spanId,
            name: "http.server",
            kind: "server",
            status: response.status >= 400 ? "error" : "ok",
            startTime,
            endTime: new Date().toISOString(),
            durationMs,
            attributes: {
              "http.method": req.method,
              "http.url": req.url,
              "http.status_code": String(response.status),
            },
            gitSha: _config?.gitSha ?? "",
          },
        ],
      });

      await flush();
      return response;
    } catch (err) {
      const durationMs = performance.now() - start;

      enqueue({
        spans: [
          {
            traceId,
            spanId,
            name: "http.server",
            kind: "server",
            status: "error",
            startTime,
            endTime: new Date().toISOString(),
            durationMs,
            attributes: {
              "http.method": req.method,
              "http.url": req.url,
              "error.message":
                err instanceof Error ? err.message : String(err),
            },
            gitSha: _config?.gitSha ?? "",
          },
        ],
      });

      await flush();
      throw err;
    }
  };
}
