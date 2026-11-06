"""Regenerate the article's sanitized snapshot and SVG figures from saved artifacts."""
import argparse
import html
import json
from collections import defaultdict
from pathlib import Path
from statistics import mean, median

SWEEPS = {
    "no-kv": "sweep-1038f47f-4b17-457e-8cd7-7bd71d2e58b7",
    "kv": "sweep-724beb78-91e0-4eb2-a18e-9cdf13049b4b",
}
COLORS = {"no-kv": "#b45309", "kv": "#0369a1"}
LABELS = {"no-kv": "No KV cache", "kv": "KV cache"}


def attrs(items):
    return {i["key"]: next(iter(i["value"].values())) for i in items}


def chart(title, subtitle, series, xlabel, ylabel, ticks, output, annotation=None):
    width, height = 960, 480
    left, top, right, bottom = 85, 125, 920, 390
    points = [p for values in series.values() for p in values]
    xmax = max(x for x, _ in points)
    ymax = max(y for _, y in points) * 1.18
    px = lambda x: left + x / xmax * (right - left)
    py = lambda y: bottom - y / ymax * (bottom - top)
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
           f'<title id="title">{html.escape(title)}</title><desc id="desc">{html.escape(subtitle)}. Orange dashed: no KV. Blue solid: KV.</desc>',
           '<rect width="960" height="480" fill="#fffdf7" rx="12"/>',
           '<g font-family="system-ui,sans-serif" fill="#293025">',
           f'<text x="35" y="40" font-size="25" font-weight="600">{html.escape(title)}</text>',
           f'<text x="35" y="68" font-size="14">{html.escape(subtitle)}</text>']
    for i, mode in enumerate(series):
        x = 40 + i * 220
        dash = 'stroke-dasharray="7 5"' if mode == 'no-kv' else ''
        svg += [f'<path d="M{x} 94h34" stroke="{COLORS[mode]}" stroke-width="3" {dash}/>',
                f'<text x="{x + 43}" y="99" font-size="15">{LABELS[mode]}</text>']
    for i in range(5):
        y = ymax * i / 4
        svg += [f'<path d="M{left} {py(y):.2f}H{right}" stroke="#e1e3db"/>',
                f'<text x="{left-12}" y="{py(y)+5:.2f}" text-anchor="end" font-size="13">{y:.1f}</text>']
    for x in ticks:
        svg.append(f'<text x="{px(x):.2f}" y="415" text-anchor="middle" font-size="14">{x}</text>')
    for mode, values in series.items():
        dash = 'stroke-dasharray="7 5"' if mode == 'no-kv' else ''
        path = ' '.join(f'{px(x):.2f},{py(y):.2f}' for x,y in values)
        svg.append(f'<polyline points="{path}" fill="none" stroke="{COLORS[mode]}" stroke-width="3" {dash}/>')
        for x,y in values:
            svg.append(f'<circle cx="{px(x):.2f}" cy="{py(y):.2f}" r="3.5" fill="{COLORS[mode]}"><title>{LABELS[mode]}: {x}, {y:.3f}</title></circle>')
    if annotation:
        x, label = annotation
        svg += [f'<path d="M{px(x):.2f} {top}V{bottom}" stroke="#727768" stroke-dasharray="3 4"/>',
                f'<text x="{px(x)-8:.2f}" y="{top+16}" text-anchor="end" font-size="13">{html.escape(label)}</text>']
    svg += [f'<text x="500" y="451" text-anchor="middle" font-size="15">{html.escape(xlabel)}</text>',
            f'<text x="20" y="260" transform="rotate(-90 20 260)" text-anchor="middle" font-size="14">{html.escape(ylabel)}</text>', '</g></svg>']
    output.write_text('\n'.join(svg))


