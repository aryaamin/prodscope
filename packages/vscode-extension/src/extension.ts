import * as vscode from "vscode";
import { loadConfig } from "./config";
import { WebSocketClient } from "./websocket-client";
import { ProdScopeCodeLensProvider } from "./codelens-provider";
import { applyDecorations, clearDecorations, type LineAnnotation } from "./decorations";
import { InsightPanelProvider } from "./insight-panel";

let wsClient: WebSocketClient | null = null;
let workspaceRoot = "";
const log = vscode.window.createOutputChannel("ProdScope", { log: true });

/** Convert absolute file path to workspace-relative path (e.g. "src/quiz.ts") */
function toRelative(absPath: string): string {
  if (workspaceRoot && absPath.startsWith(workspaceRoot)) {
    const rel = absPath.slice(workspaceRoot.length);
    return rel.startsWith("/") ? rel.slice(1) : rel;
  }
  return absPath;
}

export function activate(context: vscode.ExtensionContext) {
  console.log("[ProdScope] activate() called");
  log.info("ProdScope extension activating...");
  log.show(); // Force the output channel to be visible

  const config = loadConfig();
  console.log("[ProdScope] config:", config);
  if (!config) {
    const msg = "ProdScope: No prodscope.config.ts found in workspace.";
    console.error("[ProdScope]", msg);
    log.error(msg);
    vscode.window.showWarningMessage(msg);
    return;
  }

  workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  console.log(`[ProdScope] Config loaded: projectId=${config.projectId}, apiUrl=${config.apiUrl}, apiKey=${config.apiKey ? "present" : "MISSING"}`);
  log.info(`Config loaded: projectId=${config.projectId}, apiUrl=${config.apiUrl}, wsUrl=${config.wsUrl}, workspaceRoot=${workspaceRoot}, apiKey=${config.apiKey ? "set (" + config.apiKey.length + " chars)" : "MISSING"}`);

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
  const insightProvider = new InsightPanelProvider(config, log);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "prodscope.insight",
      insightProvider,
    ),
  );

  // WebSocket client
  wsClient = new WebSocketClient(config, statusBar);

  wsClient.onEvent((event) => {
    log.info(`WS event: ${event.type}`);
    if (event.type === "spans" || event.type === "errors") {
      refreshActiveEditor(config, codeLensProvider);
    }
  });

  // Connect
  wsClient.connect();

  // Update decorations and insights when active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === "file") {
        log.info(`Active editor changed: ${editor.document.uri.fsPath}`);
        refreshEditor(editor, config, codeLensProvider);
        insightProvider.updateForFile(toRelative(editor.document.uri.fsPath));
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
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor?.document.uri.scheme === "file") {
    const filePath = activeEditor.document.uri.fsPath;
    log.info(`Initial refresh for: ${filePath}`);
    refreshEditor(activeEditor, config, codeLensProvider);
    insightProvider.updateForFile(toRelative(filePath));
  }

  log.info("ProdScope extension activated.");
}

async function refreshActiveEditor(
  config: { apiUrl: string; apiKey: string },
  codeLensProvider: ProdScopeCodeLensProvider,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === "file") {
    await refreshEditor(editor, config, codeLensProvider);
  }
}

async function refreshEditor(
  editor: vscode.TextEditor,
  config: { apiUrl: string; apiKey: string },
  codeLensProvider: ProdScopeCodeLensProvider,
): Promise<void> {
  const absPath = editor.document.uri.fsPath;
  const filePath = toRelative(absPath);
  log.info(`Refreshing editor: ${absPath} -> ${filePath}`);

  try {
    // Fetch function stats for this file
    const statsUrl = `${config.apiUrl}/api/v1/function-stats?file=${encodeURIComponent(filePath)}&window=1h`;
    log.info(`Fetching stats: ${statsUrl}`);

    const statsRes = await fetch(statsUrl, {
      headers: { "x-api-key": config.apiKey },
    });
    log.info(`Stats response: ${statsRes.status}`);

    let stats: any[] = [];
    if (statsRes.ok) {
      stats = await statsRes.json() as any[];
      log.info(`Got ${stats.length} function stats`);
      codeLensProvider.updateStats(absPath, stats);
    }

    // Fetch errors for decorations
    const errorsUrl = `${config.apiUrl}/api/v1/errors?file=${encodeURIComponent(filePath)}&limit=100`;
    log.info(`Fetching errors: ${errorsUrl}`);

    const errorsRes = await fetch(errorsUrl, {
      headers: { "x-api-key": config.apiKey },
    });
    log.info(`Errors response: ${errorsRes.status}`);

    const annotations: LineAnnotation[] = [];

    if (errorsRes.ok) {
      const errors = await errorsRes.json() as any[];
      log.info(`Got ${errors.length} errors`);

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

    // Add hot path annotations from stats
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

    log.info(`Applying ${annotations.length} decorations`);
    applyDecorations(editor, annotations);
  } catch (err: any) {
    log.error(`refreshEditor failed: ${err.message}\n${err.stack}`);
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
  log.info("ProdScope extension deactivating.");
  wsClient?.disconnect();
  wsClient = null;
}
