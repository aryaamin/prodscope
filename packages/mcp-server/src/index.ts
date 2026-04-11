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

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function safeTool(
  name: string,
  description: string,
  schema: any,
  handler: (args: any) => Promise<ToolResult>,
): void {
  server.tool(name, description, schema, async (args: any) => {
    try {
      return await handler(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Tool ${name} failed: ${message}` }],
      };
    }
  });
}

// Tool 1: get_function_stats
safeTool(
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
safeTool(
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

// Tool: get_logs_at_line — user-emitted structured logs from sdk.log()
safeTool(
  "get_logs_at_line",
  "Get recent user-emitted logs (from sdk.log()) for a file and optional line. Shows what was happening in the code around an error.",
  {
    file: z.string().describe("File path"),
    line: z.string().optional().describe("Line number"),
    level: z.string().optional().describe("Filter: debug|info|warn|error"),
    limit: z.string().optional().describe("Max logs to return (default: 50)"),
  },
  async ({ file, line, level, limit }) => {
    const data = await api.getLogsAtLine({ file, line, level, limit });
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
safeTool(
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
safeTool(
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
safeTool(
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
safeTool(
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
safeTool(
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
safeTool(
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

// Tool 9: get_function_trend
safeTool(
  "get_function_trend",
  "Get daily time series for a function over time — see how call count, latency, error rate, and session reach change day by day. Great for spotting gradual degradation or improvement.",
  {
    file: z.string().describe("File path"),
    function: z.string().optional().describe("Function name"),
    days: z.string().optional().describe("Number of days to look back (default: 30, max: 365)"),
  },
  async ({ file, function: fn, days }) => {
    const data = await api.getFunctionTrend({ file, function: fn, days });
    const rows = data.data ?? [];
    if (rows.length === 0) {
      return { content: [{ type: "text" as const, text: "No trend data found. Daily snapshots may not have been generated yet." }] };
    }
    const lines = rows.map((r: any) =>
      `${r.date} (${["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][r.day_of_week] ?? "?"})  ` +
      `calls: ${r.call_count}  |  avg: ${Number(r.avg_ms).toFixed(0)}ms  |  p99: ${Number(r.p99_ms).toFixed(0)}ms  |  ` +
      `errors: ${r.error_count} (${(Number(r.error_rate) * 100).toFixed(1)}%)  |  reach: ${Number(r.session_reach_pct).toFixed(0)}%`
    );
    return { content: [{ type: "text" as const, text: `Trend for ${file}${fn ? `:${fn}` : ""} (${rows.length} days)\n\n${lines.join("\n")}` }] };
  },
);

// Tool 10: get_error_trends
safeTool(
  "get_error_trends",
  "Get daily error count trends grouped by error type and message. Shows how errors are trending over days/weeks.",
  {
    file: z.string().optional().describe("File path to filter by"),
    days: z.string().optional().describe("Number of days (default: 30)"),
  },
  async ({ file, days }) => {
    const data = await api.getErrorTrends({ file, days });
    return { content: [{ type: "text" as const, text: JSON.stringify(data.data ?? [], null, 2) }] };
  },
);

// Tool 11: get_time_of_day_pattern
safeTool(
  "get_time_of_day_pattern",
  "Get hourly traffic and error heatmap — which hours of the day have the most traffic, highest error rates, and worst latency.",
  {
    file: z.string().optional().describe("File path"),
    function: z.string().optional().describe("Function name"),
  },
  async ({ file, function: fn }) => {
    const data = await api.getTimeOfDayPattern({ file, function: fn });
    const rows = data.data ?? [];
    if (rows.length === 0) {
      return { content: [{ type: "text" as const, text: "No hourly pattern data found yet." }] };
    }
    const lines = rows.map((r: any) =>
      `${String(r.hour).padStart(2, "0")}:00  calls: ${r.call_count}  |  avg: ${Number(r.avg_ms).toFixed(0)}ms  |  ` +
      `p99: ${Number(r.p99_ms).toFixed(0)}ms  |  errors: ${r.error_count} (${(Number(r.error_rate) * 100).toFixed(1)}%)`
    );
    return { content: [{ type: "text" as const, text: `Hourly Pattern (last 7 days)\n\n${lines.join("\n")}` }] };
  },
);

// Tool 12: get_weekday_weekend_pattern
safeTool(
  "get_weekday_weekend_pattern",
  "Compare weekday vs weekend behavior — traffic volume, latency, error rates, and user counts.",
  {
    file: z.string().optional().describe("File path"),
    function: z.string().optional().describe("Function name"),
  },
  async ({ file, function: fn }) => {
    const data = await api.getWeekdayWeekendPattern({ file, function: fn });
    const rows = data.data ?? [];
    if (rows.length === 0) {
      return { content: [{ type: "text" as const, text: "No weekday/weekend data found yet." }] };
    }
    const lines = rows.map((r: any) =>
      `${r.period.toUpperCase()}\n` +
      `  Calls: ${r.call_count}  |  avg: ${Number(r.avg_ms).toFixed(0)}ms  |  p99: ${Number(r.p99_ms).toFixed(0)}ms\n` +
      `  Errors: ${r.error_count} (${(Number(r.error_rate) * 100).toFixed(1)}%)  |  Sessions: ${r.unique_sessions}`
    );
    return { content: [{ type: "text" as const, text: lines.join("\n\n") }] };
  },
);

// Tool 13: compare_periods
safeTool(
  "compare_periods",
  "Compare two arbitrary date ranges side by side — e.g., this week vs last week, or before/after a release.",
  {
    period1_start: z.string().describe("Start date of first period (YYYY-MM-DD)"),
    period1_end: z.string().describe("End date of first period (YYYY-MM-DD)"),
    period2_start: z.string().describe("Start date of second period (YYYY-MM-DD)"),
    period2_end: z.string().describe("End date of second period (YYYY-MM-DD)"),
    file: z.string().optional().describe("File path to filter by"),
    function: z.string().optional().describe("Function name to filter by"),
  },
  async ({ period1_start, period1_end, period2_start, period2_end, file, function: fn }) => {
    const data = await api.comparePeriods({
      period1_start, period1_end, period2_start, period2_end, file, function: fn,
    });
    const d = data.diff ?? {};
    const text = [
      `Period 1 (${period1_start} to ${period1_end}):`,
      `  Calls: ${data.period1?.call_count ?? 0}  |  avg: ${Number(data.period1?.avg_ms ?? 0).toFixed(0)}ms  |  errors: ${(Number(data.period1?.error_rate ?? 0) * 100).toFixed(1)}%`,
      ``,
      `Period 2 (${period2_start} to ${period2_end}):`,
      `  Calls: ${data.period2?.call_count ?? 0}  |  avg: ${Number(data.period2?.avg_ms ?? 0).toFixed(0)}ms  |  errors: ${(Number(data.period2?.error_rate ?? 0) * 100).toFixed(1)}%`,
      ``,
      `Changes:`,
      `  Calls: ${d.call_count_change > 0 ? "+" : ""}${d.call_count_change ?? 0}`,
      `  Avg latency: ${d.avg_ms_change > 0 ? "+" : ""}${Number(d.avg_ms_change ?? 0).toFixed(1)}ms`,
      `  Error rate: ${d.error_rate_change > 0 ? "+" : ""}${(Number(d.error_rate_change ?? 0) * 100).toFixed(2)}%`,
    ].join("\n");
    return { content: [{ type: "text" as const, text }] };
  },
);

// Tool 14: get_analysis
safeTool(
  "get_analysis",
  "Get AI-powered deep analysis of production data. Types: 'anomalies' (deviations from baselines), 'root_cause' (why things broke), 'patterns' (time/day behaviors), 'issues' (proactive problem detection ranked by impact), 'weekly_digest' (comprehensive weekly report).",
  {
    type: z
      .enum(["anomalies", "root_cause", "patterns", "issues", "weekly_digest"])
      .describe("Type of analysis to retrieve"),
    refresh: z
      .enum(["true", "false"])
      .optional()
      .describe("Force regeneration (default: false, uses cached)"),
  },
  async ({ type, refresh }) => {
    if (refresh === "true") {
      const result = await api.triggerAnalysis(type, true);
      return {
        content: [{
          type: "text" as const,
          text: result.analysis ?? `Analysis triggered. Status: ${result.status ?? "unknown"}`,
        }],
      };
    }

    const data = await api.getAnalysis(type);
    if (data.analysis) {
      const age = data.generatedAt
        ? `\n\n---\nGenerated: ${data.generatedAt} | Data points analyzed: ${data.dataPoints ?? "?"}`
        : "";
      return { content: [{ type: "text" as const, text: data.analysis + age }] };
    }

    // No cached result — trigger generation
    await api.triggerAnalysis(type, false);
    return {
      content: [{
        type: "text" as const,
        text: `No cached ${type} analysis found. Generation has been triggered — try again in a minute.`,
      }],
    };
  },
);

// ─── Developer Code Intelligence Tools ──────────────────────────────

// Tool 15: pre_edit_briefing
safeTool(
  "pre_edit_briefing",
  "Get a production briefing before editing a file or function. Tells you: current health, known errors with exact lines, who's affected, DB query issues, danger zones. Like a handoff note from the on-call engineer.",
  {
    file: z.string().describe("File path you're about to edit"),
    function: z.string().optional().describe("Specific function (optional — omit for whole-file briefing)"),
  },
  async ({ file, function: fn }) => {
    const data = await api.runCodeIntel("pre_edit_briefing", { file, function: fn });
    return { content: [{ type: "text" as const, text: data.result ?? "No briefing available." }] };
  },
);

// Tool 16: suggest_fix
safeTool(
  "suggest_fix",
  "Analyze production errors for a file/function and suggest specific code fixes. For each error: root cause analysis, exact fix with pseudocode, and how to verify the fix worked. Also surfaces slow queries and performance fixes.",
  {
    file: z.string().describe("File path with issues"),
    function: z.string().optional().describe("Specific function to analyze"),
  },
  async ({ file, function: fn }) => {
    const data = await api.runCodeIntel("suggest_fix", { file, function: fn });
    return { content: [{ type: "text" as const, text: data.result ?? "No fix suggestions — no errors found for this code." }] };
  },
);

// Tool 17: verify_fix
safeTool(
  "verify_fix",
  "Check whether a deployed fix actually worked by comparing before/after production data. Gives a verdict (YES/PARTIALLY/NO), shows error rate change, latency impact, and remaining issues.",
  {
    file: z.string().describe("File that was fixed"),
    function: z.string().optional().describe("Specific function that was fixed"),
    beforeSha: z.string().describe("Git SHA before the fix"),
    afterSha: z.string().describe("Git SHA after the fix"),
  },
  async ({ file, function: fn, beforeSha, afterSha }) => {
    const data = await api.runCodeIntel("verify_fix", { file, function: fn, beforeSha, afterSha });
    return { content: [{ type: "text" as const, text: data.result ?? "Not enough data to verify yet." }] };
  },
);

// Tool 18: dev_priority_queue
safeTool(
  "dev_priority_queue",
  "Get a prioritized list of what to fix next, ranked by user impact. Each item has: the specific problem, which file:line, how many users it affects, difficulty estimate, the exact fix to apply, and expected result.",
  {},
  async () => {
    const data = await api.runCodeIntel("dev_priority_queue", {});
    return { content: [{ type: "text" as const, text: data.result ?? "No issues found — codebase is clean." }] };
  },
);

// Tool 19: trace_symptom
safeTool(
  "trace_symptom",
  "Trace a user-reported problem back to the responsible code. Give it a symptom like 'checkout is slow' or 'login fails on mobile' and it searches production data to find the exact function, error, and line responsible.",
  {
    symptom: z.string().describe("User-reported symptom or problem description (e.g., 'checkout timeout', 'blank page on Safari', 'order stuck')"),
  },
  async ({ symptom }) => {
    const data = await api.runCodeIntel("trace_symptom", { symptom });
    return { content: [{ type: "text" as const, text: data.result ?? "No matching production data found for this symptom." }] };
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
