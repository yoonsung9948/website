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
VITE_API_BASE_URL=https://api.example.com
```

The client POSTs to `${VITE_API_BASE_URL}/generate` with an AbortSignal. A 120-second frontend timeout bounds requests. Failures remain visible and never silently switch to sample mode. Browser cancellation does not guarantee server cancellation: propagate the Go request context into the engine.

**The backend contract is not yet known.** `src/lib/client.ts` contains two explicit integration seams: `encodeRequest` and `decodeResponse`. The optional, non-streaming JSON adapter currently uses the following frontend convention; adapt it to your real server before enabling live mode:

```json
{"prompt":"Explain the KV cache","max_tokens":256,"temperature":0.7}
```

```json
{
  "text": "The generated response",
  "metrics": {
    "ttftMs": 32.1,
    "decodeTokensPerSecond": 145.2,
    "outputTokens": 256,
    "totalLatencyMs": 1795.0
  }
}
```

Every metric is optional and must be a finite, nonnegative number. Token counts must be integers. Missing metrics display as dashes. Zero values remain visible. All metrics come from the API; total latency displays in seconds. Agree on timing boundaries (including queueing) with your engine before comparing benchmarks.

`generate()` exposes an async iterator of `delta` and `metrics` events, decoupling React from transport details. Mock mode emits authored text in chunks. The JSON adapter emits the completed response at once. No SSE, NDJSON, OpenAI-compatible schema, or token boundaries are assumed. Add a streaming decoder here once your wire protocol is defined; preserve partial frames, UTF-8 boundaries, errors, cancellation, and final metrics. Never treat network chunks or word counts as model tokens. Generated output is rendered as plain text.

The API must allow your frontend origin through CORS, including POST, Content-Type, and OPTIONS preflight. Use an HTTPS API for the deployed HTTPS site. `VITE_*` variables are public build-time values: never put API secrets in them. Apply any authentication and usage limits on the backend.

## Cloudflare Pages

Connect your repository in Cloudflare **Workers & Pages → Create application → Pages**:

- Root directory: `playground` if deploying this whole workspace; leave blank if this directory is its own repository.
- Build command: `npm run build`
- Build output directory: `dist`
- Set `NODE_VERSION=24` and the desired `VITE_API_MODE` / `VITE_API_BASE_URL` build environment variables.
- Use mock mode until your API adapter and reachable HTTPS endpoint are ready.

Production and preview deployments can have separate environment values. Rebuild after changing variables. Cloudflare hosts the static frontend; your Go control plane and inference engine run separately. No server rendering, Pages Functions, or database are required. Nothing has been published automatically.

References: [Cloudflare build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/), [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite).

## Editing

- `src/App.tsx`: page layout, personal identity, request lifecycle, keyboard and copy controls.
- `src/styles.css`: palette, window chrome, terminal styling, responsive layout. Tailwind utilities handle simple layout.
- `src/lib/client.ts`: examples, API configuration, request/response adapters, typed event boundary.
- `.env.example`: public configuration template.

Navigation includes Playground and an editable sample About me page, using hash navigation so direct links and browser history work on static hosting. The playground state survives tab changes. Edit the sample bio in `src/App.tsx`. There are no invented credentials, model names, hardware specs, or benchmark claims.

The terminal uses shell-style prompts and a blinking block cursor (steady when reduced motion is preferred). All generation settings, examples, actions, and metrics live in the separate benchmark panel below it.

The earlier buildless prototype was replaced by this source-based frontend. The optional legacy GitHub Pages workflow is manual-only and builds the current sources; Cloudflare Pages is the documented deployment target.
