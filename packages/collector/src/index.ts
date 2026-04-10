import express from "express";
import cors from "cors";
import http from "http";
import rateLimit from "express-rate-limit";
import { env } from "./env.js";
import { initClickHouse } from "./db/clickhouse.js";
import { bootstrapPostgres } from "./db/postgres.js";
import { apiKeyAuth } from "./middleware/auth.js";
import { setupWebSocket } from "./services/websocket.js";
import { startAggregator } from "./services/aggregator.js";
import ingestRouter from "./routes/ingest.js";
import sourceMapRouter from "./routes/source-maps.js";
import apiRouter from "./routes/api.js";
import trendsRouter from "./routes/trends.js";
import authRouter from "./routes/auth.js";

const app: ReturnType<typeof express> = express();

// app.use(
//   cors({
//     origin: env.corsOrigins === "*" ? true : env.corsOrigins.split(",").map((o) => o.trim()),
//     methods: ["GET", "POST", "OPTIONS"],
//     allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
//   }),
// );
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 30, // 30 attempts per window
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 300, // 300 requests per minute per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Ingest rate limit exceeded" },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "API rate limit exceeded" },
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "prodscope-collector" });
});

// Auth routes (no API key needed, but rate-limited)
app.use(authLimiter, authRouter);

// All other routes require API key
app.use(apiKeyAuth, ingestLimiter, ingestRouter);
app.use(apiKeyAuth, sourceMapRouter);
app.use(apiKeyAuth, apiLimiter, apiRouter);
app.use(apiKeyAuth, apiLimiter, trendsRouter);

const server = http.createServer(app);

// WebSocket for live updates
setupWebSocket(server);

async function start() {
  console.log("Initializing databases...");
  await bootstrapPostgres();
  await initClickHouse();

  // Start background services
  startAggregator(10_000);
  // AI insights and analyses run strictly on-request via API endpoints
  // (POST /api/v1/ai-insight?refresh=true, POST /api/v1/analysis/:type,
  // POST /api/v1/code-intel/:type) to avoid burning Anthropic credits.

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
