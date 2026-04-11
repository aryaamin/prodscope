import crypto from "node:crypto";
import { getPostgres } from "./db/postgres.js";
import { env } from "./env.js";
import type { ErrorSignature, AttemptStatus } from "./types.js";

export function hashSignature(sig: ErrorSignature): string {
  const key = [
    sig.projectId,
    sig.file,
    sig.line.toString(),
    sig.functionName,
    sig.errorType,
    sig.message.slice(0, 200),
  ].join("|");
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export async function isInCooldown(
  projectId: string,
  signatureHash: string,
): Promise<boolean> {
  const db = getPostgres();
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM remedy_attempts
       WHERE project_id = $1
         AND signature_hash = $2
         AND started_at > now() - ($3 || ' hours')::interval
         AND status IN ('started', 'pr_opened', 'no_changes')
     ) AS exists`,
    [projectId, signatureHash, env.cooldownHours.toString()],
  );
  return rows[0]?.exists ?? false;
}

export async function recordAttemptStart(
  projectId: string,
  signatureHash: string,
  signature: ErrorSignature,
): Promise<string> {
  const db = getPostgres();
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO remedy_attempts (project_id, signature_hash, signature, status)
     VALUES ($1, $2, $3, 'started')
     RETURNING id`,
    [projectId, signatureHash, JSON.stringify(signature)],
  );
  return rows[0].id;
}

export async function finalizeAttempt(
  id: string,
  status: AttemptStatus,
  fields: {
    prUrl?: string;
    branch?: string;
    errorMessage?: string;
    agentLog?: string;
  } = {},
): Promise<void> {
  const db = getPostgres();
  await db.query(
    `UPDATE remedy_attempts
     SET status = $2,
         pr_url = COALESCE($3, pr_url),
         branch = COALESCE($4, branch),
         error_message = COALESCE($5, error_message),
         agent_log = COALESCE($6, agent_log),
         finished_at = now()
     WHERE id = $1`,
    [
      id,
      status,
      fields.prUrl ?? null,
      fields.branch ?? null,
      fields.errorMessage ?? null,
      fields.agentLog ?? null,
    ],
  );
}
