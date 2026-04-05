import { Router, type Request, type Response } from "express";
import { getPostgres } from "../db/postgres.js";
import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../env.js";

const router = Router();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256")
    .update(salt + password)
    .digest("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const attempt = createHash("sha256")
    .update(salt + password)
    .digest("hex");
  return hash === attempt;
}

/** POST /auth/signup */
router.post("/auth/signup", async (req: Request, res: Response) => {
  const { email, password, name } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const db = getPostgres();
  const existing = await db.query("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.rows.length > 0) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = hashPassword(password);
  const result = await db.query(
    "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name",
    [email, passwordHash, name ?? ""],
  );

  const user = result.rows[0];
  const token = jwt.sign({ userId: user.id, email: user.email }, env.jwtSecret, {
    expiresIn: "30d",
  });

  res.status(201).json({ user, token });
});

/** POST /auth/login */
router.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  const db = getPostgres();
  const result = await db.query(
    "SELECT id, email, name, password_hash FROM users WHERE email = $1",
    [email],
  );

  if (result.rows.length === 0) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const user = result.rows[0];
  if (!verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  const token = jwt.sign({ userId: user.id, email: user.email }, env.jwtSecret, {
    expiresIn: "30d",
  });

  res.json({
    user: { id: user.id, email: user.email, name: user.name },
    token,
  });
});

/** POST /auth/projects — create a project (requires JWT) */
router.post("/auth/projects", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization header" });
    return;
  }

  let decoded: any;
  try {
    decoded = jwt.verify(authHeader.slice(7), env.jwtSecret);
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const { name } = req.body;
  if (!name) {
    res.status(400).json({ error: "Project name is required" });
    return;
  }

  const db = getPostgres();
  const result = await db.query(
    "INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id, name, api_key, created_at",
    [name, decoded.userId],
  );

  res.status(201).json(result.rows[0]);
});

/** GET /auth/projects — list user's projects */
router.get("/auth/projects", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization header" });
    return;
  }

  let decoded: any;
  try {
    decoded = jwt.verify(authHeader.slice(7), env.jwtSecret);
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const db = getPostgres();
  const result = await db.query(
    "SELECT id, name, api_key, created_at FROM projects WHERE owner_id = $1 ORDER BY created_at DESC",
    [decoded.userId],
  );

  res.json(result.rows);
});

export default router;
