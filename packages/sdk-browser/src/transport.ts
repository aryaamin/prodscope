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

      // Use sendBeacon for page unload, fetch otherwise
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(batch)], {
          type: "application/json",
        });
        // Try fetch first, fall back to sendBeacon
        await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
          },
          body: JSON.stringify(batch),
          keepalive: true,
        });
      } else {
        await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
          },
          body: JSON.stringify(batch),
        });
      }
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

      const blob = new Blob([JSON.stringify(batch)], {
        type: "application/json",
      });
      navigator.sendBeacon(
        `${this.ingestUrl}/v1/ingest?key=${this.apiKey}`,
        blob,
      );
    };

    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onUnload();
    });
  }
}
