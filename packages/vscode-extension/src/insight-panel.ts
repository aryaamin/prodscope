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
        // Backend returns insight:null + status:"not_generated" on cache miss.
        // We leave currentInsight empty so the UI shows the "Generate" CTA.
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
      body = `<div class="setup">
        <div class="setup-icon">⚠️</div>
        <div class="setup-title">ProdScope not configured</div>
        <div class="setup-desc">This project doesn't have a <code>prodscope.config.ts</code> file. Add ProdScope to your app to see live production insights here.</div>
        <a class="setup-link" href="https://prodscope.dev/docs/quickstart">Get started at prodscope.dev →</a>
      </div>`;
    } else if (this.loading) {
      body = '<div class="empty">Loading insight...</div>';
    } else if (this.currentInsight === "no_api_key") {
      body = `<div class="setup">
        <div class="setup-icon">🔑</div>
        <div class="setup-title">AI insights not enabled</div>
        <div class="setup-desc">Add your Anthropic API key in the ProdScope dashboard to enable AI-generated insights for your production code.</div>
        <a class="setup-link" href="https://prodscope.dev/settings">Configure at prodscope.dev →</a>
      </div>`;
    } else if (this.currentInsight) {
      body = `<div class="insight">${renderMarkdown(this.currentInsight)}</div>`;
    } else if (fileName) {
      body = `<div class="generate">
        <div class="generate-title">No AI insight yet</div>
        <div class="generate-desc">Insights are generated on demand to avoid unnecessary API usage.</div>
        <button class="generate-btn" onclick="vscode.postMessage({type:'generate'})">Generate insight</button>
      </div>`;
    } else {
      body = '<div class="empty">Open a file with ProdScope tracking to see AI insights.</div>';
    }

    this.view.webview.html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 12px 14px;
      line-height: 1.6;
    }
    .file-name {
      margin: 0 0 10px 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
      padding-bottom: 6px;
    }
    .insight { font-size: 12px; }
    .insight h2 {
      font-size: 14px;
      margin: 0 0 8px 0;
      color: var(--vscode-foreground);
    }
    .insight h3 {
      font-size: 12px;
      margin: 12px 0 4px 0;
      color: var(--vscode-foreground);
    }
    .insight p { margin: 4px 0 8px 0; }
    .insight ul, .insight ol {
      margin: 4px 0 8px 0;
      padding-left: 18px;
    }
    .insight li { margin: 2px 0; }
    .insight strong { color: var(--vscode-foreground); }
    .insight code {
      background: var(--vscode-textCodeBlock-background, rgba(255,255,255,0.06));
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
    }
    .insight pre {
      background: var(--vscode-textCodeBlock-background, rgba(255,255,255,0.06));
      padding: 8px 10px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 6px 0 10px 0;
    }
    .insight pre code {
      background: none;
      padding: 0;
      font-size: 11px;
    }
    .insight hr {
      border: none;
      border-top: 1px solid var(--vscode-widget-border, rgba(255,255,255,0.1));
      margin: 10px 0;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    .setup {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .setup-icon { font-size: 20px; }
    .setup-title {
      font-weight: 600;
      font-size: 12px;
      color: var(--vscode-foreground);
    }
    .setup-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }
    .setup-desc code {
      background: var(--vscode-textCodeBlock-background, rgba(255,255,255,0.06));
      padding: 1px 4px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
    }
    .setup-link {
      font-size: 11px;
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      margin-top: 4px;
    }
    .setup-link:hover { text-decoration: underline; }
    .generate {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 4px 0;
    }
    .generate-title {
      font-weight: 600;
      font-size: 12px;
      color: var(--vscode-foreground);
    }
    .generate-desc {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }
    .generate-btn {
      margin-top: 4px;
      padding: 6px 12px;
      font-size: 11px;
      font-family: inherit;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: none;
      border-radius: 2px;
      cursor: pointer;
      align-self: flex-start;
    }
    .generate-btn:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  ${fileName ? `<div class="file-name">${escapeHtml(fileName)}</div>` : ""}
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

/** Simple markdown to HTML — handles headings, bold, code, lists, and paragraphs. */
function renderMarkdown(md: string): string {
  const escaped = escapeHtml(md);
  const lines = escaped.split("\n");
  const out: string[] = [];
  let inList = false;
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (const line of lines) {
    // Code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
        codeLines = [];
        inCodeBlock = false;
      } else {
        if (inList) { out.push("</ul>"); inList = false; }
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Close list if needed
    if (inList && !line.match(/^\s*[-*\d]\s*/)) {
      out.push("</ul>");
      inList = false;
    }

    // Headings
    if (line.startsWith("## ")) {
      out.push(`<h2>${applyInline(line.slice(3))}</h2>`);
    } else if (line.startsWith("### ")) {
      out.push(`<h3>${applyInline(line.slice(4))}</h3>`);
    } else if (line.startsWith("# ")) {
      out.push(`<h2>${applyInline(line.slice(2))}</h2>`);
    }
    // List items
    else if (line.match(/^\s*[-*]\s+/)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${applyInline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
    } else if (line.match(/^\s*\d+\.\s+/)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${applyInline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
    }
    // Horizontal rule
    else if (line.match(/^---+$/)) {
      out.push("<hr>");
    }
    // Empty line
    else if (line.trim() === "") {
      // skip
    }
    // Paragraph
    else {
      out.push(`<p>${applyInline(line)}</p>`);
    }
  }

  if (inList) out.push("</ul>");
  if (inCodeBlock) out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);

  return out.join("\n");
}

/** Apply inline formatting: bold, italic, inline code */
function applyInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
