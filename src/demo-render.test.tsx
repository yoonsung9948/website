import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import EngineFacts from './EngineFacts'
import RequestDetails from './RequestDetails'
import Experiments from './Experiments'
import { sanitizeEngineInfo } from './lib/engine-info'
import { rawEngineInfo } from './lib/engine-info.fixture'
const info = sanitizeEngineInfo(rawEngineInfo())
it('renders hardware inside existing details with requested and confirmed values distinct', () => {
  const html = renderToStaticMarkup(<EngineFacts snapshot={{ info, fetchedAt: 0, stale: true }} error=""/>)
  expect(html).toContain('RTX A5000')
  expect(html).toContain('requested type')
  expect(html).toContain('stale snapshot')
  expect(html).toContain('Not reported')
  expect(html).not.toContain('<section')
})
it('leaves unavailable measurements empty and retains per-request environment details', () => {
  const html = renderToStaticMarkup(<RequestDetails record={{ requested: { prompt: 'hello', model: 'configured', maxTokens: 32, temperature: 0 }, hardware: info, metrics: { initialQueueMs: 0 } }}/>)
  expect(html).toContain('0 ms')
  expect(html).toContain('—')
  expect(html).toContain('Runtime snapshot saved')
  expect(html).not.toContain('hidden')
})
it('keeps experiments disabled until fresh capabilities and a prompt are available', () => {
  const html = renderToStaticMarkup(<Experiments snapshot={{ info, fetchedAt: 0, stale: true }} request={{ prompt: 'hello', model: 'configured', maxTokens: 32, temperature: 0 }} disabled={false} onBegin={() => true} onEnd={() => {}}/>)
  expect(html).toMatch(/disabled=""[^>]*>Compare cache modes/)
  expect(html).toMatch(/disabled=""[^>]*>Demonstrate batching/)
})
