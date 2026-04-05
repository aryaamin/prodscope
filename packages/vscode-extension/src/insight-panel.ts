import * as vscode from "vscode";
import type { ExtensionConfig } from "./config.js";

export class InsightPanelProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private currentInsight = "";
  private currentFile = "";
  private config: ExtensionConfig;

  constructor(config: ExtensionConfig) {
    this.config = config;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    this.render();
  }

  async updateForFile(filePath: string): Promise<void> {
    this.currentFile = filePath;

    try {
      const url = new URL("/api/v1/ai-insight", this.config.apiUrl);
      url.searchParams.set("file", filePath);

      const res = await fetch(url.toString(), {
        headers: { "x-api-key": this.config.apiKey },
      });

      if (res.ok) {
        const data = await res.json();
        this.currentInsight = data.insight ?? "No insight available yet.";
      } else {
        this.currentInsight = "Failed to load insight.";
      }
    } catch {
      this.currentInsight = "Unable to connect to ProdScope.";
    }

    this.render();
  }

  async refresh(): Promise<void> {
    if (!this.currentFile) return;

    try {
      const url = new URL("/api/v1/ai-insight", this.config.apiUrl);
      url.searchParams.set("file", this.currentFile);
      url.searchParams.set("refresh", "true");

      const res = await fetch(url.toString(), {
        headers: { "x-api-key": this.config.apiKey },
      });

      if (res.ok) {
        const data = await res.json();
        this.currentInsight = data.insight ?? "No insight available.";
      }
    } catch {
      this.currentInsight = "Unable to refresh insight.";
    }

    this.render();
  }

  private render(): void {
    if (!this.view) return;

    const fileName = this.currentFile
      ? this.currentFile.split("/").pop()
      : "No file selected";

    this.view.webview.html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 12px;
      line-height: 1.6;
    }
    h3 {
      margin: 0 0 8px 0;
      font-size: 13px;
      color: var(--vscode-descriptionForeground);
    }
    .insight {
      white-space: pre-wrap;
      font-size: 12px;
    }
    .empty {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
  </style>
</head>
<body>
  <h3>${escapeHtml(fileName)}</h3>
  ${
    this.currentInsight
      ? `<div class="insight">${escapeHtml(this.currentInsight)}</div>`
      : '<div class="empty">Open a file with ProdScope tracking to see AI insights.</div>'
  }
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
