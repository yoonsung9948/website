import { useMemo } from 'react'
import { findPost, formatDate, posts, renderMarkdown } from './lib/blog'

function Tags({ tags }: { tags: string[] }) { return tags.length ? <ul className="post-tags" aria-label="Tags">{tags.map(tag => <li key={tag}>{tag}</li>)}</ul> : null }

export default function Blog({ slug }: { slug?: string }) {
  const post = findPost(slug)
  const html = useMemo(() => post ? renderMarkdown(post.body) : '', [post])
  if (slug && !post) return <>
    <div className="intro"><p className="eyebrow">404 / NOT FOUND</p><h1 id="blog-heading" tabIndex={-1}>No such post<span className="period">.</span></h1><p className="intro-description">There is nothing published at “{slug}”.</p></div>
    <a className="about-link" href="#blog">← All posts</a>
  </>
  if (post) return <>
    <div className="intro"><p className="eyebrow">{formatDate(post.date) || 'UNDATED'} / {post.readingMinutes} MIN READ{post.draft ? ' / DRAFT' : ''}</p><h1 id="blog-heading" tabIndex={-1}>{post.title}<span className="period">.</span></h1>{post.summary && <p className="intro-description">{post.summary}</p>}</div>
    <article className="mac-window" aria-labelledby="post-title">
      <div className="window-title"><span className="window-box" aria-hidden="true"/><div className="title-lines" aria-hidden="true"/><h2 id="post-title">blog — {post.slug}.md</h2><div className="title-lines" aria-hidden="true"/></div>
      <div className="post-body prose" dangerouslySetInnerHTML={{ __html: html }}/>
      <div className="window-status"><a href="#blog">← All posts</a><Tags tags={post.tags}/></div>
    </article>
  </>
  return <>
    <div className="intro"><p className="eyebrow">NOTES FROM THE BUILD</p><h1 id="blog-heading" tabIndex={-1}>Blog<span className="period">.</span></h1><p className="intro-description">Writing about the engine, the control plane, and what the numbers say.</p></div>
    <section className="mac-window" aria-labelledby="blog-title">
      <div className="window-title"><span className="window-box" aria-hidden="true"/><div className="title-lines" aria-hidden="true"/><h2 id="blog-title">blog — index</h2><div className="title-lines" aria-hidden="true"/></div>
      {posts.length === 0 ? <p className="post-empty">Nothing published yet. Add a Markdown file to <code>content/blog/</code>.</p> : <ol className="post-list">{posts.map(entry => <li key={entry.slug}>
        <a href={`#blog/${encodeURIComponent(entry.slug)}`}><time className="post-date" dateTime={entry.date}>{formatDate(entry.date) || '—'}</time><span className="post-main"><strong>{entry.title}{entry.draft && <em className="draft-badge">draft</em>}</strong>{entry.summary && <span>{entry.summary}</span>}</span><span className="post-meta">{entry.readingMinutes} min <span aria-hidden="true">↗</span></span></a>
      </li>)}</ol>}
      <div className="window-status"><span>{posts.length} {posts.length === 1 ? 'post' : 'posts'} · written in Markdown</span><span className="resize-mark" aria-hidden="true">◩</span></div>
    </section>
  </>
}
