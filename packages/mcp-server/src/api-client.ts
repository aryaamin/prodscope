import type { ProdscopeConfig } from "./config.js";

export class ApiClient {
  private config: ProdscopeConfig;

  constructor(config: ProdscopeConfig) {
    this.config = config;
  }

  private async get(path: string, params: Record<string, string> = {}): Promise<any> {
    const url = new URL(path, this.config.apiUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
      headers: { "x-api-key": this.config.apiKey },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }

    return res.json();
  }

  async getFunctionStats(params: {
    function?: string;
    file?: string;
    window?: string;
  }) {
    return this.get("/api/v1/function-stats", params as Record<string, string>);
  }

  async getErrorsAtLine(params: { file: string; line?: string; limit?: string }) {
    return this.get("/api/v1/errors", params as Record<string, string>);
  }

  async getSlowQueries(params: { threshold?: string; file?: string }) {
    return this.get("/api/v1/slow-queries", params as Record<string, string>);
  }

  async getAiInsight(params: {
    file: string;
    function?: string;
    refresh?: string;
  }) {
    return this.get("/api/v1/ai-insight", params as Record<string, string>);
  }

  async getLiveSessions(params: { route?: string }) {
    return this.get("/api/v1/live-sessions", params as Record<string, string>);
  }

  async getTrace(traceId: string) {
    return this.get(`/api/v1/trace/${traceId}`);
  }

  async getHotPaths(params: { window?: string }) {
    return this.get("/api/v1/hot-paths", params as Record<string, string>);
  }

  async compareDeploys(params: { sha1: string; sha2: string }) {
    return this.get("/api/v1/compare-deploys", params as Record<string, string>);
  }
}
