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
    log.info(`WS event: ${event.type} (${Array.isArray(event.data) ? event.data.length : 0} items)`);

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") return;

    const relPath = toRelative(editor.document.uri.fsPath);
    const baseName = relPath.split("/").pop() ?? relPath;

    // Check if the incoming data relates to the currently open file.
    // Be lenient: match on relative path, basename, or absolute path ending.
    const items: any[] = Array.isArray(event.data) ? event.data : [];
    const isRelevant = items.some((item: any) => {
      const f: string | undefined = item?.file;
      if (!f) return false;
      return f === relPath || f.endsWith(relPath) || f.endsWith(baseName) || relPath.endsWith(f);
    });

    if (isRelevant) {
      log.info(`WS: refreshing ${relPath} due to incoming ${event.type}`);
      statusBar.text = "$(sync~spin) ProdScope";
      fetchedFiles.delete(relPath);
      refreshEditor(editor, config, codeLensProvider).finally(() => {
        statusBar.text = "$(radio-tower) ProdScope";
      });
      insightProvider.updateStats(relPath);
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
    // Manual refresh: re-fetch stats/errors for the current file (no AI regen)
    vscode.commands.registerCommand("prodscope.refreshStats", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.scheme === "file") {
        const relPath = toRelative(editor.document.uri.fsPath);
        log.info(`Manual stats refresh: ${relPath}`);
        fetchedFiles.delete(relPath);
        statusBar.text = "$(sync~spin) ProdScope";
        refreshEditor(editor, config, codeLensProvider).finally(() => {
          statusBar.text = "$(radio-tower) ProdScope";
        });
        insightProvider.updateStats(relPath);
        fetchedFiles.add(relPath);
      }
    }),
    // Full refresh: stats + errors + re-fetch insight
    vscode.commands.registerCommand("prodscope.refreshAll", () => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.scheme === "file") {
        const relPath = toRelative(editor.document.uri.fsPath);
        log.info(`Manual refresh: ${relPath}`);
        fetchedFiles.delete(relPath);
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
    const headers = { "x-api-key": config.apiKey };
    const statsUrl = `${config.apiUrl}/api/v1/function-stats?file=${encodeURIComponent(filePath)}&window=1h`;
    const errorsUrl = `${config.apiUrl}/api/v1/errors?file=${encodeURIComponent(filePath)}&limit=200`;
    const logsUrl = `${config.apiUrl}/api/v1/logs?file=${encodeURIComponent(filePath)}&limit=200`;

    const [statsRes, errorsRes, logsRes] = await Promise.all([
      fetch(statsUrl, { headers }).catch((e) => { log.error(`stats fetch failed: ${e?.message}`); return null; }),
      fetch(errorsUrl, { headers }).catch((e) => { log.error(`errors fetch failed: ${e?.message}`); return null; }),
      fetch(logsUrl, { headers }).catch((e) => { log.error(`logs fetch failed: ${e?.message}`); return null; }),
    ]);

    let stats: any[] = [];
    if (statsRes?.ok) {
      try {
        const data: any = await statsRes.json();
        stats = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      } catch (e: any) {
        log.error(`Failed parsing function-stats JSON: ${e?.message ?? String(e)}`);
      }
      // Snap each stat's line to the actual function definition in the current document.
      // Captured lines can be stale (file edited since last build) or off-by-one from the
      // SDK's parser. Scanning for the function name in a small window fixes both.
      for (const stat of stats) {
        const snapped = snapLineToFunction(editor.document, stat.function, stat.line);
        if (snapped > 0) stat.line = snapped;
      }
      log.info(`Got ${stats.length} function stats`);
      codeLensProvider.updateStats(absPath, stats);
    } else {
      log.info(`No function stats fetched (status=${statsRes?.status ?? "n/a"})`);
    }

    const annotations: LineAnnotation[] = [];

    if (errorsRes?.ok) {
      let errors: any[] = [];
      try {
        const data: any = await errorsRes.json();
        // Backend wraps rows in `{data: [...]}` — unwrap.
        errors = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      } catch (e: any) {
        log.error(`Failed parsing errors JSON: ${e?.message ?? String(e)}`);
      }
      log.info(`Got ${errors.length} errors`);

      // Snap error lines too — use the `function` field when available.
      for (const err of errors) {
        const snapped = snapLineToFunction(editor.document, err.function, err.line);
        if (snapped > 0) err.line = snapped;
      }

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

    if (logsRes?.ok) {
      let logs: any[] = [];
      try {
        const data: any = await logsRes.json();
        logs = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
      } catch (e: any) {
        log.error(`Failed parsing logs JSON: ${e?.message ?? String(e)}`);
      }
      log.info(`Got ${logs.length} logs`);

      // Group logs by line. Surface: level mix + count, with a few recent lines in hover.
      const logsByLine = new Map<
        number,
        {
          count: number;
          levels: Record<string, number>;
          recent: Array<{ level: string; message: string; ts: string }>;
        }
      >();
      for (const l of logs) {
        if (!l.line || l.line <= 0) continue;
        const existing = logsByLine.get(l.line);
        if (existing) {
          existing.count++;
          existing.levels[l.level] = (existing.levels[l.level] ?? 0) + 1;
          if (existing.recent.length < 5) {
            existing.recent.push({ level: l.level, message: l.message, ts: l.timestamp });
          }
        } else {
          logsByLine.set(l.line, {
            count: 1,
            levels: { [l.level]: 1 },
            recent: [{ level: l.level, message: l.message, ts: l.timestamp }],
          });
        }
      }

      for (const entry of logsByLine) {
        const line = entry[0] as number;
        const data = entry[1] as {
          count: number;
          levels: Record<string, number>;
          recent: Array<{ level: string; message: string; ts: string }>;
        };
        const levelSummary = Object.entries(data.levels)
          .sort((a, b) => b[1] - a[1])
          .map(([lvl, n]) => `${n} ${lvl}`)
          .join("/");
        annotations.push({
          line,
          type: "log",
          text: `${data.count} logs (${levelSummary})`,
          hoverLines: data.recent.map(
            (r) => `\`[${r.level}]\` ${r.message} — _${r.ts}_`,
          ),
        });
      }
    } else {
      log.info("No logs fetched");
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

/**
 * Snap a reported line number to the actual function definition in the current document.
 *
 * The SDK captures `line` at build time; the user's editor may be newer, and the captured
 * line can also be off-by-one from the "export function" line vs. where CodeLens/decorations
 * look best. We search a window around the captured line for a declaration matching the
 * function name, and if found, use that line instead. Returns 1-based line, or 0 if no match.
 */
function snapLineToFunction(
  doc: vscode.TextDocument,
  fnName: string | undefined,
  capturedLine: number | undefined,
): number {
  if (!fnName || typeof fnName !== "string") return capturedLine ?? 0;
  const lineCount = doc.lineCount;
  if (lineCount === 0) return capturedLine ?? 0;

  // Escape regex metacharacters in fn name.
  const esc = fnName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match: `function foo(`, `const foo =`, `foo:`, `foo(`, method shorthand, class methods.
  const patterns = [
    new RegExp(`\\bfunction\\s+${esc}\\b`),
    new RegExp(`\\bconst\\s+${esc}\\b\\s*=`),
    new RegExp(`\\blet\\s+${esc}\\b\\s*=`),
    new RegExp(`\\b${esc}\\s*[:=]\\s*(async\\s+)?(function\\b|\\()`),
    new RegExp(`(^|\\s)(async\\s+)?${esc}\\s*\\([^)]*\\)\\s*[:{]`),
  ];

  const test = (lineText: string): boolean => patterns.some((re) => re.test(lineText));

  // 1. First check the captured line itself (fast path, common case).
  if (capturedLine && capturedLine > 0 && capturedLine <= lineCount) {
    if (test(doc.lineAt(capturedLine - 1).text)) return capturedLine;
  }

  // 2. Search a window around the captured line (±15 lines), widening outward.
  const anchor = capturedLine && capturedLine > 0 ? capturedLine : 1;
  for (let delta = 1; delta <= 15; delta++) {
    for (const candidate of [anchor - delta, anchor + delta]) {
      if (candidate < 1 || candidate > lineCount) continue;
      if (test(doc.lineAt(candidate - 1).text)) return candidate;
    }
  }

  // 3. Full-document fallback — find the first declaration of this function.
  for (let i = 0; i < lineCount; i++) {
    if (test(doc.lineAt(i).text)) return i + 1;
  }

  return capturedLine ?? 0;
}

function simplifyUA(ua: string): string {
  if (ua.includes("Safari") && !ua.includes("Chrome")) return "Safari/iOS";
  if (ua.includes("Chrome")) return "Chrome";
  if (ua.includes("Firefox")) return "Firefox";
  return "Other";
}

const TOOL_META: Record<string, { label: string; tagline: string; accent: string; icon: string }> = {
  pre_edit_briefing: {
    label: "Pre-edit briefing",
    tagline: "Production context before you touch this file",
    accent: "#5b9af5",
    icon: "◆",
  },
  suggest_fix: {
    label: "Suggest fix",
    tagline: "AI-proposed fix grounded in real errors",
    accent: "#3ddc84",
    icon: "✦",
  },
  dev_priority_queue: {
    label: "Developer priority queue",
    tagline: "Ranked by impact × fixability",
    accent: "#fbbf24",
    icon: "≡",
  },
  trace_symptom: {
    label: "Symptom tracer",
    tagline: "Map a user report to the responsible code",
    accent: "#c084fc",
    icon: "⌕",
  },
  verify_fix: {
    label: "Verify fix",
    tagline: "Did your deploy actually fix the problem?",
    accent: "#3ddc84",
    icon: "✓",
  },
};

async function runCodeIntelCommand(
  config: { apiUrl: string; apiKey: string },
  type: string,
  body: Record<string, string>,
  title: string,
): Promise<void> {
  const meta = TOOL_META[type] ?? { label: title, tagline: "", accent: "#3ddc84", icon: "✦" };
  const subtitle = body.file ? body.file : (body.symptom ? `"${body.symptom}"` : "");

  const panel = vscode.window.createWebviewPanel(
    "prodscope.codeIntel",
    `${meta.icon} ${meta.label}`,
    vscode.ViewColumn.Beside,
    { enableScripts: false, retainContextWhenHidden: true },
  );

  const shell = (inner: string) => codeIntelShell(meta, subtitle, inner);
  panel.webview.html = shell(`
    <div class="loading-block">
      <div class="loading-dots"><span></span><span></span><span></span></div>
      <div class="loading-text">Claude is analyzing production telemetry…</div>
      <div class="loading-sub">Pulling errors, latencies, sessions, and git context.</div>
    </div>
  `);

  try {
    const res = await fetch(`${config.apiUrl}/api/v1/code-intel/${type}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": config.apiKey },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      panel.webview.html = shell(`
        <div class="error-block">
          <div class="error-title">Request failed</div>
          <div class="error-body">${escapeHtmlIntel(`${res.status} ${res.statusText}`)}</div>
        </div>
      `);
      return;
    }

    const data: any = await res.json();
    const resultText: string = data?.result ?? "No results.";

    if (resultText === "no_api_key" || data?.error === "no_api_key") {
      panel.webview.html = shell(`
        <div class="error-block">
          <div class="error-title">🔑 AI not enabled</div>
          <div class="error-body">Add an Anthropic API key in the ProdScope dashboard to enable code intelligence.</div>
          <a class="error-link" href="https://prodscope.dev/settings">Open settings →</a>
        </div>
      `);
      return;
    }

    panel.webview.html = shell(renderIntelMarkdown(resultText));
  } catch (err: any) {
    panel.webview.html = shell(`
      <div class="error-block">
        <div class="error-title">Connection failed</div>
        <div class="error-body">${escapeHtmlIntel(err?.message ?? String(err))}</div>
      </div>
    `);
  }
}

function codeIntelShell(
  meta: { label: string; tagline: string; accent: string; icon: string },
  subtitle: string,
  inner: string,
): string {
  const { label, tagline, accent, icon } = meta;
  return `<!DOCTYPE html>
<html>
<head>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  :root { --accent: ${accent}; }
  body {
    margin: 0;
    padding: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    line-height: 1.6;
  }
  .wrap { max-width: 780px; margin: 0 auto; padding: 28px 32px 60px; }

  .hero {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-bottom: 18px;
    margin-bottom: 22px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .hero-row { display: flex; align-items: center; gap: 10px; }
  .hero-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 10px;
    border-radius: 100px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .hero-badge-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
  }
  .hero-by {
    margin-left: auto;
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .hero-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--vscode-foreground);
    margin-top: 2px;
  }
  .hero-title .tool-icon {
    display: inline-block;
    width: 28px; height: 28px;
    line-height: 28px;
    text-align: center;
    margin-right: 8px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    font-size: 15px;
    vertical-align: middle;
  }
  .hero-tagline {
    font-size: 12.5px;
    color: var(--vscode-descriptionForeground);
  }
  .hero-subtitle {
    margin-top: 4px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family);
    opacity: 0.8;
  }

  /* Section cards (ai-line style) */
  .sections { display: flex; flex-direction: column; gap: 12px; }
  .ai-line {
    padding: 16px 18px;
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
  }
  .ai-line-head {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 10px;
  }
  .ai-line-tag {
    display: inline-block;
    font-size: 9px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.12em;
    padding: 3px 9px;
    border-radius: 100px;
  }
  .ai-line-tag--grey { color: #a1a1aa; background: rgba(161,161,170,0.1); border: 1px solid rgba(161,161,170,0.3); }
  .ai-line-tag--red  { color: #f47067; background: rgba(244,112,103,0.1); border: 1px solid rgba(244,112,103,0.35); }
  .ai-line-tag--blue { color: #5b9af5; background: rgba(91,154,245,0.1); border: 1px solid rgba(91,154,245,0.35); }
  .ai-line-tag--green{ color: #3ddc84; background: rgba(61,220,132,0.1); border: 1px solid rgba(61,220,132,0.35); }
  .ai-line-tag--amber{ color: #fbbf24; background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.35); }
  .ai-line-tag--purple{color: #c084fc; background: rgba(192,132,252,0.1); border: 1px solid rgba(192,132,252,0.35); }

  .ai-line-content {
    font-size: 13px;
    line-height: 1.7;
    color: var(--vscode-foreground);
  }
  .ai-line-content p { margin: 0 0 10px 0; }
  .ai-line-content p:last-child { margin-bottom: 0; }
  .ai-line-content strong { font-weight: 600; }
  .ai-line-content code {
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    padding: 1px 6px;
    background: rgba(255,255,255,0.07);
    color: #e8b761;
    border-radius: 3px;
  }
  .ai-line-content pre {
    margin: 10px 0;
    padding: 12px 14px;
    background: rgba(0,0,0,0.35);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 6px;
    overflow-x: auto;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
  }
  .ai-line-content pre code {
    background: none; padding: 0; color: var(--vscode-foreground);
  }
  .ai-line-content ul, .ai-line-content ol {
    margin: 6px 0 10px 0; padding-left: 22px;
  }
  .ai-line-content li { margin: 4px 0; }
  .ai-line-content a { color: #5b9af5; text-decoration: none; }
  .ai-line-content a:hover { text-decoration: underline; }

  /* Loading */
  .loading-block {
    display: flex; flex-direction: column; align-items: center;
    gap: 14px;
    padding: 60px 20px;
    border: 1px dashed rgba(255,255,255,0.1);
    border-radius: 10px;
  }
  .loading-dots { display: flex; gap: 6px; }
  .loading-dots span {
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--accent);
    opacity: 0.3;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
  .loading-dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes pulse { 0%,80%,100% { opacity: 0.2; transform: scale(0.85); } 40% { opacity: 1; transform: scale(1); } }
  .loading-text { font-size: 13px; font-weight: 600; }
  .loading-sub { font-size: 11px; color: var(--vscode-descriptionForeground); }

  /* Error */
  .error-block {
    padding: 24px; border-radius: 8px;
    background: rgba(244,112,103,0.06);
    border: 1px solid rgba(244,112,103,0.25);
  }
  .error-title { font-size: 14px; font-weight: 700; color: #f47067; margin-bottom: 6px; }
  .error-body { font-size: 12px; color: var(--vscode-foreground); opacity: 0.85; }
  .error-link { display: inline-block; margin-top: 10px; font-size: 12px; color: #5b9af5; text-decoration: none; }
  .error-link:hover { text-decoration: underline; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="hero-row">
        <span class="hero-badge"><span class="hero-badge-dot"></span>prodscope · claude</span>
        <span class="hero-by">AI code intelligence</span>
      </div>
      <div class="hero-title"><span class="tool-icon">${icon}</span>${escapeHtmlIntel(label)}</div>
      <div class="hero-tagline">${escapeHtmlIntel(tagline)}</div>
      ${subtitle ? `<div class="hero-subtitle">${escapeHtmlIntel(subtitle)}</div>` : ""}
    </div>
    ${inner}
  </div>
</body>
</html>`;
}

function renderIntelMarkdown(md: string): string {
  // Parse into H3/H2 sections; wrap each in an ai-line card.
  const trimmed = md.trim();
  const parts = trimmed.split(/^(?:### |## )/m).filter(Boolean);

  if (parts.length === 0) {
    return `<div class="sections"><div class="ai-line"><div class="ai-line-content">${renderIntelBody(trimmed)}</div></div></div>`;
  }

  // If the first chunk has no heading (preamble), render it as a preamble card.
  const sections: Array<{ heading: string; body: string }> = [];
  let preamble = "";

  const firstHasHeading = /^(### |## )/.test(trimmed);
  let startIdx = 0;
  if (!firstHasHeading) {
    // `parts[0]` is the preamble
    preamble = parts[0].trim();
    startIdx = 1;
  }

  for (let i = startIdx; i < parts.length; i++) {
    const part = parts[i];
    const nl = part.indexOf("\n");
    if (nl === -1) {
      sections.push({ heading: part.trim(), body: "" });
    } else {
      sections.push({ heading: part.slice(0, nl).trim(), body: part.slice(nl + 1).trim() });
    }
  }

  const cards: string[] = [];
  if (preamble) {
    cards.push(`<div class="ai-line"><div class="ai-line-content">${renderIntelBody(preamble)}</div></div>`);
  }
  for (const { heading, body } of sections) {
    const { tagClass, tagLabel } = resolveIntelTag(heading);
    cards.push(`<div class="ai-line">
      <div class="ai-line-head"><span class="ai-line-tag ${tagClass}">${escapeHtmlIntel(tagLabel)}</span></div>
      <div class="ai-line-content">${renderIntelBody(body)}</div>
    </div>`);
  }

  return `<div class="sections">${cards.join("")}</div>`;
}

function resolveIntelTag(heading: string): { tagClass: string; tagLabel: string } {
  const lower = heading.toLowerCase();
  if (lower.includes("root cause") || lower.includes("cause") || lower.includes("why")) {
    return { tagClass: "ai-line-tag--red", tagLabel: "root cause" };
  }
  if (lower.includes("impact") || lower.includes("affected") || lower.includes("blast")) {
    return { tagClass: "ai-line-tag--blue", tagLabel: "impact" };
  }
  if (lower.includes("fix") || lower.includes("suggestion") || lower.includes("action") || lower.includes("recommend")) {
    return { tagClass: "ai-line-tag--green", tagLabel: "fix" };
  }
  if (lower.includes("risk") || lower.includes("warn") || lower.includes("caution")) {
    return { tagClass: "ai-line-tag--amber", tagLabel: "risks" };
  }
  if (lower.includes("priorit") || lower.includes("rank") || lower.includes("next")) {
    return { tagClass: "ai-line-tag--purple", tagLabel: "priority" };
  }
  if (lower.includes("summary") || lower.includes("overview") || lower.includes("tl;dr")) {
    return { tagClass: "ai-line-tag--grey", tagLabel: "summary" };
  }
  return { tagClass: "ai-line-tag--grey", tagLabel: heading.toLowerCase() };
}

function renderIntelBody(md: string): string {
  const escaped = escapeHtmlIntel(md);
  const lines = escaped.split("\n");
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];

  for (const line of lines) {
    const codeFence = /^```(\w*)/.exec(line);
    if (codeFence) {
      if (inCode) {
        out.push(`<pre><code class="lang-${codeLang}">${codeLines.join("\n")}</code></pre>`);
        codeLines = []; inCode = false; codeLang = "";
      } else {
        if (inList) { out.push("</ul>"); inList = false; }
        inCode = true;
        codeLang = codeFence[1] ?? "";
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }

    if (inList && !/^\s*[-*\d]/.test(line)) {
      out.push("</ul>"); inList = false;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${applyInlineIntel(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
    } else if (/^\s*\d+\.\s+/.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${applyInlineIntel(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
    } else if (line.trim() === "") {
      // skip
    } else {
      out.push(`<p>${applyInlineIntel(line)}</p>`);
    }
  }

  if (inList) out.push("</ul>");
  if (inCode) out.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
  return out.join("\n");
}

function applyInlineIntel(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function escapeHtmlIntel(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function deactivate() {
  log.info("ProdScope extension deactivating.");
  wsClient?.disconnect();
  wsClient = null;
}
