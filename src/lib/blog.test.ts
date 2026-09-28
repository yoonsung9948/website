import { describe, expect, it } from 'vitest'
import { loadPosts, parsePost, renderMarkdown, routeFromHash } from './blog'

const post = (extra = '') => `---\ntitle: "Hello: world"\ndate: 2026-01-02\nsummary: Short\ntags: [a, 'b']\n${extra}---\n# Ignored\n\nBody text here.\n`

describe('blog content', () => {
  it('parses front matter, tags and reading time', () => {
    expect(parsePost('hello', post())).toMatchObject({ slug: 'hello', title: 'Hello: world', date: '2026-01-02', summary: 'Short', tags: ['a', 'b'], draft: false, readingMinutes: 1 })
  })
  it('falls back to heading then slug and tolerates no front matter', () => {
    expect(parsePost('x', '# From heading\n\ntext').title).toBe('From heading')
    expect(parsePost('slug-only', 'just text').title).toBe('slug-only')
    expect(parsePost('crlf', '---\r\ntitle: A\r\n---\r\nbody').title).toBe('A')
  })
  it('sorts newest first and hides drafts unless asked', () => {
    const files = { '/c/old.md': post().replace('2026-01-02', '2025-01-01'), '/c/new.md': post(), '/c/wip.md': post('draft: true\n') }
    expect(loadPosts(files, false).map(p => p.slug)).toEqual(['new', 'old'])
    expect(loadPosts(files, true).map(p => p.slug)).toEqual(['new', 'wip', 'old'])
  })
  it('escapes raw HTML and neutralizes script URLs', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>')
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('javascript:')
    expect(renderMarkdown('[ok](https://example.com) [rel](other-page)')).toContain('href="https://example.com"')
    expect(renderMarkdown('`<b>`')).toContain('&lt;b&gt;')
  })
  it('routes hashes', () => {
    expect(routeFromHash('')).toEqual({ page: 'playground' })
    expect(routeFromHash('#about')).toEqual({ page: 'about' })
    expect(routeFromHash('#blog')).toEqual({ page: 'blog', slug: undefined })
    expect(routeFromHash('#blog/my%20post/')).toEqual({ page: 'blog', slug: 'my post' })
  })
})
