import type { Request, Response, NextFunction } from "express";
import { getPostgres } from "../db/postgres.js";

/** Authenticate via x-api-key header and attach project to req. */
export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const apiKey = (req.headers["x-api-key"] as string | undefined) ?? req.body?._apiKey;
  if (!apiKey) {
    res.status(401).json({ error: "Missing x-api-key header" });
    return;
  }

  // Clean up inline key so it doesn't get stored with telemetry
  if (req.body?._apiKey) {
    delete req.body._apiKey;
  }

  const db = getPostgres();
  const result = await db.query(
    "SELECT id, name FROM projects WHERE api_key = $1",
    [apiKey],
  );

  if (result.rows.length === 0) {
    res.status(403).json({ error: "Invalid API key" });
    return;
  }

  (req as any).projectId = result.rows[0].id;
  (req as any).projectName = result.rows[0].name;
  next();
}
