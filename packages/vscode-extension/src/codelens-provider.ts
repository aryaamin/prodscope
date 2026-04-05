import * as vscode from "vscode";

interface FunctionStat {
  function: string;
  file: string;
  line: number;
  call_count: number;
  avg_ms: number;
  error_rate: number;
  activeSessions?: number;
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

      const line = stat.line - 1; // VS Code is 0-indexed
      const range = new vscode.Range(line, 0, line, 0);

      const callCount = formatNumber(stat.call_count);
      const avgMs = stat.avg_ms.toFixed(0);
      const errorRate = (stat.error_rate * 100).toFixed(1);
      const sessions = stat.activeSessions ?? 0;

      let title = `\u2197 ${stat.function} \u2014 ${callCount} calls \u00b7 avg ${avgMs}ms \u00b7 ${errorRate}% errors`;
      if (sessions > 0) {
        title += ` \u00b7 ${sessions} active now`;
      }

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

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
