import pg from "pg";
import { env } from "../env.js";

const { Pool } = pg;

let pool: pg.Pool;

export function getPostgres(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env.postgresUrl });
  }
  return pool;
}

/** Bootstrap tables in correct order (users before projects). */
export async function bootstrapPostgres(): Promise<void> {
  const db = getPostgres();

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      email        TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name         TEXT DEFAULT '',
      created_at   TIMESTAMPTZ DEFAULT now()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name         TEXT NOT NULL,
      api_key      TEXT UNIQUE NOT NULL DEFAULT 'ps_' || gen_random_uuid()::text,
      owner_id     TEXT NOT NULL REFERENCES users(id),
      created_at   TIMESTAMPTZ DEFAULT now(),
      updated_at   TIMESTAMPTZ DEFAULT now()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS source_maps (
      id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      project_id   TEXT NOT NULL REFERENCES projects(id),
      file_name    TEXT NOT NULL,
      map_data     TEXT NOT NULL,
      git_sha      TEXT DEFAULT '',
      uploaded_at  TIMESTAMPTZ DEFAULT now(),
      UNIQUE(project_id, file_name, git_sha)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_insights (
      id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      project_id   TEXT NOT NULL REFERENCES projects(id),
      file         TEXT NOT NULL,
      function     TEXT DEFAULT '',
      insight      TEXT NOT NULL,
      generated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(project_id, file, function)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS ai_analyses (
      id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      project_id   TEXT NOT NULL REFERENCES projects(id),
      type         TEXT NOT NULL,
      analysis     TEXT NOT NULL,
      data_points  INT DEFAULT 0,
      generated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(project_id, type)
    )
  `);
}
