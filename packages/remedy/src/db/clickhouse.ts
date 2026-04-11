import { createClient, ClickHouseClient } from "@clickhouse/client";
import { env } from "../env.js";

let client: ClickHouseClient | null = null;

export function getClickHouse(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: env.clickhouseUrl,
      database: env.clickhouseDb,
    });
  }
  return client;
}
