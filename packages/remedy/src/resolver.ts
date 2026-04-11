import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { getPostgres } from "./db/postgres.js";
import { env } from "./env.js";
import type { ProjectRepo } from "./types.js";

const exec = promisify(execFile);

export async function getProjectRepo(
  projectId: string,
): Promise<ProjectRepo | null> {
  const db = getPostgres();
  const { rows } = await db.query(
    `SELECT project_id, repo_url, default_branch, github_owner, github_repo,
            slack_webhook_url, notify_emails, enabled
     FROM project_repos
     WHERE project_id = $1`,
    [projectId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  if (!r.enabled) return null;
  return {
    projectId: r.project_id,
    repoUrl: r.repo_url,
    defaultBranch: r.default_branch,
    githubOwner: r.github_owner,
    githubRepo: r.github_repo,
    slackWebhookUrl: r.slack_webhook_url ?? "",
    notifyEmails: (r.notify_emails ?? "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean),
    enabled: r.enabled,
  };
}

function authedUrl(repo: ProjectRepo): string {
  if (!env.githubToken) return repo.repoUrl;
  return repo.repoUrl.replace(
    /^https:\/\//,
    `https://x-access-token:${env.githubToken}@`,
  );
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function run(
  cwd: string,
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return await exec(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024 });
}

/**
 * Prepares a clean worktree on a fresh branch based off the default branch.
 * Re-uses an existing clone if present (fetches + hard resets).
 */
export async function prepareWorktree(
  repo: ProjectRepo,
  branchName: string,
): Promise<string> {
  const root = path.join(env.worktreeRoot, repo.projectId);
  await mkdir(path.dirname(root), { recursive: true });

  const url = authedUrl(repo);

  if (!(await exists(path.join(root, ".git")))) {
    await mkdir(path.dirname(root), { recursive: true });
    await exec("git", ["clone", "--depth=50", url, root], {
      maxBuffer: 64 * 1024 * 1024,
    });
  } else {
    await run(root, "git", ["remote", "set-url", "origin", url]);
    await run(root, "git", ["fetch", "origin", repo.defaultBranch]);
  }

  await run(root, "git", ["checkout", repo.defaultBranch]);
  await run(root, "git", [
    "reset",
    "--hard",
    `origin/${repo.defaultBranch}`,
  ]);
  await run(root, "git", ["clean", "-fdx"]);

  // Delete stale local branch with the same name, if any.
  try {
    await run(root, "git", ["branch", "-D", branchName]);
  } catch {
    // not present — fine
  }
  await run(root, "git", ["checkout", "-b", branchName]);

  await run(root, "git", ["config", "user.name", env.githubAuthorName]);
  await run(root, "git", ["config", "user.email", env.githubAuthorEmail]);

  return root;
}

export async function commitAndPush(
  cwd: string,
  repo: ProjectRepo,
  branch: string,
  message: string,
): Promise<boolean> {
  const status = await run(cwd, "git", ["status", "--porcelain"]);
  if (!status.stdout.trim()) return false;

  await run(cwd, "git", ["add", "-A"]);
  await run(cwd, "git", ["commit", "-m", message]);
  await run(cwd, "git", ["push", "-u", "origin", branch]);
  return true;
}

export async function cleanupWorktree(cwd: string): Promise<void> {
  try {
    await rm(cwd, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}
