import WebSocket from "ws";
import * as vscode from "vscode";
import type { ExtensionConfig } from "./config.js";

export type EventHandler = (event: any) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: ExtensionConfig;
  private handlers: EventHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusBar: vscode.StatusBarItem;

  constructor(config: ExtensionConfig, statusBar: vscode.StatusBarItem) {
    this.config = config;
    this.statusBar = statusBar;
  }

  connect(): void {
    const url = `${this.config.wsUrl}?projectId=${this.config.projectId}&apiKey=${this.config.apiKey}`;

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
    this.ws?.close();
    this.ws = null;
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
