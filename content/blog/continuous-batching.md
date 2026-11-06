---
title: "Continuous Batching: Slower Steps, Faster Requests"
date: 2026-10-18
summary: How sharing decode turns took my custom engine from 21.98 to 65.65 tokens/s at concurrency four—and what latency, traces, and memory revealed.
tags: [inference, benchmarks, continuous-batching, kv-cache, tracing]
draft: false
---

After [adding a KV cache](#blog/kv-cache-baseline), I could stop recomputing the entire prefix on every token. But when I admitted four requests, they still took turns running through the model one at a time. I had concurrent requests without batched execution.

I wanted to see what happened if those requests could share a decode turn. I added a fixed KV pool and continuous decode batching to my Python engine, then compared **the same pooled cache with batching off and on**, running Qwen3-8B in FP16 on an NVIDIA A40.

At concurrency four, measured output throughput went from **21.98 to 65.65 tokens/s**, a **2.99× ratio**. Median client completion time fell from **11.74 to 4.00 seconds**. Yet in the separate diagnostic runs, the median runner span got longer: **44.66 ms without batching and 53.62 ms with it**.

That was the part I wanted to investigate. A longer model turn was compatible with faster requests because more requests were making progress during that turn.

All figures below come from my saved benchmark session. Orange squares and dashed lines mean **pool, batching off**; blue circles and solid lines mean **pool, batching on**. Both paths use KV caching.

## The change I actually tested

This experiment has a different baseline from my earlier cache article. I did not compare an uncached runner against a cached, batched runner. I kept the pooled cache enabled in both paths and changed the request's `decode_batching` flag.

```json
{"kv_cache_mode": "pool", "decode_batching": false}
{"kv_cache_mode": "pool", "decode_batching": true}
```

I allocate one fixed cache slot per admitted pooled request. Each slot holds that request's keys and values across layers. A finished or cancelled request releases its slot for reuse; it does not free the pool's backing tensors.

Prefill still runs one request at a time. After a pooled request has generated its first token, it can join other ready requests in a single-token decode batch. The scheduler forms a new batch on each turn, with up to four requests. Completed requests leave, pending requests can claim released slots, and the next decode batch can have different members.

That is the continuous batching I implemented here: **continuous decode batching with separate, unchunked prefill**. Paged attention and chunked prefill are still future work.

With batching disabled, my scheduler gives each request its own runner call. With it enabled, the runner builds a pooled cache context for the selected requests, gathers their history with a mask for unequal lengths, runs the model, and returns one next-token ID per request. The gather, copying, sampling and host transfer are all part of this implementation's measured cost.

## How I kept the comparison small and controlled

I used loadgen's fixed-count, closed-loop mode at concurrency 1, 2 and 4. At each concurrency I ran the pooled baseline first, then the batched path, with one excluded warmup and 20 measured requests per trial. All **120 primary requests succeeded**, with no rejections, skips or cancellations.

| Setting | Value |
| --- | --- |
| Model / backend | Qwen/Qwen3-8B / custom Python |
| GPU / dtype | NVIDIA A40 / FP16 |
| Runtime | PyTorch 2.14.0+cu130; Transformers 5.17.0 |
| Prompt | “Explain what a KV cache does during language model inference.” |
| Input / output | 24 input tokens; 64 output tokens for every measured request |
| Sampling | Greedy, temperature zero |
| Cache | Four fixed slots, each with capacity for 2,048 tokens |
| Engine limits | Four active requests; maximum decode batch size four |
| Go admission | Concurrency four; 100 requests/s; burst 32 |
| Primary trials | 20 measured requests per mode and concurrency, plus one warmup |
| Diagnostic trials | Eight measured requests per mode at concurrency four |

Loadgen sends a replacement request when a response finishes, keeping up to the configured number outstanding. These are concurrency experiments, not offered-RPS experiments. I kept Go's limits constant so increasing loadgen concurrency would reach the engine rather than mostly measure admission rejections.

My tracing SDKs stayed enabled. The primary scenarios sent no sampled parent and were configured to use parent-based sampling with unsampled roots; the diagnostic scenarios explicitly requested sampled traces. Memory recording stayed enabled as well. I did not run an instrumentation-disabled comparison, so these are measurements of that serving setup, including its overhead.

Client timings include the path from my Mac through the local Go control plane to the remote worker and back. The browser and frontend proxy are outside the benchmark. I count actual engine-reported output tokens and divide by elapsed trial time including drain, with warmup excluded.

## Throughput: concurrency started doing useful work

[![Aggregate output throughput at concurrency 1, 2 and 4, comparing the same pooled cache with batching off and on.](/blog/continuous-batching/throughput.svg)](/blog/continuous-batching/throughput.svg)

| Concurrency | Batching off | Batching on | Throughput ratio |
| --- | --- | --- | --- |
| 1 | 18.93 tok/s | 19.34 tok/s | 1.02× |
| 2 | 20.49 tok/s | 37.92 tok/s | 1.85× |
| 4 | 21.98 tok/s | 65.65 tok/s | 2.99× |

The concurrency-one result is a useful check on the experiment. With one request, both paths can only produce a batch of one. The observed difference was about 2%, which I would not treat as an established improvement from one trial per configuration.

With batching off, increasing concurrency from one to four only raised aggregate throughput from 18.93 to 21.98 tokens/s. I had more requests waiting for essentially the same sequence of individual model calls.

With batching on, additional requests could share those calls. Throughput reached 37.92 tokens/s at concurrency two and 65.65 at four. That is a substantial difference in these runs, but it is not linear scaling. I am still doing separate prefills, handling arrivals and completions, gathering cache tensors, and paying for the host-side serving path.

I also avoid treating the lines between plotted points as a scaling model. Each point is a measured configuration; I have not tested concurrency three or established the saturation point beyond four.

## What happened to each user's latency?

[![Median client completion time at matching concurrency. Batching reduced completion latency substantially at concurrency two and four.](/blog/continuous-batching/latency.svg)](/blog/continuous-batching/latency.svg)

| Concurrency | Off: completion p50 | On: completion p50 |
| --- | --- | --- |
| 1 | 3.32 s | 3.22 s |
| 2 | 6.40 s | 3.32 s |
| 4 | 11.74 s | 4.00 s |

At concurrency four, the median completion time dropped by about **66%**. In this workload, batching increased aggregate throughput and made concurrent requests finish sooner. It did not make concurrency free: the batched concurrency-four median was still slower than the batched concurrency-one median.

First-token latency told a different story.

[![Engine TTFT medians remain near 92 to 109 milliseconds across the primary trials, with a smaller change than completion latency.](/blog/continuous-batching/ttft.svg)](/blog/continuous-batching/ttft.svg)

At concurrency four, engine TTFT p50 went from **109.02 to 94.20 ms**. The improvement in full completion was much larger than the change in first-token timing. That fits what I changed: requests share decode work after their initial prefill, while prefill remains separate.

I keep engine TTFT separate from the time loadgen receives its first nonempty text delta. At concurrency four, those client first-text medians were **949.79 and 782.46 ms**. Text delivery includes transport and streamer buffering; a text delta is not necessarily one model token. I cannot subtract two population medians and call the result a precise network measurement.

## Checking that I really batched requests

A concurrency setting alone does not prove batched execution. I added batch-participation measurements to the terminal response and checked the effective execution flags saved with each request.

[![Mean request-observed decode batch size stays at one without batching, and approaches two and four with batching enabled.](/blog/continuous-batching/batches.svg)](/blog/continuous-batching/batches.svg)

With batching off, the observed maximum and mean decode batch size were one at every concurrency. With it on, the mean was **1.98 at concurrency two** and **3.89 at concurrency four**, with maxima of two and four.

Those are request-observed participation statistics. A shared four-request forward pass contributes a measurement to all four requests. Averaging those observations is different from averaging physical model calls, each counted once. My engine's physical-step metrics make that distinction explicit, and I keep the distinction in the article rather than relabeling the request mean as a GPU batch average.

The mean staying below four is expected when a batch can change membership. Separate prefills, arrivals, completions and the final drain leave some turns with fewer eligible requests. This homogeneous workload shows that requests shared execution; it is not a thorough fairness test with mixed prompt and output lengths.

## Why the longer runner span was still useful

For diagnosis, I collected separate eight-request trials at concurrency four, with complete traces for all 16 requests. I excluded those trials from the headline throughput figures.

| Diagnostic measurement | Batching off | Batching on |
| --- | --- | --- |
| Median decode runner span | 44.66 ms | 53.62 ms |
| Median scheduler wait before decode | 135.68 ms | 0.48 ms |

The batched runner span was about 20% longer. But the baseline advanced one request in that turn, while a full batch advanced four. In the baseline, a request then waited while other requests took their individual turns. The wait measurement dropped sharply when those ready requests could participate together.

[![Actual request-level runner spans in two 700-millisecond diagnostic windows. Baseline spans take separate turns; batched spans overlap across request lanes.](/blog/continuous-batching/trace.svg)](/blog/continuous-batching/trace.svg)

I selected the first four measured requests in each diagnostic run and aligned each panel to the first request's decode step 20. Both panels show 700 ms with independent time origins. The bars are actual span intervals. In the full-size SVG, hovering a bar shows its step index, duration, input-token count, batch size and scheduler wait.

Overlapping bars in the batched panel are request participations around a shared runner call. They do not mean I launched four independent GPU jobs in parallel. My instrumentation creates a child span under each participating request, so the same underlying turn appears in more than one lane.

Each diagnostic run produced 504 decode-participation spans: eight requests times 63 steps after the first token. Those are not 504 independent forward calls in the batched run, nor 504 independent request samples. I do not add their durations together to estimate elapsed GPU time.

The spans also include model invocation, cache handling, sampling and transfer of token IDs to the host. They are not kernel-only measurements. Batching may improve how I use the GPU, but these traces cannot establish memory bandwidth, utilization or the exact kernel responsible for the gain.

## Memory: the peak did not move in this workload

I expected to need a separate memory measurement because sampling a device-wide gauge can miss short allocations. I recorded PyTorch allocator baselines and peaks around idle-to-idle periods of engine work, then joined those records to trials by engine request ID. All 120 primary requests had usable memory coverage.

[![Peak allocation above idle was 7.14 MiB for both modes at all three tested concurrency levels. Idle allocation includes a fixed 1.125 GiB KV pool.](/blog/continuous-batching/memory.svg)](/blog/continuous-batching/memory.svg)

Every primary trial reported the same numbers:

| Measurement | Value |
| --- | --- |
| Idle allocated memory | Approximately 16.391 GiB |
| Fixed KV pool included in idle | 1.125 GiB |
| Peak allocated above idle | 7.14 MiB |
| Allocated change after drain | 0 bytes |

For this short-context workload, batching did not increase the recorded whole-window allocation peak. That does not mean batching requires no temporary memory. The cache already reserved four full slots in both modes, including the concurrency-one runs. I held that allocation fixed to isolate batching.

The recorder also captures a whole busy window, not a phase-specific allocation profile. A prefill allocation can set the peak even if decode uses different temporary buffers. My forward path produces vocabulary logits for the prompt positions, while pooled decode gathers and copies cache tensors. I have not measured those allocations separately, so I cannot identify which one set the peak from these summaries alone.

Returning to the same allocated baseline after drain is a useful cleanup check for these trials. It is not a long-running leak test. Reserved allocator memory can remain high because PyTorch retains reusable blocks, and it depends on previous allocation history. These measurements describe the engine process's CUDA allocator, not total device memory or a KV-only memory cost.

## What I learned, and what I would test next

My first cache experiment removed repeated prefix work. This experiment changed how multiple requests share the remaining decode work. Keeping the pooled cache identical in both modes made that distinction much easier to measure.

The main result is specific but useful: at four outstanding requests, my current implementation delivered roughly three times the aggregate token throughput and much shorter client completion times. The diagnostic traces helped explain how that could happen even when a runner turn became longer.

I kept the GPU session small, which limits what I can claim. I used one short prompt, one output length, one GPU and one trial per configuration. The pooled baseline ran before the batched path at each concurrency; I did not run the optional reverse-order confirmation. Network variation, allocator history and changing GPU conditions are still possible influences. Twenty requests per point are enough to describe what happened here, not to establish precise p95 or p99 behavior.

The saved engine and model revisions are also `unreported`. I retained model, device, precision, runtime versions and effective execution options, but I cannot reconstruct an immutable deployment identity from that missing information. The eight-request text smoke check and small-model correctness tests are checks I performed; they do not establish exhaustive FP16 correctness on the full deployed model.

My next experiments would be repeated pairs in both orders, longer prompts, and mixed short/long requests. Longer prefills matter because mine still execute as whole separate calls. Mixed lengths would let me examine admission, slot reuse and whether a short request gets stuck behind longer work. I also want phase-specific memory measurements and a closer look at the cache gather/copy path. Those are follow-ups, not conclusions from these runs.

## The data behind the figures

I saved this experiment as `batching-20261105-222107`. The six primary trials contain 120 successful requests; the two diagnostic trials contain 16. The [sanitized snapshot](/blog/continuous-batching/snapshot.json) includes the measured summaries, memory values, trace statistics and exact intervals shown in the trace figure. It excludes authentication headers, infrastructure addresses and engine request UUIDs.

I can regenerate the figures from my local saved session without a running GPU or Jaeger:

```sh
python3 scripts/build_batching_benchmark.py \
  --session ../loadgen/results/batching-20261105-222107
```

For this implementation, the useful question turned out to be how much progress a runner turn buys. Making a turn shorter helped my KV-cache baseline. Letting several requests share a slightly longer turn changed concurrent throughput much more.
