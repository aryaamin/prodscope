import WebSocket from "ws";
import * as vscode from "vscode";
import type { ExtensionConfig } from "./config";

export type EventHandler = (event: any) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: ExtensionConfig;
  private handlers: EventHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusBar: vscode.StatusBarItem;
  private isIntentionallyClosed = false;

  constructor(config: ExtensionConfig, statusBar: vscode.StatusBarItem) {
    this.config = config;
    this.statusBar = statusBar;
  }

  connect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }

    const base = this.config.wsUrl.replace(/\/$/, "");
    const q = new URLSearchParams({
      projectId: this.config.projectId,
      apiKey: this.config.apiKey,
    });
    const url = `${base}?${q.toString()}`;

    this.isIntentionallyClosed = false;
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this.statusBar.text = "$(radio-tower) ProdScope";
      this.statusBar.color = "#4ade80";
      this.statusBar.tooltip = "ProdScope: Connected";
    });

    this.ws.on("message", (data) => {
      try {
        const event = JSON.parse(data.toString());
        for (const handler of this.handlers) {
          handler(event);
        }
      } catch {
        // Invalid JSON — ignore
      }
    });

    this.ws.on("close", () => {
      this.statusBar.text = "$(radio-tower) ProdScope";
      this.statusBar.color = "#71717a";
      if (this.isIntentionallyClosed) {
        this.statusBar.tooltip = "ProdScope: Disconnected";
        return;
      }
      this.statusBar.tooltip = "ProdScope: Disconnected — reconnecting...";
      this.scheduleReconnect();
    });

    this.ws.on("error", () => {
      this.statusBar.color = "#f87171";
      this.statusBar.tooltip = "ProdScope: Connection error";
    });
  }

  onEvent(handler: EventHandler): void {
    this.handlers.push(handler);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isIntentionallyClosed = true;
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.statusBar.color = "#71717a";
    this.statusBar.tooltip = "ProdScope: Disconnected";
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }
}
