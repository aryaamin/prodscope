import * as vscode from "vscode";

const hotPathDecoration = vscode.window.createTextEditorDecorationType({
  overviewRulerColor: "#f59e0b",
  overviewRulerLane: vscode.OverviewRulerLane.Left,
  backgroundColor: "rgba(245, 158, 11, 0.05)",
  isWholeLine: true,
});

const errorDecoration = vscode.window.createTextEditorDecorationType({
  overviewRulerColor: "#ef4444",
  overviewRulerLane: vscode.OverviewRulerLane.Left,
  backgroundColor: "rgba(239, 68, 68, 0.07)",
  isWholeLine: true,
});

const logDecoration = vscode.window.createTextEditorDecorationType({
  overviewRulerColor: "#38bdf8",
  overviewRulerLane: vscode.OverviewRulerLane.Left,
  backgroundColor: "rgba(56, 189, 248, 0.04)",
  isWholeLine: true,
});

interface LineAnnotation {
  line: number;
  type: "hot" | "error" | "log";
  text: string;
  hoverLines?: string[];
}

type AnnType = "hot" | "error" | "log";

const TYPE_RANK: Record<AnnType, number> = { error: 3, log: 2, hot: 1 };

export function applyDecorations(
  editor: vscode.TextEditor,
  annotations: LineAnnotation[],
): void {
  // Merge annotations on the same line so we don't double-decorate.
  // Priority when two types land on the same line: error > log > hot.
  const byLine = new Map<
    number,
    { type: AnnType; parts: string[]; hoverLines: string[] }
  >();
  for (const ann of annotations) {
    if (!ann.line || ann.line <= 0 || ann.line > editor.document.lineCount) continue;
    const existing = byLine.get(ann.line);
    if (existing) {
      if (TYPE_RANK[ann.type] > TYPE_RANK[existing.type]) existing.type = ann.type;
      if (!existing.parts.includes(ann.text)) existing.parts.push(ann.text);
      if (ann.hoverLines) existing.hoverLines.push(...ann.hoverLines);
    } else {
      byLine.set(ann.line, {
        type: ann.type,
        parts: [ann.text],
        hoverLines: ann.hoverLines ? [...ann.hoverLines] : [],
      });
    }
  }

  const hotRanges: vscode.DecorationOptions[] = [];
  const errorRanges: vscode.DecorationOptions[] = [];
  const logRanges: vscode.DecorationOptions[] = [];

  for (const [line, entry] of byLine) {
    const lineIdx = line - 1;
    const doc = editor.document;
    const lineText = doc.lineAt(lineIdx).text;
    const range = new vscode.Range(lineIdx, lineText.length, lineIdx, lineText.length);

    const icon =
      entry.type === "error" ? "\u25cf" : entry.type === "log" ? "\u25a2" : "\u26a1";
    const color =
      entry.type === "error" ? "#f87171" : entry.type === "log" ? "#38bdf8" : "#fbbf24";
    const heading =
      entry.type === "error" ? "errors" : entry.type === "log" ? "logs" : "hot path";

    const hoverBody =
      entry.hoverLines.length > 0
        ? entry.hoverLines.map((l) => `- ${l}`).join("\n")
        : entry.parts.map((p) => `- ${p}`).join("\n");

    const decoration: vscode.DecorationOptions = {
      range,
      renderOptions: {
        after: {
          contentText: `   ${icon} ${entry.parts.join("  \u00b7  ")}`,
          color,
          fontStyle: "italic",
          margin: "0 0 0 1rem",
        },
      },
      hoverMessage: new vscode.MarkdownString(
        `**ProdScope — ${heading}**\n\n${hoverBody}`,
      ),
    };

    if (entry.type === "error") errorRanges.push(decoration);
    else if (entry.type === "log") logRanges.push(decoration);
    else hotRanges.push(decoration);
  }

  editor.setDecorations(hotPathDecoration, hotRanges);
  editor.setDecorations(errorDecoration, errorRanges);
  editor.setDecorations(logDecoration, logRanges);
}

export function clearDecorations(editor: vscode.TextEditor): void {
  editor.setDecorations(hotPathDecoration, []);
  editor.setDecorations(errorDecoration, []);
  editor.setDecorations(logDecoration, []);
}

export { hotPathDecoration, errorDecoration, logDecoration, type LineAnnotation };
