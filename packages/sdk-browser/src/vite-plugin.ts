import type { Plugin } from "vite";
import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import { execSync } from "child_process";

interface ProdScopeViteOptions {
  apiKey: string;
  ingestUrl?: string;
}

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
        // Not a git repo — fine, skip sha
      }

      const assetsDir = join(outDir, "assets");
      let files: string[];
      try {
        files = readdirSync(assetsDir);
      } catch {
        return; // No assets directory
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

export default prodscopeSourceMaps;
