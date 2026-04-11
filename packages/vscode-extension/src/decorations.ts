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

interface LineAnnotation {
  line: number;
  type: "hot" | "error";
  text: string;
}

export function applyDecorations(
  editor: vscode.TextEditor,
  annotations: LineAnnotation[],
): void {
  // Merge annotations on the same line so we don't double-decorate.
  // If any annotation on a line is an error, the merged line is an error.
  const byLine = new Map<number, { type: "hot" | "error"; parts: string[] }>();
  for (const ann of annotations) {
    if (!ann.line || ann.line <= 0 || ann.line > editor.document.lineCount) continue;
    const existing = byLine.get(ann.line);
    if (existing) {
      if (ann.type === "error") existing.type = "error";
      if (!existing.parts.includes(ann.text)) existing.parts.push(ann.text);
    } else {
      byLine.set(ann.line, { type: ann.type, parts: [ann.text] });
    }
  }

  const hotRanges: vscode.DecorationOptions[] = [];
  const errorRanges: vscode.DecorationOptions[] = [];

  for (const [line, entry] of byLine) {
    const lineIdx = line - 1;
    const doc = editor.document;
    const lineText = doc.lineAt(lineIdx).text;
    // Anchor the "after" hint at end-of-line for consistent positioning.
    const range = new vscode.Range(lineIdx, lineText.length, lineIdx, lineText.length);

    const isError = entry.type === "error";
    const icon = isError ? "\u25cf" : "\u26a1"; // ● for errors, ⚡ for hot
    const color = isError ? "#f87171" : "#fbbf24";

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
        `**ProdScope — ${isError ? "errors" : "hot path"}**\n\n${entry.parts.map((p) => `- ${p}`).join("\n")}`,
      ),
    };

    if (isError) errorRanges.push(decoration);
    else hotRanges.push(decoration);
  }

  editor.setDecorations(hotPathDecoration, hotRanges);
  editor.setDecorations(errorDecoration, errorRanges);
}

export function clearDecorations(editor: vscode.TextEditor): void {
  editor.setDecorations(hotPathDecoration, []);
  editor.setDecorations(errorDecoration, []);
}

export { hotPathDecoration, errorDecoration, type LineAnnotation };
