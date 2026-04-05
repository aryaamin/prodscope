import { Router, type Request, type Response } from "express";
import { getPostgres } from "../db/postgres.js";

const router: ReturnType<typeof Router> = Router();

/** Upload a source map for a project. */
router.post("/v1/source-maps", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const { fileName, mapData, gitSha } = req.body;

  if (!fileName || !mapData) {
    res.status(400).json({ error: "fileName and mapData are required" });
    return;
  }

  const db = getPostgres();
  await db.query(
    `INSERT INTO source_maps (project_id, file_name, map_data, git_sha)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, file_name, git_sha) DO UPDATE SET
       map_data = EXCLUDED.map_data, uploaded_at = now()`,
    [projectId, fileName, typeof mapData === "string" ? mapData : JSON.stringify(mapData), gitSha ?? ""],
  );

  res.status(201).json({ ok: true });
});

export default router;
