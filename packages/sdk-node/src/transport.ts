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
    if (batch.logs) {
      this.queue.logs = (this.queue.logs ?? []).concat(batch.logs);
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
      (batch.dbQueries?.length ?? 0) +
      (batch.logs?.length ?? 0);

    if (totalItems === 0) return;

    try {
      await fetch(`${this.ingestUrl}/v1/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body: JSON.stringify(batch),
      });
    } catch {
      // Silently drop — SDK should never crash the host app
    }
  }

  setupGracefulShutdown(): void {
    const onShutdown = () => {
      this.flush().catch(() => {});
    };
    process.on("SIGTERM", onShutdown);
    process.on("SIGINT", onShutdown);
    process.on("beforeExit", onShutdown);
  }
}
