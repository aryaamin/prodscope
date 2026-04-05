/**
 * Extracts the file and line number of the *caller* from an Error stack trace.
 * Browser version — works with V8 (Chrome), SpiderMonkey (Firefox), and JavaScriptCore (Safari).
 */

interface CallSite {
  file: string;
  line: number;
  column: number;
  function: string;
}

const SKIP_PATTERNS = [
  "node_modules/@prodscope",
  "node_modules/prodscope",
];

export function captureCallSite(skipFrames = 0): CallSite | null {
  const stack = new Error().stack ?? "";
  const lines = stack.split("\n").slice(1);

  const startIdx = 2 + skipFrames;

  for (let i = startIdx; i < lines.length; i++) {
    const frame = lines[i].trim();
    if (SKIP_PATTERNS.some((p) => frame.includes(p))) continue;

    const parsed = parseFrame(frame);
    if (parsed && parsed.file) {
      return parsed;
    }
  }

  return null;
}

function parseFrame(frame: string): CallSite | null {
  // V8 format: "at funcName (http://host/file.js:10:20)"
  const v8Match = frame.match(
    /at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):(\d+)\)?$/,
  );
  if (v8Match) {
    const [, fnRaw, file, lineStr, colStr] = v8Match;
    return {
      file: cleanBrowserPath(file),
      line: parseInt(lineStr, 10),
      column: parseInt(colStr, 10),
      function: fnRaw?.replace(/<anonymous>$/, "").trim() ?? "",
    };
  }

  // Firefox/Safari format: "funcName@http://host/file.js:10:20"
  const ffMatch = frame.match(/^(.+?)@(.+?):(\d+):(\d+)$/);
  if (ffMatch) {
    const [, fn, file, lineStr, colStr] = ffMatch;
    return {
      file: cleanBrowserPath(file),
      line: parseInt(lineStr, 10),
      column: parseInt(colStr, 10),
      function: fn ?? "",
    };
  }

  return null;
}

/** Strip origin from URLs to get relative path: "http://localhost:3000/src/app.ts" -> "src/app.ts" */
function cleanBrowserPath(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove leading slash
    return parsed.pathname.replace(/^\//, "");
  } catch {
    return url;
  }
}
