import { Marked } from 'marked'

export type Post = { slug: string; title: string; date: string; summary: string; tags: string[]; draft: boolean; body: string; readingMinutes: number }
export type Route = { page: 'playground' } | { page: 'about' } | { page: 'blog'; slug?: string }

const SAFE_URL = /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Posts are trusted build-time content, but we still refuse raw HTML and script-y URLs so a pasted snippet can't break the page.
const markdown = new Marked({
  gfm: true,
  renderer: { html: ({ text }) => escapeHtml(text) },
  walkTokens(token) {
    if ((token.type === 'link' || token.type === 'image') && !SAFE_URL.test(token.href.trim()) && !/^[a-z0-9._~-]+(\/|$)/i.test(token.href.trim())) token.href = '#'
  },
})

export function renderMarkdown(body: string): string { return markdown.parse(body, { async: false }) }

function parseValue(value: string): string | string[] {
  const trimmed = value.trim()
  const unquote = (text: string) => text.trim().replace(/^(["'])(.*)\1$/, '$2')
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed.slice(1, -1).split(',').map(unquote).filter(Boolean)
  return unquote(trimmed)
}

export function parsePost(slug: string, raw: string): Post {
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/)
  const meta: Record<string, string | string[]> = {}
  if (match) for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon > 0 && !line.startsWith('#')) meta[line.slice(0, colon).trim()] = parseValue(line.slice(colon + 1))
  }
  const body = (match ? text.slice(match[0].length) : text).trim()
  const heading = body.match(/^#\s+(.+)$/m)?.[1]
  const str = (key: string) => typeof meta[key] === 'string' ? meta[key] as string : ''
  const tags = Array.isArray(meta.tags) ? meta.tags : str('tags') ? [str('tags')] : []
  const words = body.split(/\s+/).filter(Boolean).length
  return { slug, title: str('title') || heading || slug, date: str('date'), summary: str('summary'), tags, draft: str('draft') === 'true', body, readingMinutes: Math.max(1, Math.round(words / 220)) }
}

export function loadPosts(files: Record<string, string>, includeDrafts: boolean): Post[] {
  return Object.entries(files)
    .map(([path, raw]) => parsePost(path.split('/').pop()!.replace(/\.md$/, ''), raw))
    .filter(post => includeDrafts || !post.draft)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
}

// Drop a .md file in content/blog/ and it is published on the next build. Drafts show up in `npm run dev` only.
export const posts = loadPosts(import.meta.glob('../../content/blog/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>, import.meta.env.DEV)
export const findPost = (slug: string | undefined) => posts.find(post => post.slug === slug)

export function formatDate(date: string): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : undefined
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : date
}

export function routeFromHash(hash: string): Route {
  if (hash.startsWith('#blog')) {
    const slug = hash.startsWith('#blog/') ? decodeURIComponent(hash.slice(6)).replace(/\/$/, '') : ''
    return { page: 'blog', slug: slug || undefined }
  }
  return hash.startsWith('#about') ? { page: 'about' } : { page: 'playground' }
}
