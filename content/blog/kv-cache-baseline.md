---
title: What a Naive KV Cache Actually Saves
date: 2026-10-07
summary: Investigating what my first KV cache saves, what it still recomputes, and where the latency goes.
tags: [inference, benchmarks, kv-cache, tracing, go, python]
draft: false
---

I added a per-request KV cache to my custom Python inference engine, then ran Qwen3-8B in FP16 on an NVIDIA A40 to see what changed. I wanted to understand how much latency this simple implementation removed and what I was still paying for on every token.

I started with three questions: how much faster does one request become, what happens when I admit more requests, and where does the remaining time go? A single tokens-per-second number wasn’t going to answer all three.

With one request outstanding, I got **20.77 tokens/s without KV caching and 22.61 tokens/s with it**. With four requests outstanding, I got **24.37 and 27.79 tokens/s**, respectively. Caching improved throughput in each of these runs, but adding more requests also made each request take much longer.

Looking at the traces helped me separate the cost of a model step from the time a request spent waiting for its next one. That distinction matters when I try to explain a KV-cache speedup.

This is an investigation of that first cache implementation. I used one short prompt and kept tracing enabled, so I’m keeping the conclusions specific to the workload I actually tested.

Figures open at full size when selected. Orange represents no KV cache; blue represents KV cache.

## What I built

My engine runs tokenization, the custom Qwen3 forward pass, sampling, and text decoding in Python. A Go control plane manages the worker and relays streamed responses. I made `use_kv_cache` a request option so both paths could run in the same deployed process, with the same model and GPU.

[![Architecture showing loadgen calling Go and Python, with a separate trace export path to Collector, Jaeger, and files.](/blog/kv-cache-baseline/architecture.svg)](/blog/kv-cache-baseline/architecture.svg)

I measured requests with an independent load generator on my Mac, targeting Go directly rather than the browser. I also exported Go and Python spans to a local Collector. That gives me client timings for the complete request path and engine spans for the work I’m investigating. The website and frontend proxy are outside this benchmark.

My runner batch size stayed at one. Higher concurrency makes requests take turns in the scheduler; it does not change how many requests go through a forward pass together. I held that behavior constant while toggling the cache.

## How I tested it

I ran the same prompt with KV caching off and on at concurrency 1, 2, and 4. For each configuration, I sent one warmup request, excluded it from the measurements, then sent 20 measured requests. All 120 measured requests succeeded.

| Setting | Value |
| --- | --- |
| Model | Qwen/Qwen3-8B, custom backend |
| GPU | NVIDIA A40 |
| Dtype | FP16 |
| Runtime | PyTorch 2.14.0+cu130; Transformers 5.17.0 |
| Prompt | “Explain what a KV cache does during language model inference.” |
| Tokenized input | 24 tokens |
| Output | 64 tokens per successful request; greedy sampling |
| Outstanding requests | 1, 2, 4 |
| Requests per configuration | 20 measured, plus one warmup |
| Tracing | Enabled |

I added a fixed-count, closed-loop mode to loadgen for this comparison. Each worker sends another request as soon as its current response finishes. At concurrency two, for example, I keep up to two requests outstanding until I’ve used the trial’s 20-attempt budget.

That concurrency setting belongs to loadgen. I set Go’s admission ceiling separately and held it constant across the tests.

I set Go’s ceiling to four active generations and raised its request-rate allowance. In an earlier RPS sweep, I hit my admission limits and got rejections. That told me something about overload behavior, but I wanted this comparison to reach the engine instead of mostly measuring the limiter.

I used a fixed attempt count to keep GPU time bounded. Each trial stopped after 20 attempts, with failures counted rather than retried. I excluded warmup and held the admission settings constant so those choices would not change between cache modes.

## Which tokens per second?

One thing I had to get straight was what I meant by tokens per second. I now keep these two measurements separate:

- **Aggregate output throughput:** successful output tokens divided by the measured run's elapsed time, including drain. Warmup is excluded.
- **Per-request decode rate:** output tokens after the first token divided by the interval between the first and last generated tokens. It includes waits between scheduler turns.

I measure client completion from dispatch until loadgen receives the terminal done event. In the engine, I measure TTFT from handler entry until the first generated token, including tokenization and initial scheduling.

I keep client first-text latency separate too. My text streamer can buffer output before sending a nonempty delta, and a delta can contain more than one token. Calling those delivery gaps “inter-token latency” would hide that distinction.

This changed how I read the results. A request can have a faster decode step and still wait longer because other requests are taking turns. I also can’t subtract an engine median from a client median and call the difference a precise network measurement.

