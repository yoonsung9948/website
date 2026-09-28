---
title: How publishing works on this site
date: 2026-09-27
summary: A sample post that doubles as the guide to publishing with Markdown.
tags: [meta, markdown]
draft: true
---

This blog is just a folder of Markdown files. To publish a post, add a `.md` file to `content/blog/`, commit, and deploy. There is no CMS and no database.

## Front matter

Each file starts with a small block between `---` lines:

| Field | Meaning |
| --- | --- |
| `title` | Shown in the index and page title. Falls back to the first `# heading`, then the filename. |
| `date` | `YYYY-MM-DD`. Posts are sorted newest first. |
| `summary` | One line shown in the index and under the title. |
| `tags` | Optional, like `[inference, go]`. |
| `draft` | Set to `true` to hide the post from production builds. Drafts still appear in `npm run dev`. |

The filename becomes the URL: `content/blog/my-post.md` lives at `#blog/my-post`.

## What you can write

Everything in GitHub-flavored Markdown works: **bold**, *italics*, [links](https://example.com), lists, tables, images and quotes.

> Measure first. Then argue about it.

Code blocks are styled like the playground terminal:

```go
func (s *Scheduler) Step(batch []*Request) {
	// admit, decode, evict
}
```

Raw HTML is escaped on purpose, so a stray `<script>` in a post can never run.

## Publishing checklist

1. Write `content/blog/<slug>.md`.
2. Preview with `npm run dev`.
3. Remove `draft: true` and push.
