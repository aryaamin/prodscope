import * as vscode from "vscode";
import { loadConfig } from "./config.js";
import { WebSocketClient } from "./websocket-client.js";
import { ProdScopeCodeLensProvider } from "./codelens-provider.js";
import { applyDecorations, clearDecorations, type LineAnnotation } from "./decorations.js";
import { InsightPanelProvider } from "./insight-panel.js";

let wsClient: WebSocketClient | null = null;

export function activate(context: vscode.ExtensionContext) {
  const config = loadConfig();
  if (!config) {
    vscode.window.showWarningMessage(
      "ProdScope: No prodscope.config.ts found in workspace.",
    );
    return;
  }

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.text = "$(radio-tower) ProdScope";
  statusBar.color = "#71717a";
  statusBar.tooltip = "ProdScope: Connecting...";
  statusBar.command = "prodscope.connect";
  statusBar.show();
  context.subscriptions.push(statusBar);

  // CodeLens provider
  const codeLensProvider = new ProdScopeCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: "file", language: "*" },
      codeLensProvider,
    ),
  );

  // AI Insight sidebar
  const insightProvider = new InsightPanelProvider(config);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "prodscope.insight",
      insightProvider,
    ),
  );

  // WebSocket client
  wsClient = new WebSocketClient(config, statusBar);

  wsClient.onEvent((event) => {
    if (event.type === "spans" || event.type === "errors") {
      refreshActiveEditor(config, codeLensProvider);
    }
  });

  // Connect
  wsClient.connect();

  // Update decorations and insights when active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        refreshEditor(editor, config, codeLensProvider);
        insightProvider.updateForFile(editor.document.uri.fsPath);
      }
    }),
  );

  // Refresh on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      refreshActiveEditor(config, codeLensProvider);
    }),
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("prodscope.connect", () => {
      wsClient?.connect();
    }),
    vscode.commands.registerCommand("prodscope.disconnect", () => {
      wsClient?.disconnect();
    }),
    vscode.commands.registerCommand("prodscope.refreshInsight", () => {
      insightProvider.refresh();
    }),
  );

  // Initial refresh
  if (vscode.window.activeTextEditor) {
    refreshEditor(
      vscode.window.activeTextEditor,
      config,
      codeLensProvider,
    );
    insightProvider.updateForFile(
      vscode.window.activeTextEditor.document.uri.fsPath,
    );
  }
}

async function refreshActiveEditor(
  config: { apiUrl: string; apiKey: string },
  codeLensProvider: ProdScopeCodeLensProvider,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    await refreshEditor(editor, config, codeLensProvider);
  }
}

async function refreshEditor(
  editor: vscode.TextEditor,
  config: { apiUrl: string; apiKey: string },
  codeLensProvider: ProdScopeCodeLensProvider,
): Promise<void> {
  const filePath = editor.document.uri.fsPath;

  try {
    // Fetch function stats for this file
    const statsUrl = new URL("/api/v1/function-stats", config.apiUrl);
    statsUrl.searchParams.set("file", filePath);
    statsUrl.searchParams.set("window", "1h");

    const statsRes = await fetch(statsUrl.toString(), {
      headers: { "x-api-key": config.apiKey },
    });

    if (statsRes.ok) {
      const stats = await statsRes.json();
      codeLensProvider.updateStats(filePath, stats);
    }

    // Fetch errors for decorations
    const errorsUrl = new URL("/api/v1/errors", config.apiUrl);
    errorsUrl.searchParams.set("file", filePath);
    errorsUrl.searchParams.set("limit", "100");

    const errorsRes = await fetch(errorsUrl.toString(), {
      headers: { "x-api-key": config.apiKey },
    });

    const annotations: LineAnnotation[] = [];

    if (errorsRes.ok) {
      const errors = await errorsRes.json();

      // Group errors by line
      const errorsByLine = new Map<number, { count: number; message: string; userAgents: Set<string> }>();
      for (const err of errors) {
        const existing = errorsByLine.get(err.line);
        if (existing) {
          existing.count++;
          if (err.user_agent) existing.userAgents.add(simplifyUA(err.user_agent));
        } else {
          const uas = new Set<string>();
          if (err.user_agent) uas.add(simplifyUA(err.user_agent));
          errorsByLine.set(err.line, { count: 1, message: err.message, userAgents: uas });
        }
      }

      for (const [line, data] of errorsByLine) {
        const uaText = data.userAgents.size > 0
          ? ` (${Array.from(data.userAgents).join(", ")})`
          : "";
        annotations.push({
          line,
          type: "error",
          text: `${data.count} errors${uaText}`,
        });
      }
    }

    // Fetch hot paths for gutter decorations
    if (statsRes.ok) {
      const stats = await statsRes.json();
      for (const stat of stats) {
        if (stat.line && stat.avg_ms > 0) {
          const p99Text = stat.p99_ms ? ` \u00b7 p99 ${stat.p99_ms.toFixed(0)}ms` : "";
          annotations.push({
            line: stat.line,
            type: "hot",
            text: `avg ${stat.avg_ms.toFixed(0)}ms${p99Text}`,
          });
        }
      }
    }

    applyDecorations(editor, annotations);
  } catch {
    clearDecorations(editor);
  }
}

function simplifyUA(ua: string): string {
  if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari/iOS";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  return "Other";
}

export function deactivate() {
  wsClient?.disconnect();
  wsClient = null;
}
