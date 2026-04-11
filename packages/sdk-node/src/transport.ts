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

    this.ensureFlushScheduled();
  }

  private ensureFlushScheduled(): void {
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), 2000);
    }
  }

  private mergeBatchIntoQueue(batch: IngestBatch): void {
    if (batch.spans?.length)
      this.queue.spans = batch.spans.concat(this.queue.spans ?? []);
    if (batch.errors?.length)
      this.queue.errors = batch.errors.concat(this.queue.errors ?? []);
    if (batch.dbQueries?.length)
      this.queue.dbQueries = batch.dbQueries.concat(this.queue.dbQueries ?? []);
    if (batch.logs?.length) this.queue.logs = batch.logs.concat(this.queue.logs ?? []);
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

    const url = `${this.ingestUrl}/v1/ingest`;
    const headers = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
    };
    const body = JSON.stringify(batch);

    try {
      let res = await fetch(url, { method: "POST", headers, body });

      if (res.status === 429) {
        const retryAfter = Number.parseInt(res.headers.get("Retry-After") ?? "5", 10);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        res = await fetch(url, { method: "POST", headers, body });
      }

      if (!res.ok) {
        this.mergeBatchIntoQueue(batch);
        this.ensureFlushScheduled();
      }
    } catch {
      this.mergeBatchIntoQueue(batch);
      this.ensureFlushScheduled();
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
