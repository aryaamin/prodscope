import * as vscode from "vscode";
import { readFileSync } from "fs";
import { join } from "path";

export interface ExtensionConfig {
  projectId: string;
  apiKey: string;
  apiUrl: string;
  wsUrl: string;
}

export function loadConfig(): ExtensionConfig | null {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.length) return null;

  const root = workspaceFolders[0].uri.fsPath;
  const configPath = join(root, "prodscope.config.ts");

  try {
    const content = readFileSync(configPath, "utf-8");

    const projectId = extractValue(content, "projectId") ?? "";
    const apiUrl =
      extractValue(content, "apiUrl") ?? "https://api.prodscope.dev";

    // Derive WebSocket URL from API URL
    const wsUrl = apiUrl
      .replace("https://api.", "wss://live.")
      .replace("http://localhost", "ws://localhost");

    // API key from env var or VS Code settings
    const apiKey =
      process.env.PRODSCOPE_API_KEY ??
      vscode.workspace.getConfiguration("prodscope").get<string>("apiKey") ??
      "";

    if (!projectId) return null;

    return { projectId, apiKey, apiUrl, wsUrl };
  } catch {
    return null;
  }
}

function extractValue(content: string, key: string): string | null {
  const regex = new RegExp(`${key}\\s*:\\s*["'\`]([^"'\`]+)["'\`]`);
  const match = content.match(regex);
  return match?.[1] ?? null;
}
