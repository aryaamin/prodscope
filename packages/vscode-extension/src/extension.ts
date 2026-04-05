import * as vscode from "vscode";
import { loadConfig } from "./config";
import { WebSocketClient } from "./websocket-client";
import { ProdScopeCodeLensProvider } from "./codelens-provider";
import { applyDecorations, clearDecorations, type LineAnnotation } from "./decorations";
import { InsightPanelProvider } from "./insight-panel";

let wsClient: WebSocketClient | null = null;
let workspaceRoot = "";
const log = vscode.window.createOutputChannel("ProdScope", { log: true });

/** Files we've already fetched stats/errors for — skip re-fetching */
const fetchedFiles = new Set<string>();

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
  log.info(`Config loaded: projectId=${config.projectId}, apiUrl=${config.apiUrl}, wsUrl=${config.wsUrl}, workspaceRoot=${workspaceRoot}, apiKey=${config.apiKey ? "set (" + config.apiKey.length + " chars)" : "MISSING"}`);

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  statusBar.text = "$(radio-tower) ProdScope";
  statusBar.color = "#71717a";
  statusBar.tooltip = "ProdScope: Connecting...";
  statusBar.command = "prodscope.refreshAll";
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

  // WebSocket client — just update status bar, don't refetch
  wsClient = new WebSocketClient(config, statusBar);
  wsClient.onEvent((event) => {
    log.info(`WS event: ${event.type}`);
    // No automatic refetch — user can manually refresh
  });
  wsClient.connect();

  // Fetch stats/decorations when a file is opened (first time only)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === "file") {
        const absPath = editor.document.uri.fsPath;
        const relPath = toRelative(absPath);

        if (!fetchedFiles.has(relPath)) {
          log.info(`First open: ${relPath}`);
          refreshEditor(editor, config, codeLensProvider);
          insightProvider.updateForFile(relPath);
          fetchedFiles.add(relPath);
        }
      }
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
    // Manual refresh: re-fetch stats/errors/insight for the current file
    vscode.commands.registerCommand("prodscope.refreshAll", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.scheme === "file") {
        const relPath = toRelative(editor.document.uri.fsPath);
        log.info(`Manual refresh: ${relPath}`);
        fetchedFiles.delete(relPath); // allow re-fetch
        refreshEditor(editor, config, codeLensProvider);
        insightProvider.updateForFile(relPath);
        fetchedFiles.add(relPath);
      }
    }),
  );

  // Initial refresh for already-open file
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor?.document.uri.scheme === "file") {
    const filePath = activeEditor.document.uri.fsPath;
    const relPath = toRelative(filePath);
    log.info(`Initial refresh for: ${filePath}`);
    refreshEditor(activeEditor, config, codeLensProvider);
    insightProvider.updateForFile(relPath);
    fetchedFiles.add(relPath);
  }

  log.info("ProdScope extension activated.");
}

async function refreshEditor(
  editor: vscode.TextEditor,
  config: { apiUrl: string; apiKey: string },
  codeLensProvider: ProdScopeCodeLensProvider,
): Promise<void> {
  const absPath = editor.document.uri.fsPath;
  const filePath = toRelative(absPath);
  log.info(`Fetching data for: ${filePath}`);

  try {
    // Fetch function stats and errors in parallel
    const [statsRes, errorsRes] = await Promise.all([
      fetch(
        `${config.apiUrl}/api/v1/function-stats?file=${encodeURIComponent(filePath)}&window=1h`,
        { headers: { "x-api-key": config.apiKey } },
      ),
      fetch(
        `${config.apiUrl}/api/v1/errors?file=${encodeURIComponent(filePath)}&limit=100`,
        { headers: { "x-api-key": config.apiKey } },
      ),
    ]);

    let stats: any[] = [];
    if (statsRes.ok) {
      stats = await statsRes.json() as any[];
      log.info(`Got ${stats.length} function stats`);
      codeLensProvider.updateStats(absPath, stats);
    }

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

    // Add inline annotations from stats — compact summary per function line
    for (const stat of stats) {
      if (!stat.line || stat.line <= 0) continue;
      const parts: string[] = [];
      parts.push(`${stat.p50_ms?.toFixed(0) ?? stat.avg_ms.toFixed(0)}ms`);
      if (stat.error_count > 0) {
        parts.push(`${stat.error_count} err`);
      }
      if (stat.session_reach_pct > 0) {
        parts.push(`${stat.session_reach_pct.toFixed(0)}% users`);
      }
      annotations.push({
        line: stat.line,
        type: stat.error_count > 0 ? "error" : "hot",
        text: parts.join(" \u00b7 "),
      });
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
