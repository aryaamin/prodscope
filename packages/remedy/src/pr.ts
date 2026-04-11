import { Octokit } from "@octokit/rest";
import { env } from "./env.js";
import type { ErrorSignature, ProjectRepo, RemedyPR } from "./types.js";

let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    if (!env.githubToken) {
      throw new Error("GITHUB_TOKEN is not configured");
    }
    octokit = new Octokit({ auth: env.githubToken });
  }
  return octokit;
}

export function branchNameFor(sig: ErrorSignature, hash: string): string {
  const slugFile = sig.file
    .replace(/^.*\//, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 40);
  return `remedy/${slugFile}-${hash}`;
}

export function commitMessageFor(
  sig: ErrorSignature,
  agentSummary: string,
): string {
  const first = agentSummary.split("\n").find((l) => l.trim()) ?? "fix error";
  const subject = `fix(${sig.file.split("/").pop() ?? sig.file}): ${sig.errorType} at line ${sig.line}`;
  return `${subject}\n\n${first}\n\nRemedy-signature: ${sig.errorType}@${sig.file}:${sig.line}\nRemedy-occurrences: ${sig.occurrences}`;
}

export function prBodyFor(
  sig: ErrorSignature,
  agentSummary: string,
  filesChanged: string[],
): string {
  return `## 🩹 Remedy auto-fix

Prodscope detected **${sig.occurrences}** occurrences of \`${sig.errorType}\` in \`${sig.file}:${sig.line}\` across **${sig.uniqueSessions}** sessions (first seen ${sig.firstSeen}, last seen ${sig.lastSeen}).

${agentSummary}

---

**Files changed:** ${filesChanged.map((f) => `\`${f}\``).join(", ") || "(none detected)"}

**Error message:** \`${sig.message.slice(0, 500)}\`

**Function:** \`${sig.functionName || "(unknown)"}\`

---

> This PR was opened automatically by [Remedy](https://github.com/anthropics/claude-agent-sdk) — prodscope's AI remediation agent. It is marked as a **draft** because every auto-fix should be reviewed by a human before merge. Close the PR if the diagnosis is wrong; the error signature will cool down and Remedy won't retry it.`;
}

export async function openPullRequest(
  repo: ProjectRepo,
  branch: string,
  sig: ErrorSignature,
  agentSummary: string,
  filesChanged: string[],
): Promise<RemedyPR> {
  const gh = getOctokit();
  const { data } = await gh.pulls.create({
    owner: repo.githubOwner,
    repo: repo.githubRepo,
    head: branch,
    base: repo.defaultBranch,
    title: `remedy: fix ${sig.errorType} in ${sig.file.split("/").pop()}:${sig.line}`,
    body: prBodyFor(sig, agentSummary, filesChanged),
    draft: true,
    maintainer_can_modify: true,
  });

  return {
    url: data.html_url,
    number: data.number,
    branch,
  };
}
