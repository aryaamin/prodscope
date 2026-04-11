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

    const wsUrl = deriveWsUrl(apiUrl);

    // API key: env var > VS Code settings > config file
    const apiKey =
      process.env.PRODSCOPE_API_KEY ??
      vscode.workspace.getConfiguration("prodscope").get<string>("apiKey") ??
      extractValue(content, "apiKey") ??
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

/** WebSocket URL for the collector (HTTP API and WS share the same host except hosted prodscope). */
function deriveWsUrl(apiUrl: string): string {
  try {
    const u = new URL(apiUrl);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      const proto = u.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${u.host}`;
    }
    if (u.hostname.startsWith("api.") && u.hostname.includes("prodscope")) {
      const liveHost = u.hostname.replace(/^api\./, "live.");
      const port = u.port ? `:${u.port}` : "";
      return `wss://${liveHost}${port}`;
    }
    let proto: string;
    if (u.protocol === "https:") proto = "wss:";
    else if (u.protocol === "http:") proto = "ws:";
    else proto = u.protocol;
    return `${proto}//${u.host}`;
  } catch {
    const s = apiUrl.trim();
    if (s.startsWith("https://")) return `wss://${s.slice(8)}`;
    if (s.startsWith("http://")) return `ws://${s.slice(7)}`;
    return s;
  }
}
