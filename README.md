# ProdScope

Developer observability platform -- production data mapped to your code.

ProdScope captures errors, latency, database queries, and user sessions from production, then surfaces them directly in your editor with file:line precision.

## Packages

| Package | Description |
|---------|-------------|
| [`@prodscope/collector`](packages/collector/) | Backend ingest server, aggregation, and API (Express + ClickHouse + PostgreSQL) |
| [`@prodscope/sdk-browser`](packages/sdk-browser/) | Browser SDK with auto-tracking for fetches, errors, clicks, and functions |
| [`@prodscope/sdk-node`](packages/sdk-node/) | Node.js SDK with Express, pg, and Prisma middleware |
| [`@prodscope/sdk-edge`](packages/sdk-edge/) | Lightweight SDK for Cloudflare Workers, Deno Deploy, and Supabase Edge Functions |
| [`@prodscope/mcp-server`](packages/mcp-server/) | MCP server exposing telemetry as Claude AI tools |
| [`prodscope-vscode`](packages/vscode-extension/) | VS Code extension with CodeLens, inline decorations, and AI insights |
| [`@prodscope/dashboard`](packages/dashboard/) | React SPA for user/project management |
| [`@prodscope/website`](packages/website/) | Marketing and documentation site |

## Architecture

```
Browser/Node/Edge SDK
    | POST /v1/ingest
    v
Collector (Express)
    | insert
    v
ClickHouse (spans, errors, db_queries)
PostgreSQL (users, projects, source_maps, ai_insights)
    | query GET /api/v1/*
    v
VS Code Extension / MCP Server / Dashboard
```

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- ClickHouse
- PostgreSQL

### Setup

```bash
# Install dependencies
pnpm install

# Copy environment config
cp .env.example .env
# Edit .env with your database URLs and API keys

# Build all packages
pnpm build

# Start the collector in dev mode
pnpm --filter @prodscope/collector dev
```

### SDK Quick Start (Browser)

```ts
import { init } from "@prodscope/sdk-browser";

init({
  projectId: "your-project-id",
  apiKey: "your-api-key",
  ingestUrl: "http://localhost:3100",
});
```

### SDK Quick Start (Node.js)

```ts
import { init } from "@prodscope/sdk-node";
import { prodscope as expressMiddleware } from "@prodscope/sdk-node/express";

init({
  projectId: "your-project-id",
  apiKey: "your-api-key",
  ingestUrl: "http://localhost:3100",
});

app.use(expressMiddleware());
```

### VS Code Extension

1. Install the extension from the marketplace or build locally
2. Create a `prodscope.config.ts` in your project root (see [prodscope.config.example.ts](prodscope.config.example.ts))
3. Open a file -- CodeLens annotations and inline decorations will appear

## Development

```bash
# Run all packages in dev mode
pnpm dev

# Run tests
pnpm test

# Lint
pnpm lint
```

## License

Proprietary — All Rights Reserved. See [LICENSE](LICENSE) for details.
