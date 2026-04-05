import type { Plugin } from "vite";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

interface ProdScopeViteOptions {
  apiKey: string;
  ingestUrl?: string;
  /** File patterns to auto-track (default: all .js/.ts/.jsx/.tsx files) */
  include?: RegExp[];
  /** File patterns to skip (default: node_modules, test files) */
  exclude?: RegExp[];
}

/**
 * Vite plugin that:
 * 1. Auto-injects file:line into track() calls at build time
 * 2. Uploads source maps to the collector after build
 *
 * ```ts
 * // vite.config.ts
 * import { prodscope } from "@prodscope/sdk-browser/vite";
 *
 * export default defineConfig({
 *   plugins: [
 *     prodscope({ apiKey: process.env.PRODSCOPE_API_KEY! }),
 *   ],
 * });
 * ```
 */
export function prodscope(options: ProdScopeViteOptions): Plugin[] {
  return [
    prodscopeAutoTrack(options),
    prodscopeTransform(),
    prodscopeSourceMaps(options),
  ];
}

/**
 * Auto-track plugin: automatically wraps all exported functions with track()
 * at build time. This means customers get function monitoring with ZERO manual
 * wrapping — just export functions normally and they're tracked.
 *
 * Transforms:
 *   export function fetchUsers() { ... }
 *     → import { track as __ps_track } from "@prodscope/sdk-browser";
 *       function fetchUsers() { ... }
 *       const __ps_fetchUsers = __ps_track("fetchUsers", fetchUsers, "src/api.ts", 3);
 *       export { __ps_fetchUsers as fetchUsers };
 *
 *   export const submit = async () => { ... }
 *     → import { track as __ps_track } from "@prodscope/sdk-browser";
 *       const submit = async () => { ... };
 *       const __ps_submit = __ps_track("submit", submit, "src/api.ts", 5);
 *       export { __ps_submit as submit };
 *
 * Skips: default exports, re-exports, type exports, non-function exports,
 *        files in node_modules, and files that match exclude patterns.
 */
export function prodscopeAutoTrack(options: ProdScopeViteOptions): Plugin {
  const exclude = options.exclude ?? [/node_modules/, /\.test\.|\.spec\./];
  const include = options.include ?? [/\.[jt]sx?$/];

  return {
    name: "prodscope-auto-track",
    enforce: "pre",

    transform(code: string, id: string) {
      // Check include/exclude
      if (!include.some((p) => p.test(id))) return null;
      if (exclude.some((p) => p.test(id))) return null;

      // Skip files that already import from @prodscope (they're doing manual tracking)
      if (code.includes("@prodscope/")) return null;

      const root = process.cwd();
      const relPath = id.startsWith(root) ? id.slice(root.length + 1) : id;

      const exportedFns = parseExportedFunctions(code);
      if (exportedFns.length === 0) return null;

      // Build the transformed code
      let result = `import { track as __ps_track } from "@prodscope/sdk-browser";\n`;

      // We need to rewrite the exports. Strategy:
      // 1. Remove "export" keyword from each exported function/const
      // 2. Append track() wrappers at the end
      // 3. Add a single export {} statement for all tracked functions

      let modified = code;
      const trackLines: string[] = [];
      const exportEntries: string[] = [];

      for (const fn of exportedFns) {
        // Remove the "export" keyword from the declaration
        modified = modified.replace(fn.fullMatch, fn.declaration);

        trackLines.push(
          `const __ps_${fn.name} = __ps_track("${fn.name}", ${fn.name}, "${relPath}", ${fn.line});`,
        );
        exportEntries.push(`__ps_${fn.name} as ${fn.name}`);
      }

      result += modified;
      result += "\n\n// --- ProdScope auto-track ---\n";
      result += trackLines.join("\n") + "\n";
      result += `export { ${exportEntries.join(", ")} };\n`;

      return { code: result, map: null };
    },
  };
}

interface ExportedFunction {
  name: string;
  line: number;
  fullMatch: string;   // The full "export function ..." or "export const ..." text
  declaration: string; // The same without "export "
}

/**
 * Parse exported function declarations from source code.
 * Matches:
 *   export function name(...)
 *   export async function name(...)
 *   export const name = (...) =>
 *   export const name = async (...) =>
 *   export const name = function(...)
 */
