
# Save Chat

Distill this conversation into a session note. Save it to `<notes_dir>/<YYYY-MM-DD>-<slug>.md`.

## What to capture

- **Resume Context** — one paragraph: where we left off, what blocked us, what to do first on resume.
- **What changed** — files edited, commits made, infrastructure touched. Reference paths.
- **Decisions** — non-obvious calls made and *why*. Future-you should be able to defend these without re-deriving.
- **Outstanding items** — explicit numbered list. Each item should be actionable on resume without re-reading.
- **References** — links to PRs, issues, docs, dashboards.

## What to skip

- Verbatim transcripts. Anything reconstructible from `git log`.
- Commentary about the model's process ("I read the file, then I checked...").
- Code blocks longer than 5 lines unless the snippet itself is the artifact.

## Filename

```
<YYYY-MM-DD>-<kebab-case-title>.md
```

Date is the date of the session (today, in plain `YYYY-MM-DD`). Slug from `title_hint` if provided, otherwise infer from the session.

## Frontmatter

```yaml
---
name: <Title — Subtitle>
description: <one-line summary that future search will match against>
type: project
---
```

## Anti-patterns

- Don't pad. A 200-word note that captures the essence beats a 2000-word transcript.
- Don't promise to remember. The note IS the memory.
- Don't omit the Resume Context paragraph — that's the whole point of saving the session.
