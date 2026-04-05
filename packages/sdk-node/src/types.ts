export interface ProdScopeConfig {
  projectId: string;
  apiKey: string;
  ingestUrl?: string;
  gitSha?: string;
  capture?: {
    fetches?: boolean;
    errors?: boolean;
    dbQueries?: boolean;
    functions?: boolean;
  };
}

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: "internal" | "server" | "client" | "producer" | "consumer";
  status?: "unset" | "ok" | "error";
  startTime: string;
  endTime: string;
  durationMs: number;
  attributes?: Record<string, string>;
  file?: string;
  line?: number;
  function?: string;
  gitSha?: string;
  sessionId?: string;
  userAgent?: string;
}

export interface ErrorData {
  traceId?: string;
  spanId?: string;
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  column?: number;
  function?: string;
  type?: string;
  userAgent?: string;
  sessionId?: string;
  gitSha?: string;
  timestamp: string;
}

export interface DbQueryData {
  traceId?: string;
  spanId?: string;
  tableName: string;
  operation: string;
  durationMs: number;
  rowCount?: number;
  file?: string;
  line?: number;
  statement?: string;
  sessionId?: string;
  timestamp: string;
}

export interface IngestBatch {
  spans?: SpanData[];
  errors?: ErrorData[];
  dbQueries?: DbQueryData[];
}
