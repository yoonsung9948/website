---
title: Debugging the control plane's RunPod lifecycle
date: 2026-09-28
summary: Notes from a live debugging session on the Go control plane — config wiring, a startup race, a dangling engine client, and why a capitalized field didn't fix what I thought it would.
tags: [go, control-plane, runpod, debugging]
draft: true
---

Raw notes from working through the control plane with Claude. Rewrite before publishing — this is the record, not the post.

## Starting point

Control plane (Go) orchestrates a RunPod GPU pod running the inference engine (Python/FastAPI). Reviewed the whole thing cold: config never loaded (YAML nesting didn't match the struct), `Shutdown` called `Terminate(ctx, "")` and panicked because the instance ID was never stored, the engine client was hardcoded to `127.0.0.1:8000`, `StartEngine` could double-provision, and RunPod's API calls turned out to actually be correct (I'd first checked them against v1 docs by mistake — v2's base URL, request shape, and `status` field all matched what was already written).

Decided: fix config first, in isolation, then work through the rest piece by piece as I write it myself, with review after each change rather than having it all written for me.

## Config: nesting and env expansion

`examples/config.yaml` had a top-level `gpu_provider:` key; the struct expected `control_plane_config.gpu_provider_config.runpod`. Silent mismatch — nothing errored, the RunPod block just never populated, so `GPUProviderConfig.RunPod` stayed `nil`.

Also: `api_key: ${RUNPOD_API_KEY}` in YAML doesn't get expanded by a plain `yaml.Decode`. That syntax needs code to do it. Wrote `load.go` to read the key from the environment directly instead, nil-safe on the RunPod pointer, hard error if no key is found anywhere:

```go
if rp := cfg.ControlPlaneConfig.GPUProviderConfig.RunPod; rp != nil {
    if key := os.Getenv("RUNPOD_API_KEY"); key != "" {
        rp.APIKey = key
    }
    if rp.APIKey == "" {
        return nil, errors.New("runpod api key is empty: set RUNPOD_API_KEY")
    }
}
```

Also caught: `serve_config.host` was `127.0.0.1`. Fine for local-only testing, but wrong the moment something external (the Cloudflare Function proxy) needs to reach it — `0.0.0.0` binds all interfaces, `127.0.0.1` only accepts loopback. The Python engine's own `docker/engine.yaml` already had this right (`0.0.0.0`), since binding to loopback inside a container makes the port mapping unreachable regardless of trust boundary.

## StartEngine: the double-provisioning race

Original code checked `getState() != StateOffline` then set `StateProvisioning` *inside the goroutine*, after `StartEngine` had already returned. Two calls close together could both read `Offline` before either goroutine set the new state — two pods.

First attempted fix still split the check and the write into two separate lock acquisitions (`getState()` then `setState()`) — same race, just less obviously. Needed to be one critical section:

```go
c.mu.Lock()
if c.state != StateOffline {
    c.mu.Unlock()
    return errors.New("engine is not offline")
}
c.state = StateProvisioning
c.mu.Unlock()
```

Same shape of bug in the pod-naming counter — a plain `c.instanceCounter++` racing across goroutines. Fixed with `atomic.Int64`.

## The instance ID that never gets recorded

Added `addInstance` (appends to `c.instanceIDs`, stores in `c.activeInstances`) but never actually called it from `startEngineWorkflow` after `Provider.Create` succeeds. Consequence: `Shutdown()` clones an empty slice, terminates nothing, even for a pod it just created — the exact problem `Shutdown`'s retry logic was built to solve, undone by one missing call. Also: `activeInstances` map was never initialized in `NewControlPlane`, so the first real write to it would've panicked (write to nil map).

Open, deferred to TODO rather than fixed immediately: `startEngineWorkflow` runs on `c.ctx`, which is the *process* context (`signal.NotifyContext` on SIGINT/SIGTERM), not just "outlives the request" as intended. A shutdown signal cancels it immediately — if that happens mid-`Create`, before the ID is recorded, the pod exists on RunPod but the process never knew its ID. Decided: don't fix now, note it, let it surface for real during the testing phase rather than solve hypothetically.

## The client that never learns the pod's address

`engine.HttpClient.endpoint` gets set once at construction from the config placeholder and never updates. Even once a pod reaches `Ready`, every `/generate` call still goes to `127.0.0.1:8000`. Nothing had actually wired the real address (`gpuprovider.Instance.Endpoint`, already returned by `Create`/`Get`) into the client that makes the actual inference request.

Tried the obvious fix: capitalize `endpoint` to `Endpoint`, expecting that to make it settable from outside the package. It does — but `ControlPlane.Client` is typed as the `engine.Client` *interface*, not the concrete `*HttpClient`. An interface value only exposes what's declared on the interface; the field being exported doesn't matter if the interface never mentions it. `c.Client.Endpoint = "..."` doesn't compile no matter how the field is cased — the fix is a method on the interface itself (`SetEndpoint(url string)`), not a field, both for that reason and because concurrent `/generate` calls reading the endpoint while the startup goroutine writes it once is an unsynchronized race that a bare field can't guard against.

## One engine at a time, by design

Worried, correctly, whether multiple `startEngineWorkflow` goroutines could stomp on the same shared `Client`/endpoint if several ran at once. They can't, currently — the same `StartEngine` gate that fixes the double-provisioning race also guarantees only one instance is ever in flight or `Ready`. One control plane, one active engine, one `Client` pointed at it — consistent with the current scope (one fixed model, one pod).

Noted for later, not acted on: if per-model routing ever becomes real (the website's model dropdown is currently cosmetic — sends a `model` field the engine ignores), this single-`Client` design breaks, and needs to become a map keyed by instance or model instead. Not needed for the current phase.

## Where it stands

Config: fixed and verified. Race conditions: fixed (mutex-scoped check-and-set, atomic counter). Instance ID recording, endpoint wiring, health-check-before-Ready: identified, not yet written. Durable instance tracking across restarts and the shutdown-context issue: written up in `TODO.md`, deliberately deferred to the testing phase.

Working style for this session: fix one piece, review it in detail (including catching a follow-up bug reintroduced by the "fix"), before moving to the next — rather than a large batch of generated changes.
