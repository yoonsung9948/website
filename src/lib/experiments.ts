import { generate, type GenerationEvent, type GenerationRequest } from './client'
import { batchingDemoLimit, type EngineInfo } from './engine-info'
import type { RequestRecord } from '../RequestDetails'
export type ExperimentJob = { label: string; request: GenerationRequest }
export type ExperimentResult = RequestRecord & { label: string; output: string; error: string; status: 'waiting' | 'running' | 'complete' | 'error' | 'stopped' | 'skipped' }
export function cacheComparisonJobs(request: GenerationRequest, info: EngineInfo): ExperimentJob[] {
  return info.cacheModes.map(mode => ({ label: `${mode} cache`, request: { ...request, kvCacheMode: mode, decodeBatching: false, temperature: 0 } }))
}
export function batchingJobs(request: GenerationRequest, info: EngineInfo, count: number): ExperimentJob[] {
  if (!Number.isInteger(count) || count < 2 || count > batchingDemoLimit(info)) throw new Error('The running engine does not have sufficient reported batching capacity.')
  return Array.from({ length: count }, (_, i) => ({ label: `Request ${i + 1}`, request: { ...request, kvCacheMode: 'pool', decodeBatching: true, temperature: 0 } }))
}
// Each job is submitted once. A rejected trial is evidence, never silently retried.
export async function executeExperiment(jobs: ExperimentJob[], info: EngineInfo, concurrent: boolean, signal: AbortSignal,
  onUpdate: (results: ExperimentResult[]) => void, run = generate): Promise<ExperimentResult[]> {
  const hardware = structuredClone(info)
  const results: ExperimentResult[] = jobs.map(job => ({ requested: { ...job.request }, hardware, label: job.label, output: '', error: '', status: 'waiting' }))
  const publish = () => onUpdate(results.map(result => ({ ...result })))
  async function execute(index: number) {
    const result = results[index]
    if (signal.aborted) { result.status = 'stopped'; publish(); return }
    result.status = 'running'; publish()
    try {
      for await (const event of run(result.requested, signal)) {
        applyEvent(result, event); publish()
      }
      result.status = 'complete'
    } catch (cause) {
      result.status = signal.aborted ? 'stopped' : 'error'
      result.error = signal.aborted ? 'Stopped' : cause instanceof Error ? cause.message : 'Experiment request failed.'
    }
    publish()
  }
  publish()
  if (concurrent) await Promise.all(results.map((_, i) => execute(i)))
  else for (let i = 0; i < results.length; i++) {
    if (i > 0 && results[i - 1].status !== 'complete') {
      for (const result of results.slice(i)) result.status = signal.aborted ? 'stopped' : 'skipped'
      publish(); break
    }
    await execute(i)
  }
  return results
}
function applyEvent(result: ExperimentResult, event: GenerationEvent) {
  switch (event.type) {
    case 'delta': result.output += event.text; break
    case 'metrics': result.metrics = event.metrics; break
    case 'generation': result.generation = event.generation; break
    case 'completion': result.requestId = event.requestId; result.finishReason = event.finishReason; break
  }
}
