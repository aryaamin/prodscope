import { env } from "./env.js";
import { bootstrapRemedySchema, getPostgres } from "./db/postgres.js";
import { runOneCycle } from "./orchestrator.js";

let stopping = false;
let activeCycle: Promise<void> | null = null;

async function main() {
  if (!env.anthropicApiKey) {
    console.warn(
      "[remedy] ANTHROPIC_API_KEY not set — agent runs will fail. Set it in .env before enabling.",
    );
  }
  if (!env.githubToken) {
    console.warn(
      "[remedy] GITHUB_TOKEN not set — PRs will not be opened. Set it in .env before enabling.",
    );
  }

  console.log("[remedy] bootstrapping schema…");
  await bootstrapRemedySchema();

  console.log(
    `[remedy] watcher loop starting (interval=${env.pollIntervalMs}ms, threshold=${env.errorThreshold}/${env.errorWindowHours}h, cooldown=${env.cooldownHours}h)`,
  );

  const loop = async () => {
    while (!stopping) {
      activeCycle = runOneCycle().catch((err) => {
        console.error("[remedy] cycle failed:", err);
      });
      await activeCycle;
      activeCycle = null;
      if (stopping) break;
      await sleep(env.pollIntervalMs);
    }
  };

  const shutdown = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[remedy] received ${sig}, draining…`);
    if (activeCycle) {
      await activeCycle.catch(() => {});
    }
    try {
      await getPostgres().end();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await loop();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

main().catch((err) => {
  console.error("[remedy] fatal:", err);
  process.exit(1);
});
