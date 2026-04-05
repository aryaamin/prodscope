import { SourceMapConsumer, type RawSourceMap } from "source-map";
import { getPostgres } from "../db/postgres.js";

interface ResolvedLocation {
  file: string;
  line: number;
  column: number;
  function: string;
}

const consumerCache = new Map<string, SourceMapConsumer>();

async function getConsumer(
  projectId: string,
  fileName: string,
  gitSha: string,
): Promise<SourceMapConsumer | null> {
  const cacheKey = `${projectId}:${fileName}:${gitSha}`;
  if (consumerCache.has(cacheKey)) {
    return consumerCache.get(cacheKey)!;
  }

  const db = getPostgres();
  const result = await db.query(
    `SELECT map_data FROM source_maps
     WHERE project_id = $1 AND file_name = $2 AND git_sha = $3
     ORDER BY uploaded_at DESC LIMIT 1`,
    [projectId, fileName, gitSha],
  );

  if (result.rows.length === 0) return null;

  const rawMap: RawSourceMap = JSON.parse(result.rows[0].map_data);
  const consumer = await new SourceMapConsumer(rawMap);
  consumerCache.set(cacheKey, consumer);
  return consumer;
}

export async function resolveStack(
  projectId: string,
  stack: string,
  gitSha: string,
): Promise<string> {
  // Match lines like "at functionName (file.js:10:20)" or "at file.js:10:20"
  const frameRegex =
    /at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/g;

  let resolved = stack;
  let match: RegExpExecArray | null;

  while ((match = frameRegex.exec(stack)) !== null) {
    const [fullMatch, fnName, file, lineStr, colStr] = match;
    const line = parseInt(lineStr, 10);
    const col = parseInt(colStr, 10);

    const consumer = await getConsumer(projectId, file, gitSha);
    if (!consumer) continue;

    const pos = consumer.originalPositionFor({ line, column: col });
    if (pos.source) {
      const resolvedFrame = `at ${pos.name ?? fnName ?? "<anonymous>"} (${pos.source}:${pos.line}:${pos.column})`;
      resolved = resolved.replace(fullMatch, resolvedFrame);
    }
  }

  return resolved;
}

export async function resolveLocation(
  projectId: string,
  fileName: string,
  line: number,
  column: number,
  gitSha: string,
): Promise<ResolvedLocation | null> {
  const consumer = await getConsumer(projectId, fileName, gitSha);
  if (!consumer) return null;

  const pos = consumer.originalPositionFor({ line, column });
  if (!pos.source) return null;

  return {
    file: pos.source,
    line: pos.line ?? line,
    column: pos.column ?? column,
    function: pos.name ?? "",
  };
}
