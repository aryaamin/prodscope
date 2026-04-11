import { findCandidateSignatures } from "./watcher.js";
import {
  hashSignature,
  isInCooldown,
  recordAttemptStart,
  finalizeAttempt,
} from "./dedup.js";
import {
  getProjectRepo,
  prepareWorktree,
  commitAndPush,
} from "./resolver.js";
import { gatherTelemetryContext } from "./context.js";
import { runAgent } from "./runner.js";
import {
  branchNameFor,
  commitMessageFor,
  openPullRequest,
} from "./pr.js";
import { notifySuccess, notifyFailure } from "./notifier.js";
import type { ErrorSignature } from "./types.js";

/**
 * Runs one full remediation cycle: watch → resolve → agent → PR → notify.
 * Each signature is processed sequentially to keep the agent runner from
 * thrashing the host. Parallelism can be added later via a job queue.
 */
export async function runOneCycle(): Promise<void> {
  const signatures = await findCandidateSignatures();
  if (signatures.length === 0) {
    console.log("[remedy] no candidate signatures");
    return;
  }

  console.log(`[remedy] found ${signatures.length} candidate signature(s)`);

  for (const sig of signatures) {
    await processSignature(sig).catch((err) => {
      console.error(
        `[remedy] unhandled error processing ${sig.file}:${sig.line}:`,
        err,
      );
    });
  }
}

async function processSignature(sig: ErrorSignature): Promise<void> {
  const hash = hashSignature(sig);
  const label = `${sig.projectId} ${sig.file}:${sig.line} ${sig.errorType} [${hash}]`;

  if (await isInCooldown(sig.projectId, hash)) {
    console.log(`[remedy] skip (cooldown): ${label}`);
    return;
  }

  const repo = await getProjectRepo(sig.projectId);
  if (!repo) {
    console.log(`[remedy] skip (no repo linked): ${label}`);
    return;
  }

  const attemptId = await recordAttemptStart(sig.projectId, hash, sig);
  console.log(`[remedy] start: ${label} attempt=${attemptId}`);

  const branch = branchNameFor(sig, hash);
  let worktree: string | null = null;

  try {
    try {
      worktree = await prepareWorktree(repo, branch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[remedy] resolver failed: ${label}: ${msg}`);
      await finalizeAttempt(attemptId, "resolver_failed", {
        errorMessage: msg,
      });
      await notifyFailure(repo, sig, `Could not clone repo: ${msg}`);
      return;
    }

    const ctx = await gatherTelemetryContext(sig);
    const agent = await runAgent(worktree, ctx);

    if (!agent.success) {
      console.error(
        `[remedy] agent failed: ${label}: ${agent.error ?? "(no error)"}`,
      );
      await finalizeAttempt(attemptId, "agent_failed", {
        errorMessage: agent.error ?? "agent did not succeed",
        agentLog: agent.log,
      });
      await notifyFailure(
        repo,
        sig,
        `Agent failed: ${agent.error ?? "unknown"}`,
      );
      return;
    }

    const pushed = await commitAndPush(
      worktree,
      repo,
      branch,
      commitMessageFor(sig, agent.diffSummary),
    ).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`git push failed: ${msg}`);
    });

    if (!pushed) {
      console.log(`[remedy] agent made no changes: ${label}`);
      await finalizeAttempt(attemptId, "no_changes", {
        agentLog: agent.log,
      });
      return;
    }

    try {
      const pr = await openPullRequest(
        repo,
        branch,
        sig,
        agent.diffSummary,
        agent.filesChanged,
      );
      console.log(`[remedy] PR opened: ${label}: ${pr.url}`);
      await finalizeAttempt(attemptId, "pr_opened", {
        prUrl: pr.url,
        branch,
        agentLog: agent.log,
      });
      await notifySuccess(repo, sig, pr, agent.diffSummary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[remedy] PR creation failed: ${label}: ${msg}`);
      await finalizeAttempt(attemptId, "pr_failed", {
        branch,
        errorMessage: msg,
        agentLog: agent.log,
      });
      await notifyFailure(repo, sig, `PR creation failed: ${msg}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[remedy] unexpected error: ${label}: ${msg}`);
    await finalizeAttempt(attemptId, "agent_failed", { errorMessage: msg });
  }
}
