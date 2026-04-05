import * as vscode from "vscode";

interface FunctionStat {
  function: string;
  file: string;
  line: number;
  call_count: number;
  avg_ms: number;
  p50_ms: number;
  p99_ms: number;
  error_count: number;
  error_rate: number;
  unique_sessions: number;
  total_sessions: number;
  calls_per_session: number;
  session_reach_pct: number;
}

export class ProdScopeCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  private stats = new Map<string, FunctionStat[]>();

  updateStats(file: string, functionStats: FunctionStat[]): void {
    this.stats.set(file, functionStats);
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const filePath = document.uri.fsPath;
    const fileStats = this.stats.get(filePath);
    if (!fileStats?.length) return [];

    const lenses: vscode.CodeLens[] = [];

    for (const stat of fileStats) {
      if (stat.line <= 0 || stat.line > document.lineCount) continue;

      const line = stat.line - 1;
      const range = new vscode.Range(line, 0, line, 0);

      // Build a rich, scannable CodeLens title
      const parts: string[] = [];

      // Function name + call count
      parts.push(`${stat.function}  ${fmtNum(stat.call_count)} calls`);

      // Latency: p50 · p99
      parts.push(`p50 ${stat.p50_ms.toFixed(0)}ms · p99 ${stat.p99_ms.toFixed(0)}ms`);

      // Errors (only if any)
      if (stat.error_count > 0) {
        parts.push(`${fmtNum(stat.error_count)} errors (${(stat.error_rate * 100).toFixed(1)}%)`);
      }

      // Session reach
      if (stat.unique_sessions > 0) {
        parts.push(`${stat.session_reach_pct.toFixed(0)}% of sessions`);
      }

      // Calls per session
      if (stat.calls_per_session > 0) {
        parts.push(`${stat.calls_per_session.toFixed(1)}x per session`);
      }

      const title = `\u2197 ${parts.join("  \u2502  ")}`;

      lenses.push(
        new vscode.CodeLens(range, {
          title,
          command: "prodscope.showFunctionDetail",
          arguments: [stat],
        }),
      );
    }

    return lenses;
  }
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
