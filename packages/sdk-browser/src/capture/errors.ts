import type { Transport } from "../transport.js";
import { getSessionId, now } from "../utils.js";

/** Strip origin from browser URL to get relative path */
function toRelativePath(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    // Remove leading slash, strip query params (Vite HMR adds ?t=...)
    return parsed.pathname.replace(/^\//, "");
  } catch {
    return url;
  }
}

export function captureErrors(transport: Transport): () => void {
  function onError(event: ErrorEvent) {
    transport.enqueue({
      errors: [
        {
          message: event.message,
          stack: event.error?.stack ?? "",
          file: toRelativePath(event.filename ?? ""),
          line: event.lineno ?? 0,
          column: event.colno ?? 0,
          type: event.error?.name ?? "Error",
          userAgent: navigator.userAgent,
          sessionId: getSessionId(),
          timestamp: now(),
        },
      ],
    });
  }

  function onUnhandledRejection(event: PromiseRejectionEvent) {
    const reason = event.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack ?? "" : "";

    transport.enqueue({
      errors: [
        {
          message: `Unhandled Promise Rejection: ${message}`,
          stack,
          type: reason instanceof Error ? reason.name : "UnhandledRejection",
          userAgent: navigator.userAgent,
          sessionId: getSessionId(),
          timestamp: now(),
        },
      ],
    });
  }

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
