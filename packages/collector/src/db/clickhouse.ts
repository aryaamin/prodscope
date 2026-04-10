import { createClient, ClickHouseClient } from "@clickhouse/client";
import { env } from "../env.js";

let client: ClickHouseClient;

export function getClickHouse(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: env.clickhouseUrl,
      database: env.clickhouseDb,
    });
  }
  return client;
}

export async function initClickHouse(): Promise<void> {
  // Create database first (using a client without database set)
  const initClient = createClient({ url: env.clickhouseUrl });
  await initClient.command({
    query: `CREATE DATABASE IF NOT EXISTS ${env.clickhouseDb}`,
  });
  await initClient.close();

  const ch = getClickHouse();

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS spans (
        project_id   String,
        trace_id     String,
        span_id      String,
        parent_span_id String DEFAULT '',
        name         String,
        kind         Enum8('internal'=0, 'server'=1, 'client'=2, 'producer'=3, 'consumer'=4),
        status       Enum8('unset'=0, 'ok'=1, 'error'=2),
        start_time   DateTime64(3, 'UTC'),
        end_time     DateTime64(3, 'UTC'),
        duration_ms  Float64,
        attributes   Map(String, String),
        events       String DEFAULT '[]',
        resource     Map(String, String),
        file         String DEFAULT '',
        line         UInt32 DEFAULT 0,
        function     String DEFAULT '',
        git_sha      String DEFAULT '',
        session_id   String DEFAULT '',
        user_agent   String DEFAULT '',
        created_at   DateTime64(3, 'UTC') DEFAULT now64(3)
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMMDD(start_time)
      ORDER BY (project_id, start_time, trace_id, span_id)
      TTL toDateTime(start_time) + INTERVAL 30 DAY
    `,
  });

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS errors (
        project_id   String,
        trace_id     String,
        span_id      String,
        message      String,
        stack        String,
        file         String,
        line         UInt32,
        column       UInt32 DEFAULT 0,
        function     String DEFAULT '',
        type         String DEFAULT 'Error',
        user_agent   String DEFAULT '',
        session_id   String DEFAULT '',
        git_sha      String DEFAULT '',
        timestamp    DateTime64(3, 'UTC'),
        resolved_stack String DEFAULT '',
        created_at   DateTime64(3, 'UTC') DEFAULT now64(3)
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMMDD(timestamp)
      ORDER BY (project_id, timestamp, file, line)
      TTL toDateTime(timestamp) + INTERVAL 30 DAY
    `,
  });

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS function_stats (
        project_id       String,
        function         String,
        file             String,
        line             UInt32,
        window           Enum8('1h'=0, '24h'=1, '7d'=2, '30d'=3, '90d'=4),
        call_count       UInt64,
        total_ms         Float64,
        avg_ms           Float64,
        p99_ms           Float64,
        error_count      UInt64,
        error_rate       Float64,
        updated_at       DateTime64(3, 'UTC'),
        unique_sessions  UInt64 DEFAULT 0,
        total_sessions   UInt64 DEFAULT 0,
        calls_per_session Float64 DEFAULT 0,
        session_reach_pct Float64 DEFAULT 0,
        p50_ms           Float64 DEFAULT 0
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (project_id, function, file, window)
    `,
  });

  // Daily snapshots — permanent storage, no TTL.
  // One row per project+function+file+date, used for trend analysis and pattern detection.
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS daily_snapshots (
        project_id       String,
        function         String,
        file             String,
        line             UInt32,
        date             Date,
        day_of_week      UInt8,
        hour_bucket      UInt8 DEFAULT 0,
        call_count       UInt64,
        total_ms         Float64,
        avg_ms           Float64,
        p50_ms           Float64,
        p99_ms           Float64,
        error_count      UInt64,
        error_rate       Float64,
        unique_sessions  UInt64,
        total_sessions   UInt64,
        session_reach_pct Float64,
        updated_at       DateTime64(3, 'UTC')
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (project_id, file, function, date, hour_bucket)
    `,
  });

  // Error daily rollups — track error trends over time without needing raw data
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS error_daily_rollups (
        project_id  String,
        file        String,
        function    String,
        error_type  String,
        message     String,
        date        Date,
        day_of_week UInt8,
        count       UInt64,
        unique_sessions UInt64,
        first_seen  DateTime64(3, 'UTC'),
        last_seen   DateTime64(3, 'UTC'),
        updated_at  DateTime64(3, 'UTC')
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (project_id, file, function, error_type, message, date)
    `,
  });

  // Query daily rollups — track DB query performance trends
  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS query_daily_rollups (
        project_id   String,
        file         String,
        table_name   String,
        operation    String,
        date         Date,
        day_of_week  UInt8,
        call_count   UInt64,
        avg_ms       Float64,
        p50_ms       Float64,
        p99_ms       Float64,
        max_ms       Float64,
        total_rows   UInt64,
        updated_at   DateTime64(3, 'UTC')
      )
      ENGINE = ReplacingMergeTree(updated_at)
      ORDER BY (project_id, file, table_name, operation, date)
    `,
  });

  await ch.command({
    query: `
      CREATE TABLE IF NOT EXISTS db_queries (
        project_id   String,
        trace_id     String,
        span_id      String,
        table_name   String,
        operation    String,
        duration_ms  Float64,
        row_count    UInt32 DEFAULT 0,
        file         String DEFAULT '',
        line         UInt32 DEFAULT 0,
        statement    String DEFAULT '',
        session_id   String DEFAULT '',
        timestamp    DateTime64(3, 'UTC'),
        created_at   DateTime64(3, 'UTC') DEFAULT now64(3)
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMMDD(timestamp)
      ORDER BY (project_id, timestamp, duration_ms)
      TTL toDateTime(timestamp) + INTERVAL 30 DAY
    `,
  });
}