## What changed with caching

I use orange dashed lines for **no KV cache** and blue solid lines for **KV cache**. Each point is one trial with 20 successful requests. I connected the points to make the tested configurations easier to follow; I haven’t fitted a scaling model.

[![Output tokens per second at concurrency 1, 2, and 4. KV cache is blue and consistently above the orange uncached series.](/blog/kv-cache-baseline/throughput.svg)](/blog/kv-cache-baseline/throughput.svg)

| Concurrency | No KV: output tok/s | KV: output tok/s | No KV: client p50 | KV: client p50 |
| --- | --- | --- | --- | --- |
| 1 | 20.77 | 22.61 | 2.98 s | 2.65 s |
| 2 | 21.82 | 23.37 | 5.96 s | 5.32 s |
| 4 | 24.37 | 27.79 | 10.29 s | 9.29 s |

In these runs, I got approximately 9–14% more output throughput with caching. I’m treating that as a useful first result. I ran each configuration once, with the no-KV sweep first, so I still need repeated or interleaved trials to separate a small improvement from ordering effects and GPU state.

[![Median client completion time increases with concurrency in both modes, even though cached generation is faster.](/blog/kv-cache-baseline/latency.svg)](/blog/kv-cache-baseline/latency.svg)

I also checked whether the cache benefit survived concurrent requests. With caching enabled, going from one request to four raised throughput from 22.61 to 27.79 tokens/s, while median client completion time went from 2.65 to 9.29 seconds.

The cached path stayed ahead in these runs, but requests also waited longer as I increased concurrency. I needed the traces to separate the cache’s execution savings from that waiting.

## What I learned from the runner traces

I added tracing because my initial summaries told me how long requests took without showing where they spent that time. For this comparison, I checked that each request had a complete generation trace and 64 runner steps.

To compare decode steps, I left out the first token-producing call: both paths have to process the full 24-token prompt initially. For each later step index, I plotted the median across the 20 requests at concurrency one. This shows the recurring pattern; it doesn’t show every outlier or a confidence interval.

[![Median runner-step duration by token index at concurrency one. Uncached durations rise with prefix length and jump at 65 input tokens; cached durations remain close to 35 ms.](/blog/kv-cache-baseline/steps.svg)](/blog/kv-cache-baseline/steps.svg)

The first thing I checked was `input_tokens`. Without the cache, my runner passes the growing prefix back through the model: 25 input tokens, then 26, and so on through 87. With the cache, the subsequent calls receive one new token.

That is what I mean by a naive KV cache here. I store a K/V pair for each layer of each request, then append the new K/V tensors with `torch.cat`. It’s a straightforward implementation, including allocation and copying as the cache grows. I haven’t built a paged cache allocator.

The cache lets me reuse the history, but attention still uses that history. I’m reducing the new work passed through the model, not shortening the request’s context.

I also had to think beyond the name “KV cache.” In my uncached path, I repeat projections, MLP computation, and the vocabulary projection for the old prefix too. In the cached path, I run those operations for the new token, update its cache, sample, and return the token ID to the CPU.

Here’s the difference at step 40, when both requests have 64 tokens of context:

[![At decode step 40, the uncached model receives all 64 tokens while the cached model receives one new token and reuses 63 tokens of stored keys and values.](/blog/kv-cache-baseline/cache-work.svg)](/blog/kv-cache-baseline/cache-work.svg)

At concurrency one, my average decode runner step went from **40.12 to 36.17 ms**, about a 10% reduction. I also found a repeatable boundary in the uncached path: the median was 39.19 ms at 64 input tokens and 42.23 ms at 65. All 20 uncached requests jumped by more than 2 ms at that boundary.

When I first looked at Jaeger, I assumed the occasional latency jumps were simply the recalculation showing up. Comparing the same step positions across requests made that explanation too broad. I’m recalculating the prefix on every uncached step, while this particular jump recurs at a specific input size.

