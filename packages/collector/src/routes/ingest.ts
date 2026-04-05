import { Router, type Request, type Response } from "express";
import { getClickHouse } from "../db/clickhouse.js";
import { resolveStack, resolveLocation } from "../services/source-map-resolver.js";
import { broadcast } from "../services/websocket.js";
import { z } from "zod";

const router = Router();

const SpanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional().default(""),
  name: z.string(),
  kind: z.enum(["internal", "server", "client", "producer", "consumer"]).default("internal"),
  status: z.enum(["unset", "ok", "error"]).default("unset"),
  startTime: z.string(),
  endTime: z.string(),
  durationMs: z.number(),
  attributes: z.record(z.string()).optional().default({}),
  events: z.array(z.any()).optional().default([]),
  resource: z.record(z.string()).optional().default({}),
  file: z.string().optional().default(""),
  line: z.number().optional().default(0),
  function: z.string().optional().default(""),
  gitSha: z.string().optional().default(""),
  sessionId: z.string().optional().default(""),
  userAgent: z.string().optional().default(""),
});

const IngestBatchSchema = z.object({
  spans: z.array(SpanSchema).optional().default([]),
  errors: z
    .array(
      z.object({
        traceId: z.string().optional().default(""),
        spanId: z.string().optional().default(""),
        message: z.string(),
        stack: z.string().optional().default(""),
        file: z.string().optional().default(""),
        line: z.number().optional().default(0),
        column: z.number().optional().default(0),
        function: z.string().optional().default(""),
        type: z.string().optional().default("Error"),
        userAgent: z.string().optional().default(""),
        sessionId: z.string().optional().default(""),
        gitSha: z.string().optional().default(""),
        timestamp: z.string(),
      }),
    )
    .optional()
    .default([]),
  dbQueries: z
    .array(
      z.object({
        traceId: z.string().optional().default(""),
        spanId: z.string().optional().default(""),
        tableName: z.string(),
        operation: z.string(),
        durationMs: z.number(),
        rowCount: z.number().optional().default(0),
        file: z.string().optional().default(""),
        line: z.number().optional().default(0),
        statement: z.string().optional().default(""),
        sessionId: z.string().optional().default(""),
        timestamp: z.string(),
      }),
    )
    .optional()
    .default([]),
});

router.post("/v1/ingest", async (req: Request, res: Response) => {
  const projectId = (req as any).projectId as string;
  const parsed = IngestBatchSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    return;
  }

  const { spans, errors, dbQueries } = parsed.data;
  const ch = getClickHouse();

  // Insert spans
  if (spans.length > 0) {
    await ch.insert({
      table: "spans",
      values: spans.map((s) => ({
        project_id: projectId,
        trace_id: s.traceId,
        span_id: s.spanId,
        parent_span_id: s.parentSpanId,
        name: s.name,
        kind: s.kind,
        status: s.status,
        start_time: s.startTime,
        end_time: s.endTime,
        duration_ms: s.durationMs,
        attributes: s.attributes,
        events: JSON.stringify(s.events),
        resource: s.resource,
        file: s.file,
        line: s.line,
        function: s.function,
        git_sha: s.gitSha,
        session_id: s.sessionId,
        user_agent: s.userAgent,
      })),
      format: "JSONEachRow",
    });

    broadcast(projectId, { type: "spans", data: spans });
  }

  // Insert errors with source-map resolution
  if (errors.length > 0) {
    const resolvedErrors = await Promise.all(
      errors.map(async (e) => {
        let resolvedStack = "";
        if (e.stack && e.gitSha) {
          resolvedStack = await resolveStack(projectId, e.stack, e.gitSha);
        }
        let file = e.file;
        let line = e.line;
        let column = e.column;
        let fn = e.function;

        if (e.file && e.gitSha) {
          const loc = await resolveLocation(projectId, e.file, e.line, e.column, e.gitSha);
          if (loc) {
            file = loc.file;
            line = loc.line;
            column = loc.column;
            fn = loc.function || fn;
          }
        }

        return {
          project_id: projectId,
          trace_id: e.traceId,
          span_id: e.spanId,
          message: e.message,
          stack: e.stack,
          file,
          line,
          column,
          function: fn,
          type: e.type,
          user_agent: e.userAgent,
          session_id: e.sessionId,
          git_sha: e.gitSha,
          timestamp: e.timestamp,
          resolved_stack: resolvedStack,
        };
      }),
    );

    await ch.insert({
      table: "errors",
      values: resolvedErrors,
      format: "JSONEachRow",
    });

    broadcast(projectId, { type: "errors", data: resolvedErrors });
  }

  // Insert DB queries
  if (dbQueries.length > 0) {
    await ch.insert({
      table: "db_queries",
      values: dbQueries.map((q) => ({
        project_id: projectId,
        trace_id: q.traceId,
        span_id: q.spanId,
        table_name: q.tableName,
        operation: q.operation,
        duration_ms: q.durationMs,
        row_count: q.rowCount,
        file: q.file,
        line: q.line,
        statement: q.statement,
        session_id: q.sessionId,
        timestamp: q.timestamp,
      })),
      format: "JSONEachRow",
    });

    broadcast(projectId, { type: "dbQueries", data: dbQueries });
  }

  res.status(202).json({
    accepted: spans.length + errors.length + dbQueries.length,
  });
});

export default router;
