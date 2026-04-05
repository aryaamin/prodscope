import { readFileSync } from "fs";
import { join } from "path";

export interface ProdscopeConfig {
  projectId: string;
  apiKey: string;
  apiUrl: string;
}

export function loadConfig(): ProdscopeConfig {
  // Try reading from prodscope.config.ts in cwd
  const configPath = join(process.cwd(), "prodscope.config.ts");

  try {
    const content = readFileSync(configPath, "utf-8");

    // Simple extraction — look for projectId, apiKey, apiUrl values
    const projectId =
      extractValue(content, "projectId") ??
      process.env.PRODSCOPE_PROJECT_ID ??
      "";
    const apiUrl =
      extractValue(content, "apiUrl") ??
      process.env.PRODSCOPE_API_URL ??
      "https://api.prodscope.dev";

    // API key always comes from env
    const apiKey = process.env.PRODSCOPE_API_KEY ?? "";

    return { projectId, apiKey, apiUrl };
  } catch {
    // Fall back to env vars
    return {
      projectId: process.env.PRODSCOPE_PROJECT_ID ?? "",
      apiKey: process.env.PRODSCOPE_API_KEY ?? "",
      apiUrl:
        process.env.PRODSCOPE_API_URL ?? "https://api.prodscope.dev",
    };
  }
}

function extractValue(content: string, key: string): string | null {
  const regex = new RegExp(`${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`);
  const match = content.match(regex);
  return match?.[1] ?? null;
}
