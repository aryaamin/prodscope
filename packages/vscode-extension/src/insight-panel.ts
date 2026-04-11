import * as vscode from "vscode";
import type { ExtensionConfig } from "./config";

interface FileStats {
  functions: number;
  totalCalls: number;
  errors: number;
  p99: number;
  sessionReach: number;
  topErrors: Array<{ message: string; count: number; line?: number }>;
  fetchedAt: number;
}

export class InsightPanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private currentInsight = "";
  private currentFile = "";
  private insightLoading = false;
  private statsLoading = false;
  private stats: FileStats | null = null;
  private config: ExtensionConfig | null;
  private log: vscode.LogOutputChannel;

  constructor(config: ExtensionConfig | null, log: vscode.LogOutputChannel) {
    this.config = config;
    this.log = log;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.log.info("Insight panel resolved");
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((msg) => {
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "generate":
          this.refresh();
          break;
        case "refreshStats":
          vscode.commands.executeCommand("prodscope.refreshStats");
          break;
        case "tool":
          if (msg.name === "briefing") vscode.commands.executeCommand("prodscope.briefing");
          else if (msg.name === "suggestFix") vscode.commands.executeCommand("prodscope.suggestFix");
          else if (msg.name === "priorityQueue") vscode.commands.executeCommand("prodscope.priorityQueue");
          else if (msg.name === "traceSymptom") vscode.commands.executeCommand("prodscope.traceSymptom");
          break;
      }
    });
    this.render();
  }

  /** Called when switching to a new file — load stats and cached insight. */
  async updateForFile(filePath: string): Promise<void> {
    if (!this.config) return;
    this.currentFile = filePath;
    this.currentInsight = "";
    this.stats = null;
    this.render();

    // Fetch both in parallel — stats are always displayed, insight is optional.
    await Promise.all([this.loadStats(filePath), this.loadCachedInsight(filePath)]);
    this.render();
  }

  /** Public: re-fetch stats for the current file (called by refreshStats command). */
  async updateStats(filePath: string): Promise<void> {
    if (!this.config) return;
    if (filePath) this.currentFile = filePath;
    await this.loadStats(this.currentFile);
    this.render();
  }

  private async loadStats(filePath: string): Promise<void> {
    if (!this.config || !filePath) return;
    this.statsLoading = true;
    this.render();

    try {
      const headers = { "x-api-key": this.config.apiKey };
      const [statsRes, errorsRes] = await Promise.all([
        fetch(`${this.config.apiUrl}/api/v1/function-stats?file=${encodeURIComponent(filePath)}&window=1h`, { headers }),
        fetch(`${this.config.apiUrl}/api/v1/errors?file=${encodeURIComponent(filePath)}&limit=200`, { headers }),
      ]);

      let statsRows: any[] = [];
      if (statsRes.ok) {
        const data: any = await statsRes.json();
        statsRows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      }

      let errorRows: any[] = [];
      if (errorsRes.ok) {
        const data: any = await errorsRes.json();
        errorRows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      }

      const totalCalls = statsRows.reduce((sum, s) => sum + (s.call_count ?? 0), 0);
      const p99 = statsRows.reduce((m, s) => Math.max(m, s.p99_ms ?? 0), 0);
      const sessionReach = statsRows.reduce((m, s) => Math.max(m, s.session_reach_pct ?? 0), 0);

      // Top errors by frequency
      const errGroups = new Map<string, { message: string; count: number; line?: number }>();
      for (const e of errorRows) {
        const key = `${e.message}::${e.line ?? 0}`;
        const existing = errGroups.get(key);
        if (existing) existing.count++;
        else errGroups.set(key, { message: e.message, count: 1, line: e.line });
      }
      const topErrors = Array.from(errGroups.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      this.stats = {
        functions: statsRows.length,
        totalCalls,
        errors: errorRows.length,
        p99,
        sessionReach,
        topErrors,
        fetchedAt: Date.now(),
      };
    } catch (err: any) {
      this.log.error(`Stats fetch failed: ${err.message}`);
    } finally {
      this.statsLoading = false;
    }
  }

  private async loadCachedInsight(filePath: string): Promise<void> {
    if (!this.config) return;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(
        `${this.config.apiUrl}/api/v1/ai-insight?file=${encodeURIComponent(filePath)}`,
        { headers: { "x-api-key": this.config.apiKey }, signal: controller.signal },
      );
      clearTimeout(timeout);
      if (res.ok) {
        const data: any = await res.json();
        this.currentInsight = data.insight ?? "";
      }
    } catch (err: any) {
      this.log.error(`Insight fetch failed: ${err.message}`);
    }
  }

  async refresh(): Promise<void> {
    if (!this.config || !this.currentFile) return;
    this.insightLoading = true;
    this.render();

    const url = `${this.config.apiUrl}/api/v1/ai-insight?file=${encodeURIComponent(this.currentFile)}&refresh=true`;
    this.log.info(`Insight refresh: ${url}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(url, {
        headers: { "x-api-key": this.config.apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data: any = await res.json();
        this.currentInsight = data.insight ?? "No insight available.";
      } else {
        this.currentInsight = `Refresh failed: ${res.status}`;
      }
    } catch (err: any) {
      this.log.error(`Insight refresh failed: ${err.message}`);
      this.currentInsight = `Refresh error: ${err.message}`;
    }

    this.insightLoading = false;
    this.render();
  }

  private render(): void {
    if (!this.view) return;

    const fileName = this.currentFile
      ? (this.currentFile.split("/").pop() ?? this.currentFile)
      : "";

    this.view.webview.html = `<!DOCTYPE html>
<html>
<head>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
    line-height: 1.55;
  }

  /* Hero header */
  .hero {
    padding: 14px 14px 10px;
    border-bottom: 1px solid rgba(61, 220, 132, 0.12);
    background: linear-gradient(180deg, rgba(61, 220, 132, 0.06), rgba(61, 220, 132, 0.01));
  }
  .hero-row { display: flex; align-items: center; gap: 8px; }
  .ai-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #3ddc84;
    box-shadow: 0 0 8px rgba(61, 220, 132, 0.7);
    animation: dotPulse 2s ease-in-out infinite;
  }
  @keyframes dotPulse { 0%,100% { opacity: 0.75; } 50% { opacity: 1; } }
  .hero-label {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em;
    color: #3ddc84; font-weight: 700;
  }
  .hero-file {
    margin-left: auto;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family);
  }
  .hero-title {
    margin-top: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  .hero-subtitle {
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground);
    margin-top: 2px;
  }

  /* Section header */
  .section-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px 6px;
  }
  .section-title {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--vscode-descriptionForeground);
    font-weight: 700;
  }
  .icon-btn {
    background: transparent;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .icon-btn:hover { background: rgba(255,255,255,0.06); color: var(--vscode-foreground); }

  /* Stat grid */
  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 0 14px 4px;
  }
  .stat-card {
    padding: 8px 10px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 5px;
  }
  .stat-value {
    font-size: 15px;
    font-weight: 700;
    color: var(--vscode-foreground);
    font-family: var(--vscode-editor-font-family);
  }
  .stat-value--error { color: #f47067; }
  .stat-value--hot { color: #fbbf24; }
  .stat-label {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
    margin-top: 2px;
  }

  .empty-stats {
    padding: 8px 14px 4px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  /* Top errors list */
  .top-errors { padding: 4px 14px 8px; display: flex; flex-direction: column; gap: 4px; }
  .err-row {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px;
    background: rgba(244, 112, 103, 0.06);
    border: 1px solid rgba(244, 112, 103, 0.18);
    border-radius: 4px;
    font-size: 10.5px;
  }
  .err-count {
    flex-shrink: 0;
    font-weight: 700;
    color: #f47067;
    font-family: var(--vscode-editor-font-family);
  }
  .err-msg {
    flex: 1;
    color: var(--vscode-foreground);
    opacity: 0.9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .err-line {
    flex-shrink: 0;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family);
    font-size: 9.5px;
  }

  /* AI tool buttons */
  .tool-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 0 14px 12px;
  }
  .tool-btn {
    display: flex; flex-direction: column; gap: 3px;
    padding: 9px 10px;
    background: rgba(61, 220, 132, 0.04);
    border: 1px solid rgba(61, 220, 132, 0.22);
    border-radius: 5px;
    color: var(--vscode-foreground);
    cursor: pointer;
    text-align: left;
    font-family: var(--vscode-font-family);
    transition: all 0.12s;
  }
  .tool-btn:hover {
    background: rgba(61, 220, 132, 0.1);
    border-color: rgba(61, 220, 132, 0.45);
  }
  .tool-btn-title {
    font-size: 11px;
    font-weight: 600;
    color: #3ddc84;
  }
  .tool-btn-desc {
    font-size: 9.5px;
    color: var(--vscode-descriptionForeground);
    line-height: 1.4;
  }

  /* Insight body */
  .insight-body { padding: 6px 14px 12px; display: flex; flex-direction: column; gap: 8px; }
  .ai-line {
    display: flex; flex-direction: column; gap: 6px;
    padding: 10px 12px;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
  }
  .ai-line-tag {
    font-size: 8px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.1em;
    padding: 2px 7px; border-radius: 100px;
    align-self: flex-start;
  }
  .ai-line-tag--grey { color: #999; background: rgba(153,153,153,0.1); border: 1px solid rgba(153,153,153,0.25); }
  .ai-line-tag--red  { color: #f47067; background: rgba(244,112,103,0.1); border: 1px solid rgba(244,112,103,0.3); }
  .ai-line-tag--blue { color: #5b9af5; background: rgba(91,154,245,0.1); border: 1px solid rgba(91,154,245,0.3); }
  .ai-line-tag--green{ color: #3ddc84; background: rgba(61,220,132,0.1); border: 1px solid rgba(61,220,132,0.3); }
  .ai-line-content { font-size: 11.5px; line-height: 1.65; color: var(--vscode-foreground); opacity: 0.88; }
  .ai-line-content p { margin: 0 0 4px 0; }
  .ai-line-content p:last-child { margin-bottom: 0; }
  .ai-line-content strong { color: var(--vscode-foreground); font-weight: 600; opacity: 1; }
  .ai-line-content code {
    font-family: var(--vscode-editor-font-family); font-size: 10.5px;
    padding: 1px 4px; background: rgba(255,255,255,0.07);
    color: #e8b761; border-radius: 3px;
  }
  .ai-line-content pre {
    margin: 6px 0 0 0; padding: 8px 10px;
    background: rgba(0,0,0,0.25); border-radius: 4px;
    overflow-x: auto;
  }
  .ai-line-content pre code { background: none; padding: 0; font-size: 10.5px; color: var(--vscode-foreground); }
  .ai-line-content ul, .ai-line-content ol { margin: 4px 0 0 0; padding-left: 16px; }
  .ai-line-content li { margin: 2px 0; }

  .insight-plain {
    padding: 10px 14px; font-size: 11.5px; line-height: 1.65;
  }
  .insight-plain p { margin: 0 0 8px 0; }
  .insight-plain h3 {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
    margin: 12px 0 4px 0; color: var(--vscode-foreground);
  }
  .insight-plain code {
    font-family: var(--vscode-editor-font-family); font-size: 10.5px;
    padding: 1px 4px; background: rgba(255,255,255,0.07); color: #e8b761; border-radius: 3px;
  }

  /* Generate CTA */
  .generate-cta {
    margin: 4px 14px 14px;
    padding: 14px;
    background: rgba(61,220,132,0.04);
    border: 1px dashed rgba(61,220,132,0.3);
    border-radius: 6px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .generate-title { font-size: 11.5px; font-weight: 600; color: var(--vscode-foreground); }
  .generate-desc { font-size: 10.5px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
  .generate-btn {
    align-self: flex-start;
    margin-top: 2px;
    padding: 7px 14px;
    font-size: 11px; font-weight: 600; font-family: var(--vscode-font-family);
    color: #000; background: #3ddc84; border: none; border-radius: 4px; cursor: pointer;
  }
  .generate-btn:hover { background: #5be89a; }

  .regen-row { padding: 4px 14px 12px; display: flex; gap: 6px; }
  .btn-ghost {
    font-family: var(--vscode-font-family); font-size: 10px; font-weight: 500;
    padding: 4px 10px; background: transparent;
    color: var(--vscode-descriptionForeground);
    border: 1px solid rgba(255,255,255,0.12); border-radius: 4px; cursor: pointer;
  }
  .btn-ghost:hover { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.22); color: var(--vscode-foreground); }

  /* Loading */
  .loading-inline {
    display: inline-flex; gap: 3px; align-items: center;
  }
  .loading-inline span {
    width: 4px; height: 4px; border-radius: 50%;
    background: #3ddc84; opacity: 0.3;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .loading-inline span:nth-child(2) { animation-delay: 0.2s; }
  .loading-inline span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes pulse { 0%,80%,100% { opacity: 0.2; transform: scale(0.85); } 40% { opacity: 1; transform: scale(1); } }

  .state-card { padding: 14px; display: flex; flex-direction: column; gap: 8px; }
  .state-icon { font-size: 18px; line-height: 1; }
  .state-title { font-size: 12px; font-weight: 600; color: var(--vscode-foreground); }
  .state-desc { font-size: 11px; color: var(--vscode-descriptionForeground); line-height: 1.5; }
  .state-desc code { font-family: var(--vscode-editor-font-family); background: rgba(255,255,255,0.07); padding: 1px 4px; border-radius: 3px; }
  .state-link { font-size: 11px; color: #5b9af5; text-decoration: none; margin-top: 4px; }
  .state-link:hover { text-decoration: underline; }
</style>
</head>
<body>
  ${this.renderHero(fileName)}
  ${this.renderContent(fileName)}
  <script>const vscode = acquireVsCodeApi();</script>
</body>
</html>`;
  }

  private renderHero(fileName: string): string {
    return `<div class="hero">
      <div class="hero-row">
        <div class="ai-dot"></div>
        <span class="hero-label">prodscope ai · claude</span>
        ${fileName ? `<span class="hero-file">${escapeHtml(fileName)}</span>` : ""}
      </div>
      <div class="hero-title">Production intelligence, native in your editor.</div>
      <div class="hero-subtitle">Live telemetry, AI analysis, and fix suggestions mapped to the code you're looking at.</div>
    </div>`;
  }

  private renderContent(fileName: string): string {
    if (!this.config) {
      return `<div class="state-card">
        <div class="state-icon">⚠</div>
        <div class="state-title">ProdScope not configured</div>
        <div class="state-desc">This project doesn't have a <code>prodscope.config.ts</code> file. Add ProdScope to your app to see live production insights here.</div>
        <a class="state-link" href="https://prodscope.dev/docs/quickstart">Get started →</a>
      </div>`;
    }

    if (!fileName) {
      return `<div class="state-card">
        <div class="state-desc">Open a file tracked by ProdScope to see live production stats and AI insights.</div>
      </div>`;
    }

    return `${this.renderStatsSection()}${this.renderToolsSection()}${this.renderInsightSection(fileName)}`;
  }

  private renderStatsSection(): string {
    const head = `<div class="section-head">
      <span class="section-title">live stats · last 1h</span>
      <button class="icon-btn" title="Reload stats" onclick="vscode.postMessage({type:'refreshStats'})">
        ${this.statsLoading ? '<span class="loading-inline"><span></span><span></span><span></span></span>' : "↻ reload"}
      </button>
    </div>`;

    if (!this.stats) {
      return `${head}<div class="empty-stats">${this.statsLoading ? "Loading…" : "No telemetry yet for this file."}</div>`;
    }

    const s = this.stats;
    const topErrorsHtml = s.topErrors.length > 0
      ? `<div class="top-errors">${s.topErrors.map((e) => `
          <div class="err-row" title="${escapeHtml(e.message)}">
            <span class="err-count">${e.count}×</span>
            <span class="err-msg">${escapeHtml(e.message)}</span>
            ${e.line ? `<span class="err-line">L${e.line}</span>` : ""}
          </div>`).join("")}</div>`
      : "";

    return `${head}
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-value">${fmtNum(s.totalCalls)}</div><div class="stat-label">calls · ${s.functions} fns</div></div>
        <div class="stat-card"><div class="stat-value ${s.errors > 0 ? "stat-value--error" : ""}">${fmtNum(s.errors)}</div><div class="stat-label">errors</div></div>
        <div class="stat-card"><div class="stat-value stat-value--hot">${s.p99.toFixed(0)}ms</div><div class="stat-label">p99 latency</div></div>
        <div class="stat-card"><div class="stat-value">${s.sessionReach.toFixed(0)}%</div><div class="stat-label">session reach</div></div>
      </div>
      ${topErrorsHtml}`;
  }

  private renderToolsSection(): string {
    return `<div class="section-head"><span class="section-title">ai tools</span></div>
    <div class="tool-grid">
      <button class="tool-btn" onclick="vscode.postMessage({type:'tool',name:'briefing'})">
        <span class="tool-btn-title">◆ Briefing</span>
        <span class="tool-btn-desc">Prod context before you edit this file</span>
      </button>
      <button class="tool-btn" onclick="vscode.postMessage({type:'tool',name:'suggestFix'})">
        <span class="tool-btn-title">✦ Suggest fix</span>
        <span class="tool-btn-desc">AI-proposed fix from real errors</span>
      </button>
      <button class="tool-btn" onclick="vscode.postMessage({type:'tool',name:'priorityQueue'})">
        <span class="tool-btn-title">≡ Priority queue</span>
        <span class="tool-btn-desc">What to fix next, ranked by impact</span>
      </button>
      <button class="tool-btn" onclick="vscode.postMessage({type:'tool',name:'traceSymptom'})">
        <span class="tool-btn-title">⌕ Trace symptom</span>
        <span class="tool-btn-desc">Map a user report to code</span>
      </button>
    </div>`;
  }

  private renderInsightSection(fileName: string): string {
    const head = `<div class="section-head"><span class="section-title">ai insight</span></div>`;

    if (this.insightLoading) {
      return `${head}<div class="state-card">
        <div class="state-desc">Claude is analyzing ${escapeHtml(fileName)}… <span class="loading-inline"><span></span><span></span><span></span></span></div>
      </div>`;
    }

    if (this.currentInsight === "no_api_key") {
      return `${head}<div class="state-card">
        <div class="state-icon">🔑</div>
        <div class="state-title">AI insights not enabled</div>
        <div class="state-desc">Add your Anthropic API key in the ProdScope dashboard to enable AI-generated insights.</div>
        <a class="state-link" href="https://prodscope.dev/settings">Configure →</a>
      </div>`;
    }

    if (this.currentInsight) {
      return `${head}<div class="insight-body">${renderInsightSections(this.currentInsight)}</div>
      <div class="regen-row">
        <button class="btn-ghost" onclick="vscode.postMessage({type:'generate'})">↻ regenerate</button>
      </div>`;
    }

    return `${head}<div class="generate-cta">
      <div class="generate-title">No insight yet for ${escapeHtml(fileName)}</div>
      <div class="generate-desc">Claude will analyze live production telemetry for this file and return a structured insight — root cause, impact, fix.</div>
      <button class="generate-btn" onclick="vscode.postMessage({type:'generate'})">Generate insight</button>
    </div>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function renderInsightSections(md: string): string {
  const parts = md.split(/^### /m).filter(Boolean);
  const sections: Array<{ heading: string; body: string }> = [];

  for (const part of parts) {
    const newline = part.indexOf("\n");
    if (newline === -1) continue;
    const heading = part.slice(0, newline).trim();
    const body = part.slice(newline + 1).trim();
    if (heading) sections.push({ heading, body });
  }

  if (sections.length === 0) {
    return `<div class="insight-plain">${renderMarkdownPlain(md)}</div>`;
  }

  return sections.map(({ heading, body }) => {
    const { tagClass, tagLabel } = resolveTag(heading);
    return `<div class="ai-line">
  <span class="ai-line-tag ${tagClass}">${tagLabel}</span>
  <div class="ai-line-content">${renderBodyContent(body)}</div>
</div>`;
  }).join("\n");
}

function resolveTag(heading: string): { tagClass: string; tagLabel: string } {
  const lower = heading.toLowerCase();
  if (lower.includes("root cause") || lower.includes("cause")) {
    return { tagClass: "ai-line-tag--red", tagLabel: "root cause" };
  }
  if (lower.includes("impact") || lower.includes("affected")) {
    return { tagClass: "ai-line-tag--blue", tagLabel: "impact" };
  }
  if (lower.includes("fix") || lower.includes("suggestion") || lower.includes("action")) {
    return { tagClass: "ai-line-tag--green", tagLabel: "fix" };
  }
  if (lower.includes("summary") || lower.includes("overview")) {
    return { tagClass: "ai-line-tag--grey", tagLabel: "summary" };
  }
  return { tagClass: "ai-line-tag--grey", tagLabel: heading.toLowerCase() };
}

function renderBodyContent(md: string): string {
  const escaped = escapeHtml(md);
  const lines = escaped.split("\n");
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  let codeLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        if (inList) { out.push("</ul>"); inList = false; }
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    if (inList && !line.match(/^\s*[-*\d]/)) {
      out.push("</ul>"); inList = false;
    }

    if (line.match(/^\s*[-*]\s+/)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${applyInline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
    } else if (line.match(/^\s*\d+\.\s+/)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${applyInline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
    } else if (line.trim() === "") {
      // skip
    } else {
      out.push(`<p>${applyInline(line)}</p>`);
    }
  }

  if (inList) out.push("</ul>");
  if (inCode) out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
  return out.join("\n");
}

function renderMarkdownPlain(md: string): string {
  const escaped = escapeHtml(md);
  const lines = escaped.split("\n");
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  let codeLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        if (inList) { out.push("</ul>"); inList = false; }
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    if (inList && !line.match(/^\s*[-*\d]/)) {
      out.push("</ul>"); inList = false;
    }

    if (line.startsWith("### ")) {
      out.push(`<h3>${applyInline(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ") || line.startsWith("# ")) {
      out.push(`<h3>${applyInline(line.replace(/^#+\s+/, ""))}</h3>`);
    } else if (line.match(/^\s*[-*]\s+/)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${applyInline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
    } else if (line.match(/^\s*\d+\.\s+/)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${applyInline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
    } else if (line.match(/^---+$/)) {
      out.push("<hr>");
    } else if (line.trim() === "") {
      // skip
    } else {
      out.push(`<p>${applyInline(line)}</p>`);
    }
  }

  if (inList) out.push("</ul>");
  if (inCode) out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
  return out.join("\n");
}

function applyInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
