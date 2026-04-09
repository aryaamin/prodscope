import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { getPostgres } from "../db/postgres.js";

interface Client {
  ws: WebSocket;
  projectId: string;
}

const clients: Client[] = [];

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server });

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const projectId = url.searchParams.get("projectId") ?? "";
    const apiKey = url.searchParams.get("apiKey") ?? "";

    if (!projectId || !apiKey) {
      ws.close(4001, "Missing projectId or apiKey");
      return;
    }

    // Validate API key against database
    try {
      const db = getPostgres();
      const result = await db.query(
        "SELECT id FROM projects WHERE id = $1 AND api_key = $2",
        [projectId, apiKey],
      );
      if (result.rows.length === 0) {
        ws.close(4003, "Invalid projectId or apiKey");
        return;
      }
    } catch {
      ws.close(4500, "Authentication error");
      return;
    }

    const client: Client = { ws, projectId };
    clients.push(client);

    ws.on("close", () => {
      const idx = clients.indexOf(client);
      if (idx !== -1) clients.splice(idx, 1);
    });

    ws.send(JSON.stringify({ type: "connected", projectId }));
  });

  return wss;
}

/** Broadcast an event to all clients subscribed to a project. */
export function broadcast(projectId: string, event: object): void {
  const message = JSON.stringify(event);
  for (const client of clients) {
    if (
      client.projectId === projectId &&
      client.ws.readyState === WebSocket.OPEN
    ) {
      try {
        client.ws.send(message);
      } catch (err) {
        console.error(`WebSocket broadcast failed for project ${projectId}:`, err);
      }
    }
  }
}
