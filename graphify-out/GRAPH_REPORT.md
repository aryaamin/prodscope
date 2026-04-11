# Graph Report - .  (2026-04-12)

## Corpus Check
- 71 files · ~39,051 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 248 nodes · 316 edges · 44 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `ApiClient` - 21 edges
2. `InsightPanelProvider` - 14 edges
3. `Transport` - 8 edges
4. `runAnalysis()` - 8 edges
5. `WebSocketClient` - 6 edges
6. `runCodeIntel()` - 6 edges
7. `refreshEditor()` - 5 edges
8. `renderIntelMarkdown()` - 5 edges
9. `escapeHtmlIntel()` - 5 edges
10. `escapeHtml()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `getSessionId()` --calls--> `generateId()`  [EXTRACTED]
  packages/sdk-browser/src/utils.ts → packages/sdk-node/src/utils.ts
- `parseFrame()` --calls--> `cleanBrowserPath()`  [EXTRACTED]
  packages/sdk-node/src/callsite.ts → packages/sdk-browser/src/callsite.ts
- `bootstrapRemedySchema()` --calls--> `getPostgres()`  [EXTRACTED]
  packages/remedy/src/db/postgres.ts → packages/collector/src/db/postgres.ts
- `loadConfig()` --calls--> `deriveWsUrl()`  [EXTRACTED]
  packages/mcp-server/src/config.ts → packages/vscode-extension/src/config.ts

## Communities

### Community 0 - "Community 0"
Cohesion: 0.19
Nodes (7): applyInline(), escapeHtml(), fmtNum(), InsightPanelProvider, renderBodyContent(), renderInsightSections(), renderMarkdownPlain()

### Community 1 - "Community 1"
Cohesion: 0.16
Nodes (1): ApiClient

### Community 2 - "Community 2"
Cohesion: 0.15
Nodes (9): defaultMinLevel(), enqueue(), event(), flush(), generateId(), generateSpanId(), log(), mergeFailedBatchIntoBuffer() (+1 more)

### Community 3 - "Community 3"
Cohesion: 0.21
Nodes (12): activate(), applyInlineIntel(), codeIntelShell(), escapeHtmlIntel(), refreshEditor(), renderIntelBody(), renderIntelMarkdown(), resolveIntelTag() (+4 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (0): 

### Community 5 - "Community 5"
Cohesion: 0.22
Nodes (4): deriveWsUrl(), extractValue(), loadConfig(), WebSocketClient

### Community 6 - "Community 6"
Cohesion: 0.31
Nodes (1): Transport

### Community 7 - "Community 7"
Cohesion: 0.42
Nodes (8): getAnthropic(), getBaselineVsCurrent(), getDeployImpact(), getHourlyPatterns(), getQueryPerformanceTrends(), getRecentErrorSpikes(), getWeekOverWeekTrends(), runAnalysis()

### Community 8 - "Community 8"
Cohesion: 0.39
Nodes (5): authedUrl(), commitAndPush(), exists(), prepareWorktree(), run()

### Community 9 - "Community 9"
Cohesion: 0.43
Nodes (4): prodscope(), prodscopeAutoTrack(), prodscopeSourceMaps(), prodscopeTransform()

### Community 10 - "Community 10"
Cohesion: 0.43
Nodes (5): parseSQL(), patchPg(), bootstrapPostgres(), bootstrapRemedySchema(), getPostgres()

### Community 11 - "Community 11"
Cohesion: 0.52
Nodes (6): getAnthropic(), getDeployComparison(), getFunctionDetail(), getWorstFunctions(), runCodeIntel(), traceSymptomToCode()

### Community 12 - "Community 12"
Cohesion: 0.47
Nodes (3): getOctokit(), openPullRequest(), prBodyFor()

### Community 13 - "Community 13"
Cohesion: 0.5
Nodes (2): generateId(), getSessionId()

### Community 14 - "Community 14"
Cohesion: 0.4
Nodes (0): 

### Community 15 - "Community 15"
Cohesion: 0.7
Nodes (4): getMailer(), notifyFailure(), notifySuccess(), postSlack()

### Community 16 - "Community 16"
Cohesion: 0.5
Nodes (2): fmtNum(), ProdScopeCodeLensProvider

### Community 17 - "Community 17"
Cohesion: 0.5
Nodes (2): handleCreate(), loadProjects()

### Community 18 - "Community 18"
Cohesion: 0.6
Nodes (3): runAggregation(), runDailySnapshots(), startAggregator()

### Community 19 - "Community 19"
Cohesion: 0.83
Nodes (3): captureCallSite(), cleanBrowserPath(), parseFrame()

### Community 20 - "Community 20"
Cohesion: 0.83
Nodes (3): getConsumer(), resolveLocation(), resolveStack()

### Community 21 - "Community 21"
Cohesion: 0.83
Nodes (3): gatherContext(), generateInsight(), getAnthropic()

### Community 22 - "Community 22"
Cohesion: 0.67
Nodes (0): 

### Community 23 - "Community 23"
Cohesion: 0.67
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 0.67
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (2): buildPrompt(), runAgent()

### Community 26 - "Community 26"
Cohesion: 1.0
Nodes (2): processSignature(), runOneCycle()

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (2): getClickHouse(), initClickHouse()

### Community 28 - "Community 28"
Cohesion: 0.67
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

### Community 37 - "Community 37"
Cohesion: 1.0
Nodes (0): 

### Community 38 - "Community 38"
Cohesion: 1.0
Nodes (0): 

### Community 39 - "Community 39"
Cohesion: 1.0
Nodes (0): 

### Community 40 - "Community 40"
Cohesion: 1.0
Nodes (0): 

### Community 41 - "Community 41"
Cohesion: 1.0
Nodes (0): 

### Community 42 - "Community 42"
Cohesion: 1.0
Nodes (0): 

### Community 43 - "Community 43"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 29`** (2 nodes): `fetches.ts`, `captureFetches()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `clicks.ts`, `captureClicks()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (2 nodes): `functions.ts`, `trackFunction()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (2 nodes): `watcher.ts`, `findCandidateSignatures()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (2 nodes): `env.ts`, `int()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (2 nodes): `prisma.ts`, `prodscopePrisma()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (2 nodes): `main.tsx`, `ProtectedRoute()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (2 nodes): `Signup.tsx`, `Signup()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 37`** (2 nodes): `Login.tsx`, `Login()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (1 nodes): `prodscope.config.example.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 39`** (1 nodes): `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (1 nodes): `express-augment.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 41`** (1 nodes): `vite.config.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 42`** (1 nodes): `vite-env.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 43`** (1 nodes): `express-augment.d.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Should `Community 4` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._