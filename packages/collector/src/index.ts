import express from "express";
import http from "http";
import { env } from "./env.js";
import { initClickHouse } from "./db/clickhouse.js";
import { bootstrapPostgres } from "./db/postgres.js";
import { apiKeyAuth } from "./middleware/auth.js";
import { setupWebSocket } from "./services/websocket.js";
import { startAggregator } from "./services/aggregator.js";
import { startInsightGenerator } from "./services/ai-insights.js";
import ingestRouter from "./routes/ingest.js";
import sourceMapRouter from "./routes/source-maps.js";
import apiRouter from "./routes/api.js";
import authRouter from "./routes/auth.js";

const app = express();

app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "prodscope-collector" });
});

// Auth routes (no API key needed)
app.use(authRouter);

// All other routes require API key
app.use(apiKeyAuth, ingestRouter);
app.use(apiKeyAuth, sourceMapRouter);
app.use(apiKeyAuth, apiRouter);

const server = http.createServer(app);

// WebSocket for live updates
setupWebSocket(server);

async function start() {
  console.log("Initializing databases...");
  await bootstrapPostgres();
  await initClickHouse();

  // Start background services
  startAggregator(10_000);
  if (env.anthropicApiKey) {
    startInsightGenerator(60_000);
  }

  server.listen(env.port, () => {
    console.log(`ProdScope collector listening on :${env.port}`);
    console.log(`WebSocket available on the same port`);
  });
}

start().catch((err) => {
  console.error("Failed to start collector:", err);
  process.exit(1);
});

export { app, server };
