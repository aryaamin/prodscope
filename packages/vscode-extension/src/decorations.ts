import * as vscode from "vscode";

// Gutter decoration types for hot paths and error lines
const hotPathDecoration = vscode.window.createTextEditorDecorationType({
  gutterIconSize: "contain",
  overviewRulerColor: "#f59e0b",
  overviewRulerLane: vscode.OverviewRulerLane.Left,
  backgroundColor: "rgba(245, 158, 11, 0.06)",
  isWholeLine: true,
});

const errorDecoration = vscode.window.createTextEditorDecorationType({
  gutterIconSize: "contain",
  overviewRulerColor: "#ef4444",
  overviewRulerLane: vscode.OverviewRulerLane.Left,
  backgroundColor: "rgba(239, 68, 68, 0.06)",
  isWholeLine: true,
});

interface LineAnnotation {
  line: number;
  type: "hot" | "error";
  text: string; // Inline hint text
}

export function applyDecorations(
  editor: vscode.TextEditor,
  annotations: LineAnnotation[],
): void {
  const hotRanges: vscode.DecorationOptions[] = [];
  const errorRanges: vscode.DecorationOptions[] = [];

  for (const ann of annotations) {
    if (ann.line <= 0 || ann.line > editor.document.lineCount) continue;

    const lineIdx = ann.line - 1;
    const lineLength = editor.document.lineAt(lineIdx).text.length;
    const range = new vscode.Range(lineIdx, 0, lineIdx, lineLength);

    const decoration: vscode.DecorationOptions = {
      range,
      renderOptions: {
        after: {
          contentText: `  \u21b3 ${ann.text}`,
          color: ann.type === "error" ? "#f87171" : "#fbbf24",
          fontStyle: "italic",
        },
      },
    };

    if (ann.type === "error") {
      errorRanges.push(decoration);
    } else {
      hotRanges.push(decoration);
    }
  }

  editor.setDecorations(hotPathDecoration, hotRanges);
  editor.setDecorations(errorDecoration, errorRanges);
}

export function clearDecorations(editor: vscode.TextEditor): void {
  editor.setDecorations(hotPathDecoration, []);
  editor.setDecorations(errorDecoration, []);
}

export { hotPathDecoration, errorDecoration, type LineAnnotation };
