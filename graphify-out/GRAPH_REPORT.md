# Graph Report - .  (2026-04-11)

## Corpus Check
- Corpus is ~32,134 words - fits in a single context window. You may not need a graph.

## Summary
- 226 nodes · 293 edges · 35 communities detected
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 16 edges (avg confidence: 0.87)
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `ApiClient` - 20 edges
2. `InsightPanelProvider` - 14 edges
3. `ProdScope` - 9 edges
4. `runAnalysis()` - 8 edges
5. `Lighthouse Brand Mark` - 7 edges
6. `Transport` - 6 edges
7. `WebSocketClient` - 6 edges
8. `runCodeIntel()` - 6 edges
9. `refreshEditor()` - 5 edges
10. `renderIntelMarkdown()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `Claude Color Logo` --conceptually_related_to--> `@prodscope/mcp-server`  [INFERRED]
  packages/website/public/claude-color.svg → README.md
- `prodscope-vscode` --references--> `VS Code Extension Icon (SVG) - Lighthouse Mark`  [INFERRED]
  README.md → packages/vscode-extension/icon.svg
- `@prodscope/website` --references--> `Website Logo (Color Lighthouse)`  [INFERRED]
  README.md → packages/website/public/logo.svg
- `VS Code Extension Icon (SVG) - Lighthouse Mark` --semantically_similar_to--> `VS Code Extension Icon (PNG)`  [INFERRED] [semantically similar]
  packages/vscode-extension/icon.svg → packages/vscode-extension/icon.png
- `VS Code Activity Bar Icon - Lighthouse Outline` --implements--> `Lighthouse Brand Mark`  [INFERRED]
  packages/vscode-extension/resources/activity-icon.svg → packages/website/public/logo.svg

## Hyperedges (group relationships)
- **SDK family ingests via /v1/ingest** — readme_pkg_sdk_browser, readme_pkg_sdk_node, readme_pkg_sdk_edge, readme_ingest_endpoint [EXTRACTED 1.00]
- **Collector storage stack** — readme_pkg_collector, readme_clickhouse, readme_postgresql [EXTRACTED 1.00]
- **Lighthouse brand asset family** — icon_vscode_svg, icon_activity_svg, website_logo, website_favicon [INFERRED 0.90]

## Communities

### Community 0 - "Branding & Product Concept"
Cohesion: 0.1
Nodes (26): Lighthouse Brand Mark, VS Code Activity Bar Icon - Lighthouse Outline, VS Code Extension Icon (PNG), VS Code Extension Icon (SVG) - Lighthouse Mark, Claude AI Tools (MCP), ClickHouse, CodeLens & Inline Decorations, Developer Observability Platform (+18 more)

### Community 1 - "VSCode Insight Panel"
Cohesion: 0.19
Nodes (7): applyInline(), escapeHtml(), fmtNum(), InsightPanelProvider, renderBodyContent(), renderInsightSections(), renderMarkdownPlain()

### Community 2 - "VSCode API Client"
Cohesion: 0.17
Nodes (1): ApiClient

### Community 3 - "VSCode Extension Entry & Decorations"
Cohesion: 0.21
Nodes (12): activate(), applyInlineIntel(), codeIntelShell(), escapeHtmlIntel(), refreshEditor(), renderIntelBody(), renderIntelMarkdown(), resolveIntelTag() (+4 more)

### Community 4 - "Backend API & Auth"
Cohesion: 0.12
Nodes (0): 

### Community 5 - "SDK Core Tracking"
Cohesion: 0.21
Nodes (5): enqueue(), event(), generateId(), generateSpanId(), track()

### Community 6 - "Config & WebSocket Client"
Cohesion: 0.22
Nodes (3): extractValue(), loadConfig(), WebSocketClient

### Community 7 - "AI Analysis (Backend)"
Cohesion: 0.42
Nodes (8): getAnthropic(), getBaselineVsCurrent(), getDeployImpact(), getHourlyPatterns(), getQueryPerformanceTrends(), getRecentErrorSpikes(), getWeekOverWeekTrends(), runAnalysis()

### Community 8 - "SDK Transport Layer"
Cohesion: 0.29
Nodes (1): Transport

### Community 9 - "Vite Plugin Auto-Instrumentation"
Cohesion: 0.43
Nodes (4): prodscope(), prodscopeAutoTrack(), prodscopeSourceMaps(), prodscopeTransform()

### Community 10 - "AI Code Intelligence"
Cohesion: 0.52
Nodes (6): getAnthropic(), getDeployComparison(), getFunctionDetail(), getWorstFunctions(), runCodeIntel(), traceSymptomToCode()

### Community 11 - "Postgres Instrumentation"
Cohesion: 0.47
Nodes (4): parseSQL(), patchPg(), bootstrapPostgres(), getPostgres()

### Community 12 - "SDK Utilities"
Cohesion: 0.5
Nodes (2): generateId(), getSessionId()

### Community 13 - "VSCode CodeLens Provider"
Cohesion: 0.5
Nodes (2): fmtNum(), ProdScopeCodeLensProvider

### Community 14 - "Dashboard Projects Page"
Cohesion: 0.5
Nodes (2): handleCreate(), loadProjects()

### Community 15 - "Data Aggregation Jobs"
Cohesion: 0.6
Nodes (3): runAggregation(), runDailySnapshots(), startAggregator()

### Community 16 - "Call Site Capture"
Cohesion: 0.83
Nodes (3): captureCallSite(), cleanBrowserPath(), parseFrame()

### Community 17 - "Source Map Resolution"
Cohesion: 0.83
Nodes (3): getConsumer(), resolveLocation(), resolveStack()

### Community 18 - "AI Insights Engine"
Cohesion: 0.83
Nodes (3): gatherContext(), generateInsight(), getAnthropic()

### Community 19 - "Tracing Decorators"
Cohesion: 0.67
Nodes (0): 

### Community 20 - "Error Capture"
Cohesion: 0.67
Nodes (0): 

### Community 21 - "ClickHouse Client"
Cohesion: 1.0
Nodes (2): getClickHouse(), initClickHouse()

### Community 22 - "WebSocket Broadcast"
Cohesion: 0.67
Nodes (0): 

### Community 23 - "Fetch Capture"
Cohesion: 1.0
Nodes (0): 

### Community 24 - "Click Capture"
Cohesion: 1.0
Nodes (0): 

### Community 25 - "Function Tracking"
Cohesion: 1.0
Nodes (0): 

### Community 26 - "Prisma Instrumentation"
Cohesion: 1.0
Nodes (0): 

### Community 27 - "Dashboard Router"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Signup Page"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Login Page"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "SDK Config Example"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Shared Types"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Vite Config"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Vite Env Types"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Backend Env Config"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **10 isolated node(s):** `Developer Observability Platform`, `@prodscope/dashboard`, `ClickHouse`, `PostgreSQL`, `Express` (+5 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Fetch Capture`** (2 nodes): `fetches.ts`, `captureFetches()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Click Capture`** (2 nodes): `clicks.ts`, `captureClicks()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Function Tracking`** (2 nodes): `functions.ts`, `trackFunction()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Prisma Instrumentation`** (2 nodes): `prisma.ts`, `prodscopePrisma()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Dashboard Router`** (2 nodes): `main.tsx`, `ProtectedRoute()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Signup Page`** (2 nodes): `Signup.tsx`, `Signup()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Login Page`** (2 nodes): `Login.tsx`, `Login()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `SDK Config Example`** (1 nodes): `prodscope.config.example.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Shared Types`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vite Config`** (1 nodes): `vite.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Vite Env Types`** (1 nodes): `vite-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Backend Env Config`** (1 nodes): `env.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Are the 7 inferred relationships involving `Lighthouse Brand Mark` (e.g. with `VS Code Extension Icon (SVG) - Lighthouse Mark` and `VS Code Activity Bar Icon - Lighthouse Outline`) actually correct?**
  _`Lighthouse Brand Mark` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Developer Observability Platform`, `@prodscope/dashboard`, `ClickHouse` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Branding & Product Concept` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `Backend API & Auth` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._