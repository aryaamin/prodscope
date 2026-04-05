/**
 * Extracts the file and line number of the *caller* from an Error stack trace.
 * Used to auto-map DB queries, HTTP calls, and tracked functions back to source code.
 *
 * Skips internal SDK frames to find the first frame in user code.
 */

interface CallSite {
  file: string;
  line: number;
  column: number;
  function: string;
}

// Patterns to skip when walking up the stack — these are SDK internals
const SKIP_PATTERNS = [
  "node_modules/@prodscope",
  "node_modules/prodscope",
  // Node internals
  "node:internal",
  "node:async_hooks",
];

/**
 * Capture the call site of the caller.
 * @param skipFrames - additional frames to skip beyond the default (default: 0)
 */
export function captureCallSite(skipFrames = 0): CallSite | null {
  const orig = Error.stackTraceLimit;
  Error.stackTraceLimit = 20;
  const stack = new Error().stack ?? "";
  Error.stackTraceLimit = orig;

  const lines = stack.split("\n").slice(1); // skip "Error" line

  // Skip: this function + the SDK function that called us + extra frames
  const startIdx = 2 + skipFrames;

  for (let i = startIdx; i < lines.length; i++) {
    const frame = lines[i].trim();

    // Skip SDK internals
    if (SKIP_PATTERNS.some((p) => frame.includes(p))) continue;

    const parsed = parseFrame(frame);
    if (parsed && parsed.file && !parsed.file.startsWith("node:")) {
      return parsed;
    }
  }

  return null;
}

/**
 * Parse a V8 stack frame like:
 *   "at functionName (/path/to/file.ts:10:20)"
 *   "at /path/to/file.ts:10:20"
 *   "at Object.<anonymous> (/path/to/file.ts:10:20)"
 */
function parseFrame(frame: string): CallSite | null {
  // Match: at funcName (file:line:col)
  const matchWithFn = frame.match(
    /at\s+(?:(.+?)\s+)?\(?(.+?):(\d+):(\d+)\)?$/,
  );
  if (!matchWithFn) return null;

  const [, fnRaw, file, lineStr, colStr] = matchWithFn;
  const fn = fnRaw?.replace(/^Object\./, "").replace(/<anonymous>$/, "").trim() ?? "";

  // Convert absolute paths to relative (strip cwd)
  const cwd = process.cwd();
  const relFile = file.startsWith(cwd) ? file.slice(cwd.length + 1) : file;

  return {
    file: relFile,
    line: parseInt(lineStr, 10),
    column: parseInt(colStr, 10),
    function: fn,
  };
}
