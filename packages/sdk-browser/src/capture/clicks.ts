import type { Transport } from "../transport.js";
import { generateId, generateSpanId, getSessionId, now } from "../utils.js";

export function captureClicks(transport: Transport): () => void {
  function handler(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target) return;

    const tag = target.tagName?.toLowerCase() ?? "unknown";
    const text = target.textContent?.slice(0, 100) ?? "";
    const id = target.id ? `#${target.id}` : "";
    const classes = target.className
      ? `.${String(target.className).split(" ").join(".")}`
      : "";

    const traceId = generateId();
    const spanId = generateSpanId();
    const timestamp = now();

    transport.enqueue({
      spans: [
        {
          traceId,
          spanId,
          name: "user.click",
          kind: "internal",
          status: "ok",
          startTime: timestamp,
          endTime: timestamp,
          durationMs: 0,
          attributes: {
            "user.action": "click",
            "element.tag": tag,
            "element.id": id,
            "element.classes": classes,
            "element.text": text,
            "page.url": location.href,
            "page.path": location.pathname,
          },
          sessionId: getSessionId(),
          userAgent: navigator.userAgent,
        },
      ],
    });
  }

  document.addEventListener("click", handler, { capture: true });
  return () => document.removeEventListener("click", handler, { capture: true });
}
