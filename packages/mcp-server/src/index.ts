#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { ApiClient } from "./api-client.js";

const config = loadConfig();
const api = new ApiClient(config);

const server = new McpServer({
  name: "prodscope",
  version: "0.1.0",
});

// Tool 1: get_function_stats
server.tool(
  "get_function_stats",
  "Get detailed production metrics for a function: call count, p50/p99 latency, error count/rate, unique sessions, session reach %, and calls per session. Available across time windows (1h, 24h, 7d).",
  {
    function: z.string().optional().describe("Function name to look up"),
    file: z.string().optional().describe("File path to filter by"),
    window: z
      .enum(["1h", "24h", "7d"])
      .optional()
      .describe("Time window (default: all)"),
  },
  async ({ function: fn, file, window }) => {
    const data = await api.getFunctionStats({
      function: fn,
      file,
      window,
    });
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return { content: [{ type: "text" as const, text: "No function stats found for the given filters." }] };
    }
    const lines = rows.map((r: any) =>
      `${r.function} (${r.file}:${r.line}) [${r.window}]\n` +
      `  Calls: ${r.call_count}  |  p50: ${Number(r.p50_ms).toFixed(0)}ms  |  p99: ${Number(r.p99_ms).toFixed(0)}ms  |  avg: ${Number(r.avg_ms).toFixed(0)}ms\n` +
      `  Errors: ${r.error_count} (${(Number(r.error_rate) * 100).toFixed(1)}%)\n` +
      `  Sessions: ${r.unique_sessions}/${r.total_sessions} (${Number(r.session_reach_pct).toFixed(0)}% of users)  |  ${Number(r.calls_per_session).toFixed(1)}x per session`
    );
    return {
      content: [{ type: "text" as const, text: lines.join("\n\n") }],
    };
  },
);

// Tool 2: get_errors_at_line
server.tool(
  "get_errors_at_line",
  "Get recent errors resolved to a specific file and line, with stack traces and user context.",
  {
    file: z.string().describe("File path"),
    line: z.string().optional().describe("Line number"),
    limit: z.string().optional().describe("Max errors to return (default: 50)"),
  },
  async ({ file, line, limit }) => {
    const data = await api.getErrorsAtLine({ file, line, limit });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  },
);

// Tool 3: get_slow_queries
server.tool(
  "get_slow_queries",
  "Get database queries above a latency threshold, with calling file and line.",
  {
    threshold: z
      .string()
      .optional()
      .describe("Minimum duration in ms (default: 100)"),
    file: z.string().optional().describe("Filter by calling file"),
  },
  async ({ threshold, file }) => {
    const data = await api.getSlowQueries({ threshold, file });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  },
);

// Tool 4: get_ai_insight
server.tool(
  "get_ai_insight",
  "Get Claude-generated natural language insight for a file or function — describes what is happening, who is affected, and what to do.",
  {
    file: z.string().describe("File path"),
    function: z.string().optional().describe("Function name"),
    refresh: z
      .enum(["true", "false"])
      .optional()
      .describe("Force regeneration (default: false)"),
  },
  async ({ file, function: fn, refresh }) => {
    const data = await api.getAiInsight({ file, function: fn, refresh });
    return {
      content: [
        {
          type: "text" as const,
          text: data.insight ?? JSON.stringify(data, null, 2),
        },
      ],
    };
  },
);

// Tool 5: get_live_sessions
server.tool(
  "get_live_sessions",
  "Get active user count in a given route or flow right now.",
  {
    route: z.string().optional().describe("HTTP route to filter by"),
  },
  async ({ route }) => {
    const data = await api.getLiveSessions({ route });
    return {
      content: [
        {
          type: "text" as const,
          text: `Active sessions: ${data.activeSessions}`,
        },
      ],
    };
  },
);

// Tool 6: get_trace
server.tool(
  "get_trace",
  "Get the full distributed trace for a session — every span from click to DB query.",
  {
    traceId: z.string().describe("Trace ID to look up"),
  },
  async ({ traceId }) => {
    const data = await api.getTrace(traceId);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  },
);

// Tool 7: get_hot_paths
server.tool(
  "get_hot_paths",
  "Get the most-called code paths ranked by traffic volume. Includes call count, latency, error rate, session reach, and calls per session.",
  {
    window: z
      .enum(["1h", "24h", "7d"])
      .optional()
      .describe("Time window (default: 1h)"),
  },
  async ({ window }) => {
    const data = await api.getHotPaths({ window });
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
      return { content: [{ type: "text" as const, text: "No hot paths found." }] };
    }
    const lines = rows.map((r: any, i: number) =>
      `#${i + 1} ${r.function} (${r.file}:${r.line})\n` +
      `   ${r.call_count} calls  |  p50 ${Number(r.p50_ms || r.avg_ms).toFixed(0)}ms  |  ${(Number(r.error_rate) * 100).toFixed(1)}% errors  |  ${Number(r.session_reach_pct || 0).toFixed(0)}% users`
    );
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  },
);

// Tool 8: compare_deploys
server.tool(
  "compare_deploys",
  "Diff error rates and latency between two git SHAs to detect regressions.",
  {
    sha1: z.string().describe("First git SHA (baseline)"),
    sha2: z.string().describe("Second git SHA (comparison)"),
  },
  async ({ sha1, sha2 }) => {
    const data = await api.compareDeploys({ sha1, sha2 });
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  },
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
