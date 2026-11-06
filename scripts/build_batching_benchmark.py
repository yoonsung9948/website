"""Generate sanitized article figures from a saved batching session (standard library only)."""
import argparse
import html
import json
import math
from pathlib import Path
from statistics import median

COLORS = {False: '#b45309', True: '#0369a1'}
LABELS = {False: 'Pool, batching off', True: 'Pool, batching on'}

def frame(title, subtitle, height=480):
    return [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 {height}" role="img" aria-labelledby="title desc">',
            f'<title id="title">{html.escape(title)}</title><desc id="desc">{html.escape(subtitle)}</desc>',
            f'<rect width="960" height="{height}" rx="12" fill="#fffdf7"/>',
            '<g font-family="system-ui,sans-serif" fill="#293025">',
            f'<text x="32" y="40" font-size="25" font-weight="600">{html.escape(title)}</text>',
            f'<text x="32" y="68" font-size="14">{html.escape(subtitle)}</text>']

def finish(svg, path):
    path.write_text('\n'.join(svg + ['</g></svg>']) + '\n')

def chart(rows, field, title, unit, path):
    svg = frame(title, 'Same pooled cache · 20 successful requests per point · one trial per configuration')
    left, right, top, bottom = 90, 910, 140, 390
    maximum = max(r[field] for r in rows)
    ceiling = math.ceil(maximum * 1.15 / (10 if maximum > 20 else 1)) * (10 if maximum > 20 else 1)
    px = lambda x: left + (x - 1) / 3 * (right - left)
    py = lambda y: bottom - y / ceiling * (bottom - top)
    for i in range(5):
        value = ceiling * i / 4
        svg += [f'<path d="M{left} {py(value)}H{right}" stroke="#e0e3d9"/>',
                f'<text x="78" y="{py(value)+5}" text-anchor="end" font-size="13">{value:g}</text>']
    for c in (1, 2, 4):
        svg.append(f'<text x="{px(c)}" y="416" text-anchor="middle" font-size="14">{c}</text>')
    for enabled in (False, True):
        values = sorted((r['concurrency'], r[field]) for r in rows if r['batching'] is enabled)
        color = COLORS[enabled]
        dash = '' if enabled else 'stroke-dasharray="7 5"'
        svg += [f'<path d="M{40+int(enabled)*330} 100h35" stroke="{color}" stroke-width="3" {dash}/>',
                f'<text x="{85+int(enabled)*330}" y="105" font-size="15">{LABELS[enabled]}</text>',
                f'<polyline points="{" ".join(f"{px(x)},{py(y)}" for x,y in values)}" fill="none" stroke="{color}" stroke-width="3" {dash}/>']
        for x, y in values:
            if enabled:
                svg.append(f'<circle cx="{px(x)}" cy="{py(y)}" r="5" fill="{color}"/>')
            else:
                svg.append(f'<rect x="{px(x)-4}" y="{py(y)-4}" width="8" height="8" fill="{color}"/>')
            anchor = 'end' if x == 4 else 'start'
            offset = -8 if x == 4 else 8
            svg.append(f'<text x="{px(x)+offset}" y="{py(y)+(-12 if enabled else 22)}" text-anchor="{anchor}" font-size="14" fill="{color}">{y:.2f}</text>')
    svg += [f'<text x="32" y="130" font-size="13">{unit}</text>',
            '<text x="500" y="459" font-size="14" text-anchor="middle">Outstanding client requests</text>']
    finish(svg, path)

