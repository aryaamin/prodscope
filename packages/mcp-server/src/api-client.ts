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

  async getLogsAtLine(params: {
    file: string;
    line?: string;
    level?: string;
    limit?: string;
  }) {
    return this.get("/api/v1/logs", params as Record<string, string>);
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

  // ─── Trends & Patterns ─────────────────────────────────────────────

  async getFunctionTrend(params: { file: string; function?: string; days?: string }) {
    return this.get("/api/v1/trends/function", params as Record<string, string>);
  }

  async getErrorTrends(params: { file?: string; days?: string }) {
    return this.get("/api/v1/trends/errors", params as Record<string, string>);
  }

  async getQueryTrends(params: { file?: string; days?: string }) {
    return this.get("/api/v1/trends/queries", params as Record<string, string>);
  }

  async getTimeOfDayPattern(params: { file?: string; function?: string }) {
    return this.get("/api/v1/patterns/time-of-day", params as Record<string, string>);
  }

  async getWeekdayWeekendPattern(params: { file?: string; function?: string }) {
    return this.get("/api/v1/patterns/weekday-weekend", params as Record<string, string>);
  }

  async comparePeriods(params: {
    file?: string;
    function?: string;
    period1_start: string;
    period1_end: string;
    period2_start: string;
    period2_end: string;
  }) {
    return this.get("/api/v1/patterns/compare-periods", params as Record<string, string>);
  }

  // ─── AI Analysis ───────────────────────────────────────────────────

  async getAnalysis(type: string) {
    return this.get(`/api/v1/analysis/${type}`);
  }

  async triggerAnalysis(type: string, wait = false) {
    const url = new URL(`/api/v1/analysis/${type}`, this.config.apiUrl);
    if (wait) url.searchParams.set("wait", "true");

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "x-api-key": this.config.apiKey },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }

    return res.json();
  }

  // ─── Code Intelligence ─────────────────────────────────────────────

  async runCodeIntel(type: string, body: Record<string, string | undefined>) {
    const url = new URL(`/api/v1/code-intel/${type}`, this.config.apiUrl);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "x-api-key": this.config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }

    return res.json();
  }
}
