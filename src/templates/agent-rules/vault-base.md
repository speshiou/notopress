# This is a Notopress vault

This vault is synced by Notopress. Edit source Markdown files and source assets, but do not manually edit generated files such as `root.json`, directory-level `index.json`, or generated thumbnails. Regenerate them with the Notopress publishing tooling when needed.

Keep article metadata consistent with the surrounding Markdown files. Preserve existing frontmatter fields unless the edit explicitly requires changing them. Put YAML frontmatter at the very start of each article, enclosed by `---` delimiters, using this format:

```yaml
---
title: "Article title"
date: "2026-01-15T08:30:00.000Z"
published: true
categories:
  - engineering
tags:
  - publishing
---
```

Use an ISO 8601 timestamp for `date`. Set `published: false` to exclude a draft from generated indexes. `categories` and `tags` are optional arrays of taxonomy slugs. When present, keep each slug as a separate list item; omit either field when the article does not manage that taxonomy.

For captions, use a single italic paragraph immediately after the media or table. For table captions, place the caption directly after the Markdown table, for example: `*Feature comparison table.*`. Plain paragraphs are treated as normal article text, not captions.

In Markdown tables, escape the alias separator in Obsidian wikilinks: `[[note-slug\|Display label]]`. An unescaped `|` is treated as a new table column and breaks the table. Outside tables, normal aliased wikilinks (`[[note-slug|Display label]]`) are fine. Keep wikilinks in vault source instead of rewriting them to standard Markdown links. Notopress sync warns when it finds unescaped table wikilinks.