def trace_comparison(windows, output):
    """A shared-scale view of actual spans, with a separate origin for each run."""
    x0, x1, duration = 160, 925, 600
    px = lambda t: x0 + t / duration * (x1 - x0)
    svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 820" role="img" aria-labelledby="title desc">',
        '<title id="title">Four requests taking turns, with and without KV cache</title>',
        '<desc id="desc">Actual runner spans from two concurrency-four runs. Each panel has four request lanes and a shared 600-millisecond scale. Colored bars are runner execution; spaces between a request’s bars are outside its runner spans. Each run starts its own clock at request 8, step 40.</desc>',
        '<rect width="960" height="820" rx="12" fill="#fffdf7"/>',
        '<g font-family="system-ui,sans-serif" fill="#293025">',
        '<text x="30" y="39" font-size="25" font-weight="600">Four requests, still one runner call at a time</text>',
        '<text x="30" y="68" font-size="15">Actual trace excerpts · concurrency 4 · identical 600 ms scales</text>',
        '<text x="30" y="93" font-size="13">Separate runs aligned at request 8, step 40. Bars show execution, not total request latency.</text>',
    ]
    for panel, window in enumerate(windows):
        mode = window['mode']
        top = 148 + panel * 310
        svg.append(f'<text x="30" y="{top}" font-size="20" font-weight="600" fill="{COLORS[mode]}">{LABELS[mode]}</text>')
        for tick in range(0, duration + 1, 100):
            x = px(tick)
            svg += [f'<path d="M{x:.2f} {top+23}V{top+221}" stroke="#dce0d5"/>',
                    f'<text x="{x:.2f}" y="{top+249}" text-anchor="middle" font-size="13">{tick}</text>']
        for lane, request_id in enumerate(window['request_ids']):
            y = top + 33 + lane * 48
            svg += [f'<rect x="{x0}" y="{y}" width="{x1-x0}" height="32" fill="#edf0e8"/>',
                    f'<text x="{x0-14}" y="{y+21}" text-anchor="end" font-size="15">Request {html.escape(request_id)}</text>']
            for span in window['spans']:
                if span['request_id'] != request_id:
                    continue
                left, right = max(0,span['start_ms']), min(duration,span['end_ms'])
                width = px(right)-px(left)
                label = f"s{span['step_index']}"
                title = html.escape(f"Request {request_id}; step {span['step_index']}; {span['duration_ms']:.2f} ms; input_tokens={span['input_tokens']}; scheduler.wait_ms={span['scheduler_wait_ms']:.2f}")
                svg.append(f'<rect x="{px(left):.2f}" y="{y}" width="{width:.2f}" height="32" rx="3" fill="{COLORS[mode]}"><title>{title}</title></rect>')
                if width > 30:
                    svg.append(f'<text x="{px(left)+width/2:.2f}" y="{y+21}" text-anchor="middle" fill="white" font-size="12">{label}</text>')
        svg.append(f'<text x="540" y="{top+277}" text-anchor="middle" font-size="14">Milliseconds since this panel’s reference step</text>')
    svg += [
        '<text x="30" y="774" font-size="14">s40 = runner step index 40. Hover bars in the full-size SVG for durations and input lengths.</text>',
        '<text x="30" y="799" font-size="14">A gap is time outside that request’s runner span; it is not necessarily idle GPU time.</text>',
        '</g></svg>',
    ]
    output.write_text('\n'.join(svg))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--results', required=True, type=Path)
    parser.add_argument('--traces', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'public')
    args = parser.parse_args()
    traces = defaultdict(list)
    seen = set()
    for line in args.traces.read_text().splitlines():
        if not line.strip():
            continue
        for group in json.loads(line)['resourceSpans']:
            for scope in group.get('scopeSpans', []):
                for span in scope.get('spans', []):
                    key = (span['traceId'], span['spanId'])
                    if key not in seen:
                        seen.add(key)
                        traces[span['traceId']].append(span)
    assets = args.output / 'blog/kv-cache-baseline'
    assets.mkdir(parents=True, exist_ok=True)
    snapshot = {'schema_version': 1, 'date': '2026-11-05', 'tracing': 'enabled', 'runs': [], 'trace_windows': []}
    index_path = args.output / 'benchmarks/index.json'
    index = json.loads(index_path.read_text()) if index_path.exists() else []
    for mode, sweep in SWEEPS.items():
        manifest = json.loads((args.results / sweep / 'sweep.json').read_text())
        for trial in manifest['trials']:
            folder = args.results / sweep / trial['run_directory']
            bundle = json.loads((folder / 'summary.json').read_text())
            records = [json.loads(line) for line in (folder / 'requests.jsonl').read_text().splitlines() if line.strip()]
            assert len(records) == 20 and all(r['outcome'] == 'success' for r in records)
            assert all(r['generation']['use_kv_cache'] == (mode == 'kv') for r in records)
            profiles = defaultdict(list)
            waits = []
            for record in records:
                steps = [s for s in traces[record['trace_id']] if s['name'] == 'runner.step']
                assert len(steps) == 64, 'Missing runner spans'
                assert {int(attrs(s['attributes'])['step.index']) for s in steps} == set(range(64))
                for step in steps:
                    a = attrs(step['attributes'])
                    i = int(a['step.index'])
                    assert a['cache.enabled'] == (mode == 'kv')
                    assert int(a['input_tokens']) == (24 if i == 0 else 1 if mode == 'kv' else 24 + i)
                    if i > 0:
                        profiles[int(a['step.index'])].append((int(step['endTimeUnixNano']) - int(step['startTimeUnixNano'])) / 1e6)
                        waits.append(a['scheduler.wait_ms'])
            if trial['concurrency'] == 4:
                selected = records[8:12]
                reference = next(s for s in traces[selected[0]['trace_id']]
                                 if s['name'] == 'runner.step' and int(attrs(s['attributes'])['step.index']) == 40)
                origin = int(reference['startTimeUnixNano'])
                window = {'mode': mode, 'run_id': bundle['summary']['run_id'],
                          'request_ids': [r['request_id'] for r in selected],
                          'reference_request_id': selected[0]['request_id'],
                          'reference_step_index': 40, 'duration_ms': 600, 'spans': []}
                for r in selected:
                    for span in traces[r['trace_id']]:
                        if span['name'] != 'runner.step':
                            continue
                        start = (int(span['startTimeUnixNano']) - origin) / 1e6
                        end = (int(span['endTimeUnixNano']) - origin) / 1e6
                        if end <= 0 or start >= 600:
                            continue
                        a = attrs(span['attributes'])
                        window['spans'].append({'request_id': r['request_id'],
                            'step_index': int(a['step.index']), 'input_tokens': int(a['input_tokens']),
                            'scheduler_wait_ms': a['scheduler.wait_ms'],
                            'start_ms': start, 'end_ms': end, 'duration_ms': end - start})
                snapshot['trace_windows'].append(window)
            metadata = bundle['metadata']
            # Whitelist context: no auth headers, target URLs, hostnames, or prompts in public bundles.
            public_bundle = {'schema_version': 1, 'metadata': {
                'declared': metadata['declared'], 'effective_generation': metadata['effective_generation'],
                'benchmark': {'sweep_id': sweep, 'concurrency': trial['concurrency'], 'warmup_requests': 1,
                              'request_count': 20, 'input_tokens': sorted({r['input_tokens'] for r in records}),
                              'output_tokens': sorted({r['output_tokens'] for r in records}), 'tracing': 'enabled'},
            }, 'summary': bundle['summary']}
            run_id = bundle['summary']['run_id']
            dest = args.output / 'benchmarks' / run_id
            dest.mkdir(parents=True, exist_ok=True)
            (dest / 'summary.json').write_text(json.dumps(public_bundle, indent=2) + '\n')
            entry = {'summary': f'{run_id}/summary.json'}
            index = [e for e in index if e['summary'] != entry['summary']] + [entry]
            snapshot['runs'].append({'mode': mode, 'concurrency': trial['concurrency'], 'sweep_id': sweep,
                'run_id': run_id, 'summary': bundle['summary'], 'generation': metadata['effective_generation'],
                'decode_steps': sum(map(len, profiles.values())),
                'step_profile': [{'index': i, 'samples': len(v), 'median_ms': median(v)} for i,v in sorted(profiles.items())],
                'mean_step_ms': mean(x for v in profiles.values() for x in v), 'median_scheduler_wait_ms': median(waits)})
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps(index, indent=2) + '\n')
    (assets / 'snapshot.json').write_text(json.dumps(snapshot, indent=2) + '\n')
    runs = snapshot['runs']
    for filename,title,metric,unit in [
        ('throughput.svg','More concurrency, modest throughput gains','output_tokens_per_second','Successful output tokens / second'),
        ('latency.svg','Completion latency grows with concurrency','latency','Client completion p50 (seconds)'),
    ]:
        series = {m: [(r['concurrency'], r['summary'][metric]['p50_ms']/1000 if metric == 'latency' else r['summary'][metric]) for r in runs if r['mode']==m] for m in SWEEPS}
        chart(title,'20 successful requests per point · warmup excluded · tracing enabled',series,'Outstanding requests',unit,[1,2,4],assets/filename)
    series = {m: [(p['index'],p['median_ms']) for r in runs if r['mode']==m and r['concurrency']==1 for p in r['step_profile']] for m in SWEEPS}
    chart('Cached decoding avoids the growing prefix','Concurrency 1 · each point is a median over 20 requests · first token excluded',series,
          'Generated-token step index (zero-based)','Runner step duration (ms)',[1,16,32,41,48,63],assets/'steps.svg',(41,'Uncached prefix reaches 65 tokens'))
    series = {m:[(r['concurrency'],r['median_scheduler_wait_ms']) for r in runs if r['mode']==m] for m in SWEEPS}
    chart('More requests means waiting for another turn','Median wait before decode steps · actual batch size remains 1',series,'Outstanding requests','Scheduler wait (ms)',[1,2,4],assets/'scheduler.svg')
    trace_comparison(snapshot['trace_windows'], assets / 'trace-comparison.svg')
    print('Generated six sanitized run summaries, a frozen snapshot, and five measured SVG figures.')


if __name__ == '__main__':
    main()
