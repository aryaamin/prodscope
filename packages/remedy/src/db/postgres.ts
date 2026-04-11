import pg from "pg";
import { env } from "../env.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPostgres(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env.postgresUrl });
  }
  return pool;
}

export async function bootstrapRemedySchema(): Promise<void> {
  const db = getPostgres();

  await db.query(`
    CREATE TABLE IF NOT EXISTS project_repos (
      project_id         TEXT PRIMARY KEY REFERENCES projects(id),
      repo_url           TEXT NOT NULL,
      default_branch     TEXT NOT NULL DEFAULT 'main',
      github_owner       TEXT NOT NULL,
      github_repo        TEXT NOT NULL,
      slack_webhook_url  TEXT DEFAULT '',
      notify_emails      TEXT DEFAULT '',
      enabled            BOOLEAN NOT NULL DEFAULT true,
      created_at         TIMESTAMPTZ DEFAULT now(),
      updated_at         TIMESTAMPTZ DEFAULT now()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS remedy_attempts (
      id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      project_id       TEXT NOT NULL,
      signature_hash   TEXT NOT NULL,
      signature        JSONB NOT NULL,
      status           TEXT NOT NULL,
      pr_url           TEXT DEFAULT '',
      branch           TEXT DEFAULT '',
      error_message    TEXT DEFAULT '',
      agent_log        TEXT DEFAULT '',
      started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at      TIMESTAMPTZ
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_remedy_attempts_project_sig
      ON remedy_attempts (project_id, signature_hash, started_at DESC)
  `);
}
