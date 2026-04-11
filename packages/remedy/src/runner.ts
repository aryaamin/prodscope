import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { env } from "./env.js";
import type { AgentResult } from "./types.js";
import type { TelemetryContext } from "./context.js";
import { formatContextForPrompt } from "./context.js";

function buildPrompt(ctx: TelemetryContext): string {
  const telemetry = formatContextForPrompt(ctx);
  const { signature: sig } = ctx;
  return `You are Remedy, an autonomous agent that fixes production bugs using live telemetry.

A real error is firing in production. Your job is to read the relevant code in this repository, find the root cause, and apply a minimal, correct fix.

${telemetry}

## Your task

1. Read \`${sig.file}\` (and any other files you need) to understand the code.
2. Diagnose the root cause based on the telemetry above. Focus on line ${sig.line} and the function \`${sig.functionName || "(whole file)"}\`.
3. Apply a minimal, surgical fix. Do not refactor unrelated code. Do not add features.
4. If the bug is a null/undefined access, validate at the source — do not just paper over it with a try/catch.
5. If you genuinely cannot determine a safe fix from the evidence (e.g. you need runtime state you don't have), DO NOT guess. Instead, make NO file changes and explain why in your final message.
6. Prefer adding a focused regression test if a test file already exists next to the changed file. Do not scaffold a test framework if none exists.
7. When you are done, your final assistant message MUST be a short markdown summary with these sections:

### Diagnosis
One or two sentences naming the root cause, citing \`file:line\`.

### Fix
What you changed and why, one or two sentences.

### Risk
Any concern a reviewer should know about. "None" is an acceptable answer.

Rules:
- Use only the tools available: Read, Edit, Write, Grep, Glob, Bash (for running tests/typecheck).
- Do not run destructive git commands. Do not commit or push — Remedy's orchestrator handles git.
- Do not touch files outside this repository.
- Keep the total number of edited files small. One or two is ideal.
- If you run tests, keep them scoped to the affected area; do not run the entire suite.`;
}

export async function runAgent(
  cwd: string,
  ctx: TelemetryContext,
): Promise<AgentResult> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), env.agentTimeoutMs);

  const logParts: string[] = [];
  let finalText = "";
  const filesChanged = new Set<string>();
  let success = false;
  let errorMessage: string | undefined;

  try {
    const q = query({
      prompt: buildPrompt(ctx),
      options: {
        cwd,
        abortController: abort,
        maxTurns: env.agentTurnLimit,
        permissionMode: "bypassPermissions",
        allowedTools: ["Read", "Edit", "Write", "Grep", "Glob", "Bash"],
        disallowedTools: [
          "WebFetch",
          "WebSearch",
          "Task",
          "NotebookEdit",
        ],
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: env.anthropicApiKey,
          CLAUDE_AGENT_SDK_CLIENT_APP: "prodscope-remedy/0.1.0",
        },
      },
    });

    for await (const msg of q as AsyncIterable<SDKMessage>) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content ?? []) {
          if (block.type === "text") {
            logParts.push(`[assistant] ${block.text}`);
            finalText = block.text;
          } else if (block.type === "tool_use") {
            const name = block.name;
            const input = block.input as Record<string, unknown>;
            logParts.push(
              `[tool] ${name} ${JSON.stringify(input).slice(0, 300)}`,
            );
            if (
              (name === "Edit" || name === "Write") &&
              typeof input.file_path === "string"
            ) {
              filesChanged.add(input.file_path);
            }
          }
        }
      } else if (msg.type === "result") {
        if (msg.subtype === "success") {
          success = true;
          if (msg.result) finalText = msg.result;
        } else {
          success = false;
          errorMessage = `agent result error: ${msg.subtype}`;
        }
        logParts.push(
          `[result] subtype=${msg.subtype} turns=${msg.num_turns} cost=$${msg.total_cost_usd?.toFixed?.(4) ?? "?"}`,
        );
      }
    }
  } catch (err) {
    errorMessage =
      err instanceof Error ? err.message : `agent threw: ${String(err)}`;
  } finally {
    clearTimeout(timeout);
  }

  return {
    success,
    diffSummary: finalText,
    filesChanged: Array.from(filesChanged),
    log: logParts.join("\n"),
    error: errorMessage,
  };
}