My working explanation is a size-dependent execution threshold somewhere in the forward pass. PyTorch can choose different attention implementations based on the inputs, but I can’t tell from a `runner.step` span whether attention, a linear operation, or something else caused the transition. I’d need a targeted GPU profile to identify it. [PyTorch’s attention documentation](https://docs.pytorch.org/docs/2.14/generated/torch.nn.functional.scaled_dot_product_attention.html) describes that implementation selection.

I still see isolated spikes in both modes, including an uncached step around 132 ms and a cached step around 102 ms. I can say caching made the typical steps faster and more consistent in these runs. I can’t say it removed every source of variability.

## Does the cache save execution time or waiting time?

A KV-cache latency comparison becomes confusing if I count scheduler waiting as model execution. I record `scheduler.wait_ms` before each runner call to keep the two separate. These were the median decode waits:

| Outstanding requests | No KV | KV |
| --- | --- | --- |
| 1 | 0.21 ms | 0.25 ms |
| 2 | 39.92 ms | 35.52 ms |
| 4 | 117.58 ms | 105.84 ms |

To make the scheduling visible, I pulled two excerpts from the saved concurrency-four traces. These are actual span positions and durations, not a hand-drawn approximation or a Jaeger screenshot. I used requests 8–11 in each run and aligned each panel to request 8’s step 40. Both panels cover 600 ms on the same scale.

:::kv-trace-comparison:::

Hover or focus a colored step to see its full duration, input-token count, and scheduler wait directly here. Click or tap to pin the measurements. I kept the static version available as a [full-size trace figure](/blog/kv-cache-baseline/trace-comparison.svg).

For the uncached bars, the input length grows with the step index. For cached bars, it stays at one. That is the work reduction I can verify directly. The spaces between a request’s bars show time outside that request’s runner execution, while another request may be running.

These panels come from separate runs with independent zero points. Other lanes are at different steps because their arrivals and progress differed. I use the excerpts to inspect execution and waiting, not to calculate an overall speedup from how many bars fit in the picture.

With four active requests, I’m approximately doing this:

```text
A step → B step → C step → D step → A's next step
```

With cached steps around 35 ms, request A waits roughly three times that while B, C, and D take their turns. My measured median wait was about 106 ms. That fits the round-robin behavior I implemented.

It also explains why I can see a 35 ms runner step alongside a much slower per-request decode rate. The request spends time waiting between those steps. I have to keep that waiting separate from execution and avoid adding overlapping parent and child spans together.

For this cache investigation, the distinction is important: I save work inside a runner call, and that shorter call can also let the next waiting request run sooner. I should not describe the whole request-latency change as a faster attention kernel.

## What I still need to check

Before keeping this as a baseline, I checked the summary calculations against the raw timestamps and matched the output-token counts to runner-step counts. That helps me trust the timing pipeline. I still treat output correctness as its own check: faster execution doesn’t establish that my generated tokens match the reference implementation.

I kept the experiment small because GPU time costs money. That leaves real limits: one short prompt, one output length, one GPU, and one pass through each configuration. I also ran no KV before KV, so I haven’t controlled for order or changing GPU conditions.

Each trial gives me 1,260 decode steps, but those belong to only 20 requests. I shouldn’t present them as 1,260 independent request samples or treat the printed tail percentiles as established tail behavior.

I left tracing enabled in both modes so I could investigate the results. I still need tracing-disabled repeats to measure its overhead. I also missed recording the deployed engine and model revisions: those fields say `unreported`. I’m keeping that visible rather than filling in a later commit and pretending it describes this deployment.

The next cache-specific checks are longer input contexts, longer outputs, and memory usage. My `torch.cat` cache still allocates and copies as it grows; I have not measured that cost separately. I also want to compare this append strategy with a preallocated cache while checking that generated tokens remain correct. Those are follow-up experiments, not results I can claim from this short-context run.

## The saved runs

I put the six curated run summaries in the [benchmark viewer](#benchmarks). The [frozen snapshot](/blog/kv-cache-baseline/snapshot.json) contains the summaries, per-step median profiles, and the exact span excerpts behind the trace comparison. I left request headers, target URLs, and infrastructure hostnames out of the public data and kept the original local artifacts as the source records.

I saved the no-KV sweep as `sweep-1038f47f-4b17-457e-8cd7-7bd71d2e58b7` and the KV sweep as `sweep-724beb78-91e0-4eb2-a18e-9cdf13049b4b`. I saved the figures and trace excerpts locally so I can inspect them after releasing the GPU and stopping Jaeger. The interactive comparison reads that snapshot; it does not query the running platform.

I can regenerate the measured figures and snapshot from those original artifacts with `scripts/build_kv_benchmark.py` in the frontend repository:

```sh
python3 scripts/build_kv_benchmark.py \
  --results ../loadgen/results \
  --traces ../inference/observability/traces/spans.jsonl
```

What I learned is fairly specific: my naive cache removes repeated prefix work and reduces typical decode-step time, but a request still pays for a forward pass on the new token, cache maintenance, and any wait for its next turn. The traces let me see those boundaries instead of attributing every improvement—or every spike—to the cache.