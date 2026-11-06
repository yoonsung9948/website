export type ServerEvent = { event: string; data: string }

/** Incremental SSE framing. A network read is neither an event nor a token. */
export async function* readSSE(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<ServerEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let event = ''
  let data: string[] = []
  let eventSize = 0
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      while (true) {
        const match = /[\r\n]/.exec(buffer)
        if (!match || (!done && match[0] === '\r' && match.index === buffer.length - 1)) break
        const line = buffer.slice(0, match.index)
        const width = buffer.slice(match.index, match.index + 2) === '\r\n' ? 2 : 1
        buffer = buffer.slice(match.index + width)
        eventSize += line.length
        if (eventSize > 1_048_576) throw new Error('Stream event exceeds the size limit.')
        if (line === '') {
          if (data.length) yield { event: event || 'message', data: data.join('\n') }
          event = ''; data = []; eventSize = 0
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':')
          const field = colon < 0 ? line : line.slice(0, colon)
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
          if (field === 'event') event = value
          if (field === 'data') data.push(value)
        }
      }
      if (buffer.length + eventSize > 1_048_576) throw new Error('Stream event exceeds the size limit.')
      if (done) return
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
