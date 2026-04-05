import type { Transport } from "../transport.js";
import { generateId, generateSpanId, getSessionId, now } from "../utils.js";

export function captureFetches(transport: Transport): () => void {
  const originalFetch = window.fetch;

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const traceId = generateId();
    const spanId = generateSpanId();
    const startTime = now();
    const start = performance.now();

    const url =
      input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");

    // Inject trace header for distributed tracing
    const headers = new Headers(init?.headers ?? {});
    headers.set("x-prodscope-trace-id", traceId);

    try {
      const response = await originalFetch(input, { ...init, headers });
      const durationMs = performance.now() - start;
      const endTime = now();

      transport.enqueue({
        spans: [
          {
            traceId,
            spanId,
            name: "http.request",
            kind: "client",
            status: response.ok ? "ok" : "error",
            startTime,
            endTime,
            durationMs,
            attributes: {
              "http.method": method.toUpperCase(),
              "http.url": url,
              "http.status_code": String(response.status),
              "page.url": location.href,
            },
            sessionId: getSessionId(),
            userAgent: navigator.userAgent,
          },
        ],
      });

      return response;
    } catch (err) {
      const durationMs = performance.now() - start;
      const endTime = now();

      transport.enqueue({
        spans: [
          {
            traceId,
            spanId,
            name: "http.request",
            kind: "client",
            status: "error",
            startTime,
            endTime,
            durationMs,
            attributes: {
              "http.method": method.toUpperCase(),
              "http.url": url,
              "error.message": err instanceof Error ? err.message : String(err),
            },
            sessionId: getSessionId(),
            userAgent: navigator.userAgent,
          },
        ],
      });

      throw err;
    }
  };

  // Also patch XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...args: any[]
  ) {
    (this as any).__prodscope = { method, url: String(url) };
    return originalOpen.call(this, method, url, ...args);
  };

  XMLHttpRequest.prototype.send = function (body?: any) {
    const meta = (this as any).__prodscope;
    if (!meta) return originalSend.call(this, body);

    const traceId = generateId();
    const spanId = generateSpanId();
    const startTime = now();
    const start = performance.now();

    this.setRequestHeader("x-prodscope-trace-id", traceId);

    this.addEventListener("loadend", () => {
      const durationMs = performance.now() - start;
      const endTime = now();

      transport.enqueue({
        spans: [
          {
            traceId,
            spanId,
            name: "http.request",
            kind: "client",
            status: this.status >= 200 && this.status < 400 ? "ok" : "error",
            startTime,
            endTime,
            durationMs,
            attributes: {
              "http.method": meta.method.toUpperCase(),
              "http.url": meta.url,
              "http.status_code": String(this.status),
            },
            sessionId: getSessionId(),
            userAgent: navigator.userAgent,
          },
        ],
      });
    });

    return originalSend.call(this, body);
  };

  return () => {
    window.fetch = originalFetch;
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  };
}
