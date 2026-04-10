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

  workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

  // Always register the insight panel — it shows setup instructions when config is missing
  const insightProvider = new InsightPanelProvider(config, log);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "prodscope.insight",
      insightProvider,
    ),
  );

  if (!config) {
    log.warn("No prodscope.config.ts found — insight panel will show setup instructions.");
    return;
  }

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

  // WebSocket client — auto-refresh when new data arrives for the active file
  wsClient = new WebSocketClient(config, statusBar);
  wsClient.onEvent((event) => {
    log.info(`WS event: ${event.type}`);

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") return;

    const relPath = toRelative(editor.document.uri.fsPath);

    // Check if the incoming data relates to the currently open file
    const items: any[] = event.data ?? [];
    const isRelevant = items.some(
      (item: any) => item?.file === relPath || item?.file?.endsWith(relPath),
    );

    if (isRelevant) {
      log.info(`WS: refreshing ${relPath} due to incoming ${event.type}`);
      fetchedFiles.delete(relPath);
      refreshEditor(editor, config, codeLensProvider);
      insightProvider.updateForFile(relPath);
      fetchedFiles.add(relPath);
    }
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

    // Code intelligence commands
    vscode.commands.registerCommand("prodscope.briefing", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const relPath = toRelative(editor.document.uri.fsPath);
      runCodeIntelCommand(config, "pre_edit_briefing", { file: relPath }, `Production Briefing: ${relPath}`);
    }),
    vscode.commands.registerCommand("prodscope.suggestFix", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const relPath = toRelative(editor.document.uri.fsPath);
      runCodeIntelCommand(config, "suggest_fix", { file: relPath }, `Fix Suggestions: ${relPath}`);
    }),
    vscode.commands.registerCommand("prodscope.priorityQueue", () => {
      runCodeIntelCommand(config, "dev_priority_queue", {}, "Developer Priority Queue");
    }),
    vscode.commands.registerCommand("prodscope.traceSymptom", async () => {
      const symptom = await vscode.window.showInputBox({
        prompt: "Describe the user-reported issue",
        placeHolder: "e.g., checkout is slow, login fails on mobile, blank page after signup",
      });
      if (!symptom) return;
      runCodeIntelCommand(config, "trace_symptom", { symptom }, `Tracing: ${symptom}`);
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
    // Fetch function stats and errors in parallel. Be defensive in case
    // Promise.all or the fetch calls return unexpected values.
    let statsRes: any = undefined;
    let errorsRes: any = undefined;
    let statsUrl = `${config.apiUrl}/api/v1/function-stats?file=${encodeURIComponent(filePath)}&window=1h`
    log.info(`Stats fetch: ${statsUrl}`);
    try {
      const results = await Promise.all([
        fetch(
          statsUrl,
          { headers: { "x-api-key": config.apiKey } },
        ),
        fetch(
          `${config.apiUrl}/api/v1/errors?file=${encodeURIComponent(filePath)}&limit=100`,
          { headers: { "x-api-key": config.apiKey } },
        ),
      ]);
      statsRes = results?.[0];
      log.info(`Got this shit0 ${statsRes}`);
      errorsRes = results?.[1];
    } catch (fetchErr: any) {
      log.error(`Parallel fetch failed: ${fetchErr?.message ?? String(fetchErr)}`);
    }

    let stats: any[] = [];
    if (statsRes && typeof statsRes.ok !== "undefined" && statsRes.ok) {
      try {
        const data = await statsRes.json();
        // Backend may return either an array or an object with a `data` array.
        const maybeArray = Array.isArray(data) ? data : (Array.isArray((data as any)?.data) ? (data as any).data : []);
        stats = Array.isArray(maybeArray) ? maybeArray : [];
      } catch (e: any) {
        log.error(`Failed parsing function-stats JSON: ${e?.message ?? String(e)}`);
        stats = [];
      }
      log.info(`Got this shit ${stats}`);
      log.info(`Got ${stats.length} function stats`);
      codeLensProvider.updateStats(absPath, stats);
    } else {
      log.info("No function stats fetched");
    }

    const annotations: LineAnnotation[] = [];

    if (errorsRes && typeof errorsRes.ok !== "undefined" && errorsRes.ok) {
      let errors: any[] = [];
      try {
        const data = await errorsRes.json();
        errors = Array.isArray(data) ? data : [];
      } catch (e: any) {
        log.error(`Failed parsing errors JSON: ${e?.message ?? String(e)}`);
        errors = [];
      }
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

      for (const entry of errorsByLine) {
        // be defensive when destructuring map entries
        const pair = Array.isArray(entry) ? entry : [entry[0], entry[1]];
        const line = pair[0] as number;
        const data = pair[1] as { count: number; message: string; userAgents: Set<string> };
        const uaText = data.userAgents.size > 0
          ? ` (${Array.from(data.userAgents).join(", ")})`
          : "";
        annotations.push({
          line,
          type: "error",
          text: `${data.count} errors${uaText}`,
        });
      }
    } else {
      log.info("No errors fetched");
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

async function runCodeIntelCommand(
  config: { apiUrl: string; apiKey: string },
  type: string,
  body: Record<string, string>,
  title: string,
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    "prodscope.codeIntel",
    title,
    vscode.ViewColumn.Beside,
    { enableScripts: false },
  );

  panel.webview.html = `<html><body style="padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)"><h2>${title}</h2><p>Analyzing production data...</p></body></html>`;

  try {
    const res = await fetch(`${config.apiUrl}/api/v1/code-intel/${type}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      panel.webview.html = `<html><body style="padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)"><h2>${title}</h2><p style="color:var(--vscode-errorForeground)">Error: ${res.status} ${res.statusText}</p></body></html>`;
      return;
    }

    const data = await res.json() as { result?: string };
    const markdown = (data.result ?? "No results.")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/`(.*?)`/g, "<code style='background:var(--vscode-textCodeBlock-background);padding:2px 4px;border-radius:3px'>$1</code>");

    panel.webview.html = `<html><body style="padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);line-height:1.6"><h2>${title}</h2><div>${markdown}</div></body></html>`;
  } catch (err: any) {
    panel.webview.html = `<html><body style="padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)"><h2>${title}</h2><p style="color:var(--vscode-errorForeground)">Failed to connect: ${err.message}</p></body></html>`;
  }
}

export function deactivate() {
  log.info("ProdScope extension deactivating.");
  wsClient?.disconnect();
  wsClient = null;
}
