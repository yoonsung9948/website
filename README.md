# Inference playground

A minimal personal website in React, Vite, TypeScript, and Tailwind CSS v4. Macintosh-inspired window chrome surrounds the terminal playground. Native controls keep the interface accessible and the dependency list small; shadcn/ui is not needed for v0.

## Run locally

Use Node.js 22.12+ (Node 24 LTS recommended). From this directory:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open the URL printed by Vite. Use Generate or Cmd/Ctrl + Enter; Stop cancels the active request. Copy output uses the browser clipboard (HTTPS or localhost). Sample mode supports authored examples and a clearly identified placeholder for other prompts. Sample settings are disabled and sample playback never reports invented performance numbers.

```sh
npm test         # Client contract, failures, cancellation, and sample behavior
npm run build   # TypeScript checks and production output in dist/
npm run preview # Serve the production build locally
```

## Connect your Go API

Set the following in `.env.local`, then restart Vite (or rebuild for production):

```dotenv
VITE_API_MODE=live
VITE_API_BASE_URL=/api
```

The client reads sanitized capabilities through `/api/engine/info` before enabling live controls. It sends explicit cache mode (`none`, `dynamic`, or `pool`), decode batching, temperature, and output budget with streaming. Options and output limits come from the running worker. Hardware facts appear inside the existing engine section; unavailable data remains unreported. Deploy the current engine image and Go binary together. Vite alone serves static/sample mode; live local use also needs the Pages Functions and server-side `ORIGIN_URL`/`DEMO_KEY` bindings.

For the deployed site, use `/api` as the base URL. `functions/api/generate.ts` injects the demo key server-side and forwards the Go SSE response incrementally. Configure `ORIGIN_URL` and `DEMO_KEY` as server-side bindings, never `VITE_*` values. Browser cancellation propagates upstream. Default budgets are Go 180 seconds, proxy 185 seconds, browser 190 seconds; preserve these margins if changing the Go configuration.

`src/lib/client.ts` exposes text, final metrics, and effective-generation metadata independently. `src/lib/sse.ts` parses fragmented UTF-8 and SSE frames, including CRLF, comments, and multiline data. Only a terminal `done` marks completion. Errors/Stop preserve partial text and do not show successful final measurements.

The existing metrics section displays all eleven version 1 measurements, grouped into token counts, latency breakdown, and decode/batching. Per-request details retain requested/effective settings, request ID, finish reason, and a sanitized runtime snapshot. Timings overlap and must not be added together. Missing/unsupported measurements show dashes, finite zero values remain visible, and sample playback never invents numbers. The server measures token timing before decoded text buffering. Engine latency excludes Go/edge/browser transit. Client first-text latency is a separate benchmark metric, not a substitute for engine TTFT.

## Saved benchmarks

The Benchmarks tab compares version 1 loadgen summary files. Import local files with the picker; they stay in the browser. To publish selected experiments, run loadgen's `publish` command against `public/benchmarks`, then deploy the website normally. The static index starts empty; no performance claims are prepopulated.

The viewer shows success/failure/skipped/cancelled counts, throughput, token-count coverage, client/engine timing summaries, comparison charts, and expandable experiment context. It flags differing scenarios/hardware/model metadata. Each published run can link to its standalone report containing distributions and timelines. No benchmark service or database is required.

## Cloudflare Pages

Connect your repository in Cloudflare **Workers & Pages → Create application → Pages**:

- Root directory: `playground` if deploying this whole workspace; leave blank if this directory is its own repository.
- Build command: `npm run build`
- Build output directory: `dist`
- Set `NODE_VERSION=24` and the desired `VITE_API_MODE` / `VITE_API_BASE_URL` build environment variables.
- Use mock mode until your API adapter and reachable HTTPS endpoint are ready.

Production and preview deployments can have separate environment values. Rebuild after changing variables. Cloudflare hosts the static frontend; your Go control plane and inference engine run separately. Sample mode needs static hosting only. Live mode requires the included Pages Functions and server-side bindings; no database is required. Nothing has been published automatically.

References: [Cloudflare build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite).

## Editing

- `src/App.tsx`: page layout, personal identity, request lifecycle, keyboard and copy controls.
- `src/styles.css`: palette, window chrome, terminal styling, responsive layout. Tailwind utilities handle simple layout.
- `src/lib/client.ts`: examples, API configuration, request/response adapters, typed event boundary.
- `.env.example`: public configuration template.

Navigation includes Playground, Benchmarks, Blog, and an editable sample About me page, using hash navigation so direct links and browser history work on static hosting. The playground state survives tab changes. Edit the sample bio in `src/App.tsx`. There are no invented credentials, model names, hardware specs, or benchmark claims.

The terminal uses shell-style prompts and a blinking block cursor (steady when reduced motion is preferred). Generation controls and latest-request metrics live below the terminal; saved experiments have their own Benchmarks page.

The earlier buildless prototype was replaced by this source-based frontend. The optional legacy GitHub Pages workflow is manual-only and builds the current sources; Cloudflare Pages is the documented deployment target.

### KV-cache benchmark draft

The November 5 baseline article is `content/blog/kv-cache-baseline.md` with
`draft: true`: visible in the development blog and omitted from production blog
listings. Its curated benchmark summaries and figure assets are static public
files, independently of the article's draft flag. They contain no request headers,
target URLs, or infrastructure hostnames. Drafts are an editorial state, not an
access-control mechanism.

Use `npm run dev` and open `#blog/kv-cache-baseline`. The `#benchmarks` page loads
the six curated summaries, groups matching concurrency levels, and distinguishes
KV (blue circles) from no KV (orange squares); cache modes come from effective
engine metadata, not guessed labels. Legacy RPS runs and local imports still work.

Regenerate the frozen snapshot and five measured SVG figures from the original
saved artifacts (the architecture and cache-work diagrams are authored):

```sh
python3 scripts/build_kv_benchmark.py \
  --results ../loadgen/results \
  --traces ../inference/observability/traces/spans.jsonl
```

The snapshot and per-run summary downloads retain the original run IDs and
unreported revision fields. Figures are observations from tracing-enabled trials,
not tracing-disabled performance claims. No GPU or trace backend is required to
view them. Keep the article in draft until its text and reproducibility limits
have been reviewed.


The draft article embeds its interactive trace comparison with the explicit
`:::kv-trace-comparison:::` paragraph marker. `Blog.tsx` renders that block as a
trusted React component; ordinary Markdown still escapes raw HTML. The component
validates and reads the frozen local snapshot, with no Jaeger or engine connection.
Steps expose duration, input-token count, and scheduling wait on hover or focus;
click/tap or Enter pins a step, and Escape clears it. Mobile lanes scroll
horizontally. A static SVG remains available as a fallback and download.

## Live experiments

The expandable experiments compare supported cache modes sequentially using greedy sampling, or submit a bounded concurrent pooled-cache group to observe decode batching. Stop cancels the group. Failed requests are never automatically retried; a failed sequential trial skips the rest. Shared traffic, warmup, and admission limits affect observations, so use loadgen for rigorous comparisons. Saved benchmark labels distinguish dynamic, pooled, pooled-with-batching, and legacy cached runs.
