import type { IngestBatch } from "./types.js";

export class Transport {
  private queue: IngestBatch = {};
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private ingestUrl: string;
  private apiKey: string;

  constructor(ingestUrl: string, apiKey: string) {
    this.ingestUrl = ingestUrl;
    this.apiKey = apiKey;
  }

  enqueue(batch: IngestBatch): void {
    if (batch.spans) {
      this.queue.spans = (this.queue.spans ?? []).concat(batch.spans);
    }
    if (batch.errors) {
      this.queue.errors = (this.queue.errors ?? []).concat(batch.errors);
    }
    if (batch.dbQueries) {
      this.queue.dbQueries = (this.queue.dbQueries ?? []).concat(batch.dbQueries);
    }

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 2000);
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const batch = this.queue;
    this.queue = {};

    const totalItems =
      (batch.spans?.length ?? 0) +
      (batch.errors?.length ?? 0) +
      (batch.dbQueries?.length ?? 0);

    if (totalItems === 0) return;

    try {
      const url = `${this.ingestUrl}/v1/ingest`;

      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify(batch),
        keepalive: true,
      });
    } catch {
      // Silently drop on failure — SDK should never break the host app
    }
  }

  /** Flush on page unload. */
  setupUnloadFlush(): void {
    if (typeof window === "undefined") return;

    const onUnload = () => {
      const batch = this.queue;
      this.queue = {};
      const totalItems =
        (batch.spans?.length ?? 0) +
        (batch.errors?.length ?? 0) +
        (batch.dbQueries?.length ?? 0);
      if (totalItems === 0) return;

      // Use fetch with keepalive instead of sendBeacon to avoid leaking API key in URL
      const body = JSON.stringify(batch);
      fetch(`${this.ingestUrl}/v1/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body,
        keepalive: true,
      }).catch(() => {
        // Last-resort fallback: sendBeacon with key embedded in payload
        const payload = JSON.stringify({ ...batch, _apiKey: this.apiKey });
        navigator.sendBeacon(
          `${this.ingestUrl}/v1/ingest`,
          new Blob([payload], { type: "application/json" }),
        );
      });
    };

    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onUnload();
    });
  }
}
