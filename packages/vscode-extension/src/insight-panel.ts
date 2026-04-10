import * as vscode from "vscode";
import type { ExtensionConfig } from "./config";

export class InsightPanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private currentInsight = "";
  private currentFile = "";
  private loading = false;
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
      if (msg?.type === "generate") {
        this.refresh();
      }
    });
    this.render();
  }

  async updateForFile(filePath: string): Promise<void> {
    if (!this.config) return;

    this.currentFile = filePath;
    this.currentInsight = "";
    this.loading = true;
    this.render();

    const url = `${this.config.apiUrl}/api/v1/ai-insight?file=${encodeURIComponent(filePath)}`;
    this.log.info(`Insight fetch: ${url}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, {
        headers: { "x-api-key": this.config.apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      this.log.info(`Insight response: ${res.status}`);

      if (res.ok) {
        const data = await res.json() as any;
        this.log.info(`Insight data: ${JSON.stringify(data).slice(0, 200)}`);
        this.currentInsight = data.insight ?? "";
      } else {
        const body = await res.text();
        this.log.error(`Insight error response: ${res.status} ${body}`);
        this.currentInsight = `API returned ${res.status}. Check collector logs.`;
      }
    } catch (err: any) {
      this.log.error(`Insight fetch failed: ${err.message}`);
      this.currentInsight = `Error: ${err.message}`;
    }

    this.loading = false;
    this.render();
  }

  async refresh(): Promise<void> {
    if (!this.config || !this.currentFile) return;

    this.loading = true;
    this.render();

    const url = `${this.config.apiUrl}/api/v1/ai-insight?file=${encodeURIComponent(this.currentFile)}&refresh=true`;
    this.log.info(`Insight refresh: ${url}`);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, {
        headers: { "x-api-key": this.config.apiKey },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json() as any;
        this.currentInsight = data.insight ?? "No insight available.";
      } else {
        this.currentInsight = `Refresh failed: ${res.status}`;
      }
    } catch (err: any) {
      this.log.error(`Insight refresh failed: ${err.message}`);
      this.currentInsight = `Refresh error: ${err.message}`;
    }

    this.loading = false;
    this.render();
  }

  private render(): void {
    if (!this.view) return;

    const fileName = this.currentFile
      ? (this.currentFile.split("/").pop() ?? this.currentFile)
      : "";

    let body: string;
    if (!this.config) {
      body = `<div class="state-card">
        <div class="state-icon">⚠</div>
        <div class="state-title">ProdScope not configured</div>
        <div class="state-desc">This project doesn't have a <code>prodscope.config.ts</code> file. Add ProdScope to your app to see live production insights here.</div>
        <a class="state-link" href="https://prodscope.dev/docs/quickstart">Get started →</a>
      </div>`;
    } else if (this.loading) {
      body = `<div class="loading-state">
        <div class="loading-dots"><span></span><span></span><span></span></div>
        <div class="loading-label">Claude is analyzing ${escapeHtml(fileName)}…</div>
      </div>`;
    } else if (this.currentInsight === "no_api_key") {
      body = `<div class="state-card">
        <div class="state-icon">🔑</div>
        <div class="state-title">AI insights not enabled</div>
        <div class="state-desc">Add your Anthropic API key in the ProdScope dashboard to enable AI-generated insights.</div>
        <a class="state-link" href="https://prodscope.dev/settings">Configure →</a>
      </div>`;
    } else if (this.currentInsight) {
      body = `<div class="insight-body">${renderInsightSections(this.currentInsight)}</div>
      <div class="action-row">
        <button class="btn-ghost" onclick="vscode.postMessage({type:'generate'})">↻ regenerate</button>
      </div>`;
    } else if (fileName) {
      body = `<div class="generate-cta">
        <div class="generate-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div class="generate-title">No insight yet for ${escapeHtml(fileName)}</div>
        <div class="generate-desc">Generated on demand — Claude analyzes live production telemetry for this file.</div>
        <button class="generate-btn" onclick="vscode.postMessage({type:'generate'})">Generate insight</button>
      </div>`;
    } else {
      body = `<div class="state-card">
        <div class="state-desc">Open a file tracked by ProdScope to see AI insights.</div>
      </div>`;
    }

    this.view.webview.html = `<!DOCTYPE html>
<html>
<head>
  <style>
    *, *::before, *::after { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: transparent;
      line-height: 1.6;
    }

    /* ── Panel header bar ── */
    .panel-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(61, 220, 132, 0.15);
      background: rgba(61, 220, 132, 0.04);
    }

    .ai-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #3ddc84;
      flex-shrink: 0;
      box-shadow: 0 0 6px rgba(61, 220, 132, 0.6);
    }

    .panel-bar-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #3ddc84;
      font-weight: 600;
    }

    .panel-bar-file {
      margin-left: auto;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.7;
      text-transform: none;
      letter-spacing: 0;
    }

    /* ── Section cards (ai-line style) ── */
    .insight-body {
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .ai-line {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 6px;
    }

    .ai-line-tag {
      font-size: 8px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      padding: 2px 7px;
      border-radius: 100px;
      align-self: flex-start;
    }

    .ai-line-tag--grey {
      color: #999;
      background: rgba(153, 153, 153, 0.1);
      border: 1px solid rgba(153, 153, 153, 0.25);
    }

    .ai-line-tag--red {
      color: #f47067;
      background: rgba(244, 112, 103, 0.1);
      border: 1px solid rgba(244, 112, 103, 0.3);
    }

    .ai-line-tag--blue {
      color: #5b9af5;
      background: rgba(91, 154, 245, 0.1);
      border: 1px solid rgba(91, 154, 245, 0.3);
    }

    .ai-line-tag--green {
      color: #3ddc84;
      background: rgba(61, 220, 132, 0.1);
      border: 1px solid rgba(61, 220, 132, 0.3);
    }

    .ai-line-content {
      font-size: 11.5px;
      line-height: 1.65;
      color: var(--vscode-foreground);
      opacity: 0.88;
    }

    .ai-line-content p {
      margin: 0 0 4px 0;
    }

    .ai-line-content p:last-child { margin-bottom: 0; }

    .ai-line-content strong {
      color: var(--vscode-foreground);
      font-weight: 600;
      opacity: 1;
    }

    .ai-line-content code {
      font-family: var(--vscode-editor-font-family);
      font-size: 10.5px;
      padding: 1px 4px;
      background: rgba(255, 255, 255, 0.07);
      color: #e8b761;
      border-radius: 3px;
    }

    .ai-line-content pre {
      margin: 6px 0 0 0;
      padding: 8px 10px;
      background: rgba(0, 0, 0, 0.25);
      border-radius: 4px;
      overflow-x: auto;
    }

    .ai-line-content pre code {
      background: none;
      padding: 0;
      font-size: 10.5px;
      color: var(--vscode-foreground);
    }

    .ai-line-content ul, .ai-line-content ol {
      margin: 4px 0 0 0;
      padding-left: 16px;
    }

    .ai-line-content li { margin: 2px 0; }

    /* ── Fallback: plain insight (no sections detected) ── */
    .insight-plain {
      padding: 10px 12px;
      font-size: 11.5px;
      line-height: 1.65;
      color: var(--vscode-foreground);
    }

    .insight-plain p { margin: 0 0 8px 0; }
    .insight-plain h3 {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin: 12px 0 4px 0;
      color: var(--vscode-foreground);
    }
    .insight-plain code {
      font-family: var(--vscode-editor-font-family);
      font-size: 10.5px;
      padding: 1px 4px;
      background: rgba(255, 255, 255, 0.07);
      color: #e8b761;
      border-radius: 3px;
    }

    /* ── Bottom action row ── */
    .action-row {
      padding: 6px 12px 10px;
      display: flex;
      gap: 8px;
    }

    .btn-ghost {
      font-family: var(--vscode-font-family);
      font-size: 10px;
      font-weight: 500;
      padding: 4px 10px;
      background: transparent;
      color: var(--vscode-descriptionForeground);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      cursor: pointer;
    }

    .btn-ghost:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.2);
    }

    /* ── Generate CTA ── */
    .generate-cta {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 16px 12px;
    }

    .generate-icon {
      color: #3ddc84;
      opacity: 0.7;
      line-height: 1;
    }

    .generate-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .generate-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }

    .generate-btn {
      margin-top: 4px;
      padding: 6px 14px;
      font-size: 11px;
      font-weight: 600;
      font-family: var(--vscode-font-family);
      color: #000;
      background: #3ddc84;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    .generate-btn:hover { background: #5be89a; }

    /* ── Loading state ── */
    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 28px 12px;
    }

    .loading-dots {
      display: flex;
      gap: 5px;
    }

    .loading-dots span {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #3ddc84;
      opacity: 0.3;
      animation: pulse 1.2s ease-in-out infinite;
    }

    .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
    .loading-dots span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes pulse {
      0%, 80%, 100% { opacity: 0.2; transform: scale(0.85); }
      40% { opacity: 1; transform: scale(1); }
    }

    .loading-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    /* ── Generic state card ── */
    .state-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px 12px;
    }

    .state-icon { font-size: 18px; line-height: 1; }

    .state-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .state-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }

    .state-desc code {
      font-family: var(--vscode-editor-font-family);
      background: rgba(255, 255, 255, 0.07);
      padding: 1px 4px;
      border-radius: 3px;
    }

    .state-link {
      font-size: 11px;
      color: #5b9af5;
      text-decoration: none;
      margin-top: 4px;
    }

    .state-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="panel-bar">
    <div class="ai-dot"></div>
    <span class="panel-bar-label">ai insight · claude</span>
    ${fileName ? `<span class="panel-bar-file">${escapeHtml(fileName)}</span>` : ""}
  </div>
  ${body}
  <script>const vscode = acquireVsCodeApi();</script>
