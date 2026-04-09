import { config } from "dotenv";

config();

export const env = {
  port: parseInt(process.env.PORT ?? "3100", 10),
  wsPort: parseInt(process.env.WS_PORT ?? "3101", 10),
  clickhouseUrl: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  clickhouseDb: process.env.CLICKHOUSE_DB ?? "prodscope",
  postgresUrl:
    process.env.POSTGRES_URL ??
    "postgresql://prodscope:prodscope@localhost:5450/prodscope",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "change-me-in-production",
  corsOrigins: process.env.CORS_ORIGINS ?? "*",
} as const;