def read(path):
    return json.loads(path.read_text())

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--session', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=Path('public/blog/continuous-batching'))
    args = parser.parse_args()
    session, out = args.session, args.output
    out.mkdir(parents=True, exist_ok=True)
    manifest = read(session / 'session.json')
    memory = {read(p)['run_id']: read(p) for p in (session / 'memory-comparison').glob('trial-*/memory.json')}
    rows, diagnostics = [], []
    for trial in manifest['trials']:
        directory = next((session / trial['directory']).glob('*/summary.json')).parent
        bundle = read(directory / 'summary.json')
        summary = bundle['summary']
        records = [json.loads(line) for line in (directory / 'requests.jsonl').read_text().splitlines()]
        generation = bundle['metadata']['effective_generation']
        assert len(generation) == 1 and generation[0]['kv_cache_mode'] == 'pool'
        assert generation[0]['decode_batching'] is trial['batching']
        assert summary['failed'] == summary['skipped'] == summary['cancelled'] == 0
        assert summary['successful'] == trial['requests']
        assert all(r['input_tokens'] == 24 and r['output_tokens'] == 64 for r in records)
        if trial['kind'] == 'diagnostic':
            diagnostics.append((trial, records))
            continue
        assert trial['kind'] == 'performance' and summary['successful'] == 20
        mem = memory[summary['run_id']]
        assert mem['status'] == 'complete' and mem['coverage']['covered_requests'] == 20
        rows.append({'run_id': summary['run_id'], 'concurrency': trial['concurrency'], 'batching': trial['batching'],
                     'successful': 20, 'output_tokens': summary['output_tokens'],
                     'elapsed_seconds': summary['elapsed_seconds'], 'tokens_per_second': summary['output_tokens_per_second'],
                     'completion_seconds': summary['latency']['p50_ms']/1000,
                     'engine_ttft_ms': summary['engine_ttft']['p50_ms'],
                     'first_text_ms': summary['first_text_latency']['p50_ms'],
                     'batch_mean': summary['decode_batch_size']['mean'], 'batch_max': summary['decode_batch_size']['max'],
                     'memory': mem['metrics'],
                     'generation': {k: generation[0][k] for k in ('model','backend','device_name','dtype','torch_version','transformers_version','engine_revision','model_revision')}})
    assert len(rows) == 6 and {(r['concurrency'],r['batching']) for r in rows} == {(c,b) for c in (1,2,4) for b in (False,True)}
    for field, title, unit, filename in [
        ('tokens_per_second','More requests finally increased throughput','Output tokens/s','throughput.svg'),
        ('completion_seconds','Completion latency at the same concurrency','Client completion p50, seconds','latency.svg'),
        ('engine_ttft_ms','First-token latency changed much less','Engine TTFT p50, milliseconds','ttft.svg'),
        ('batch_mean','Did requests actually share decode turns?','Mean request-observed decode batch size','batches.svg')]:
        chart(rows, field, title, unit, out / filename)
    mem0 = rows[0]['memory']
    svg = frame('The whole-window allocation peak stayed flat', 'Process CUDA allocator · additional peak above idle · zero-based scale', 440)
    svg += [f'<text x="32" y="106" font-size="16">Idle allocation: {mem0["baseline_allocated_bytes"]/2**30:.3f} GiB, including the fixed 1.125 GiB KV pool</text>']
    for index, row in enumerate(rows):
        value = row['memory']['peak_increase_over_first_idle_bytes']/2**20
        y = 155 + index * 37
        svg += [f'<text x="32" y="{y+16}" font-size="14">C={row["concurrency"]} · {"on" if row["batching"] else "off"}</text>',
                f'<rect x="155" y="{y}" width="{value/10*620}" height="21" rx="3" fill="{COLORS[row["batching"]]}"/>',
                f'<text x="{165+value/10*620}" y="{y+16}" font-size="14">{value:.2f} MiB</text>']
    svg.append('<text x="155" y="414" font-size="14">0                          Peak above idle; scale ends at 10 MiB</text>')
    finish(svg,out/'memory.svg')
    windows, trace_stats = [], []
    all_spans = [json.loads(line) for p in (session/'trace-comparison').glob('trial-*/spans.jsonl') for line in p.read_text().splitlines()]
    svg = frame('Separate turns versus shared decode turns', 'Diagnostic runs · C=4 · first four measured requests · independent zero points', 590)
    for index, (trial, records) in enumerate(diagnostics):
        ids = {r['engine_request_id']: str(r['request_id']) for r in records}
        generations = {r['span_id']: ids[r['attributes']['request.id']] for r in all_spans if r['name']=='generation.request' and r['attributes'].get('request.id') in ids}
        steps = [r for r in all_spans if r['name']=='runner.step' and r['parent_span_id'] in generations]
        decode = [r for r in steps if r['attributes']['step.index'] > 0]
        assert len(steps) == 8*64 and len(decode) == 8*63
        stat = {'batching':trial['batching'],'run_id':trial['run_id'],'requests':8,'decode_participations':len(decode),
                'median_runner_ms':median((r['end_ns']-r['start_ns'])/1e6 for r in decode),
                'median_wait_ms':median(r['attributes']['scheduler.wait_ms'] for r in decode)}
        trace_stats.append(stat)
        origin = next(r['start_ns'] for r in decode if generations[r['parent_span_id']]=='0' and r['attributes']['step.index']==20)
        spans=[]; top=140+index*210
        svg.append(f'<text x="32" y="{top-17}" font-size="17" fill="{COLORS[trial["batching"]]}">{LABELS[trial["batching"]]} · median runner {stat["median_runner_ms"]:.2f} ms / wait {stat["median_wait_ms"]:.2f} ms</text>')
        for lane in range(4):
            y=top+lane*35
            svg += [f'<text x="32" y="{y+17}" font-size="14">Request {lane+1}</text>',f'<path d="M140 {y+23}H920" stroke="#e0e3d9"/>']
        for span in decode:
            local=generations[span['parent_span_id']]
            start,end=(span['start_ns']-origin)/1e6,(span['end_ns']-origin)/1e6
            if local not in ('0','1','2','3') or end<=0 or start>=700:continue
            attrs=span['attributes'];duration=end-start
            spans.append({'request':local,'step':attrs['step.index'],'start_ms':start,'duration_ms':duration,'batch_size':attrs['batch_size'],'input_tokens':attrs['input_tokens'],'scheduler_wait_ms':attrs['scheduler.wait_ms']})
            x=140+max(0,start)/700*780;width=(min(700,end)-max(0,start))/700*780;y=top+int(local)*35
            title=f'Step {attrs["step.index"]}: {duration:.2f} ms; batch {attrs["batch_size"]}; input {attrs["input_tokens"]}; wait {attrs["scheduler.wait_ms"]:.2f} ms'
            svg.append(f'<rect x="{x:.2f}" y="{y}" width="{width:.2f}" height="23" rx="3" fill="{COLORS[trial["batching"]]}"><title>{html.escape(title)}</title></rect>')
        windows.append({'batching':trial['batching'],'run_id':trial['run_id'],'duration_ms':700,'reference_request':'0','reference_step':20,'spans':spans})
        for tick in (0,175,350,525,700):
            svg.append(f'<text x="{140+tick/700*780}" y="{top+158}" text-anchor="middle" font-size="13">{tick}</text>')
    svg.append('<text x="480" y="571" text-anchor="middle" font-size="14">Milliseconds from request 1, step 20 · overlapping bars are request participations</text>')
    finish(svg,out/'trace.svg')
    snapshot={'schema_version':1,'session_id':session.name,'primary':rows,'diagnostic':trace_stats,'trace_windows':windows,
              'definitions':{'throughput':'Successful output tokens / elapsed seconds including drain; warmup excluded.',
                             'batch_mean':'Mean per-request decode batch participation; not a physical-call average.',
                             'memory':'Process CUDA allocator, whole-window peak; includes model/pool; not total GPU memory.'}}
    (out/'snapshot.json').write_text(json.dumps(snapshot,indent=2)+'\n')
    print('Wrote six figures and sanitized snapshot to', out)

if __name__ == '__main__':main()
