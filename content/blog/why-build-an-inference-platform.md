---
title: Why build an inference platform
date: 2026-09-27
summary: The plan, in order, and how I intend to keep the benchmarks honest.
tags: [inference, plan]
---

I'm building a small inference platform: a control plane, a custom engine for one model on one GPU, and this site to try it. The goal is to understand where the time goes between a prompt and the first token.

## The order of work

1. Run the model on vLLM behind a control plane, to learn real serving behavior.
2. Harden the load generator: streaming, time to first token, inter-token latency, tokens per second.
3. Record a vLLM baseline.
4. Write the engine: continuous batching and KV cache management, reusing existing kernels.

## Keeping the numbers honest

Headline comparisons will be raw and end to end: what an API caller actually experiences. Profiling breakdowns are for finding what to fix, not for the claim.


