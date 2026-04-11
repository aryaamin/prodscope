import { config } from "dotenv";

config();

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  clickhouseUrl: process.env.CLICKHOUSE_URL ?? "http://localhost:8123",
  clickhouseDb: process.env.CLICKHOUSE_DB ?? "prodscope",
  postgresUrl:
    process.env.POSTGRES_URL ??
    "postgresql://prodscope:prodscope@localhost:5450/prodscope",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",

  pollIntervalMs: int("REMEDY_POLL_INTERVAL_MS", 60_000),
  errorThreshold: int("REMEDY_ERROR_THRESHOLD", 5),
  errorWindowHours: int("REMEDY_ERROR_WINDOW_HOURS", 1),
  cooldownHours: int("REMEDY_COOLDOWN_HOURS", 24),
  worktreeRoot: process.env.REMEDY_WORKTREE_ROOT ?? "/tmp/remedy/worktrees",
  agentTurnLimit: int("REMEDY_AGENT_TURN_LIMIT", 25),
  agentTimeoutMs: int("REMEDY_AGENT_TIMEOUT_MS", 15 * 60_000),

  githubToken: process.env.GITHUB_TOKEN ?? "",
  githubAuthorName: process.env.GITHUB_AUTHOR_NAME ?? "remedy-bot",
  githubAuthorEmail: process.env.GITHUB_AUTHOR_EMAIL ?? "remedy@prodscope.dev",

  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL ?? "",

  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: int("SMTP_PORT", 587),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  smtpFrom: process.env.SMTP_FROM ?? "remedy@prodscope.dev",
} as const;