function parseExportedFunctions(code: string): ExportedFunction[] {
  const results: ExportedFunction[] = [];
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // export function name or export async function name
    const fnRegex = /^export\s+(async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/;
    const fnMatch = fnRegex.exec(trimmed);
    if (fnMatch) {
      const name = fnMatch[2];
      results.push({
        name,
        line: i + 1,
        fullMatch: `export ${fnMatch[1] ?? ""}function ${name}`,
        declaration: `${fnMatch[1] ?? ""}function ${name}`,
      });
    }

    // export const name = (...) => or export const name = async (...) =>
    // or export const name = function(...)
    const constRegex = /^export\s+const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(async\s+)?(\(|function\b)/;
    const constMatch = constRegex.exec(trimmed);
    if (constMatch && !fnMatch) {
      const name = constMatch[1];
      results.push({
        name,
        line: i + 1,
        fullMatch: `export const ${name}`,
        declaration: `const ${name}`,
      });
    }
  }

  return results;
}

/**
 * Build-time transform that rewrites:
 *   track("myFunc", fn)           -> track("myFunc", fn, "src/app.ts", 42)
 *   track("myFunc", fn, file)     -> unchanged (already has file)
 *
 * Also rewrites the sdk-node variant with the same signature.
 * Zero runtime cost — the file:line is baked into the compiled output.
 */
export function prodscopeTransform(): Plugin {
  return {
    name: "prodscope-transform",
    enforce: "pre",

    transform(code: string, id: string) {
      // Only process JS/TS files, skip node_modules
      if (!/\.[jt]sx?$/.test(id)) return null;
      if (id.includes("node_modules")) return null;
      // Must contain track( to be relevant
      if (!code.includes("track(")) return null;

      // Get relative file path from project root
      const root = process.cwd();
      const relPath = id.startsWith(root) ? id.slice(root.length + 1) : id;

      let modified = false;
      const lines = code.split("\n");
      const result: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Match: track("name", expr) — with exactly 2 arguments (no file/line yet)
        // Handles: track("fn", fn), track("fn", () => {}), track("fn", async () => {})
        const trackRegex = /\btrack\(\s*("[^"]*"|'[^']*'|`[^`]*`)\s*,\s*([^,)]+)\s*\)/g;
        let match: RegExpExecArray | null;

        while ((match = trackRegex.exec(line)) !== null) {
          const fullMatch = match[0];
          const name = match[1];
          const fnExpr = match[2].trim();

          // Don't rewrite if there are already 3+ arguments
          // Check by counting commas outside of nested parens
          const inner = fullMatch.slice(6, -1); // strip "track(" and ")"
          if (countTopLevelCommas(inner) >= 2) continue;

          const lineNum = i + 1;
          const replacement = `track(${name}, ${fnExpr}, "${relPath}", ${lineNum})`;
          line = line.replace(fullMatch, replacement);
          modified = true;
        }

        result.push(line);
      }

      if (!modified) return null;

      return {
        code: result.join("\n"),
        map: null, // source map handled by Vite
      };
    },
  };
}

/** Count commas at the top level (not inside parentheses, brackets, or braces). */
function countTopLevelCommas(str: string): number {
  let depth = 0;
  let count = 0;
  for (const ch of str) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) count++;
  }
  return count;
}

/** Source map upload plugin — runs after build. */
export function prodscopeSourceMaps(options: ProdScopeViteOptions): Plugin {
  const ingestUrl = options.ingestUrl ?? "https://ingest.prodscope.dev";
  let outDir = "dist";

  return {
    name: "prodscope-source-maps",
    apply: "build",

    configResolved(config) {
      outDir = config.build.outDir;
    },

    async closeBundle() {
      let gitSha = "";
      try {
        gitSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
      } catch {
        // Not a git repo
      }

      const assetsDir = join(outDir, "assets");
      let files: string[];
      try {
        files = readdirSync(assetsDir);
      } catch {
        return;
      }

      const mapFiles = files.filter((f) => f.endsWith(".map"));

      for (const mapFile of mapFiles) {
        const mapPath = join(assetsDir, mapFile);
        const mapData = readFileSync(mapPath, "utf-8");
        const jsFile = mapFile.replace(/\.map$/, "");

        try {
          await fetch(`${ingestUrl}/v1/source-maps`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": options.apiKey,
            },
            body: JSON.stringify({
              fileName: `assets/${jsFile}`,
              mapData,
              gitSha,
            }),
          });
          console.log(`[ProdScope] Uploaded source map: ${jsFile}`);
        } catch (err) {
          console.warn(`[ProdScope] Failed to upload ${jsFile}:`, err);
        }
      }
    },
  };
}

export default prodscope;