</body>
</html>`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Detect the structured ### Section format emitted by the updated prompt
 * and render each section as a colored .ai-line card.
 * Falls back to plain markdown rendering if no sections are found.
 */
function renderInsightSections(md: string): string {
  // Split by H3 headings
  const parts = md.split(/^### /m).filter(Boolean);

  // If the prompt emitted structured sections, parts[0] is preamble (usually empty)
  const sections: Array<{ heading: string; body: string }> = [];

  for (const part of parts) {
    const newline = part.indexOf("\n");
    if (newline === -1) continue;
    const heading = part.slice(0, newline).trim();
    const body = part.slice(newline + 1).trim();
    if (heading) sections.push({ heading, body });
  }

  if (sections.length === 0) {
    // No structured sections — fall back to plain render
    return `<div class="insight-plain">${renderMarkdownPlain(md)}</div>`;
  }

  return sections.map(({ heading, body }) => {
    const { tagClass, tagLabel } = resolveTag(heading);
    const contentHtml = renderBodyContent(body);
    return `<div class="ai-line">
  <span class="ai-line-tag ${tagClass}">${tagLabel}</span>
  <div class="ai-line-content">${contentHtml}</div>
</div>`;
  }).join("\n");
}

/** Map known section heading names to tag color classes. */
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

/** Render a section body: handles code blocks, paragraphs, lists, inline formatting. */
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
      // skip blank lines inside a card
    } else {
      out.push(`<p>${applyInline(line)}</p>`);
    }
  }

  if (inList) out.push("</ul>");
  if (inCode) out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
  return out.join("\n");
}

/** Plain markdown fallback for unstructured responses. */
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
