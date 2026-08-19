# Templates

A template decides three things about a clip: what the note is called, where it goes, and
what ends up inside it. Settings → Templates.

## The default template

Every field below is editable; this is the shape a fresh install starts from, and it is
built around how Tolaria reads a note rather than how Obsidian does.

| Field | Value |
|---|---|
| Behaviour | Create new note |
| Note name | `{{title\|kebab_slug}}` |
| Path | *(empty — vault root)* |
| Content | `# {{title}}` then `{{content\|strip_h1}}` |

Properties:

```yaml
type: Clippings          # keyword
url: {{url}}             # text
author: {{author|split:", "}}
published: {{published}}
created: {{date|date:"YYYY-MM-DD"}}
description: {{description}}
belongs_to:              # relation, deliberately empty
related_to:              # relation, deliberately empty
```

Four decisions in there are worth knowing about, because they are the difference between a
note Tolaria understands and one it merely stores:

- **The H1 carries the title.** Tolaria reads the first `# ` in the body for note lists,
  search, wikilink suggestions and tab labels. A `title:` property is only a legacy
  fallback, and keeping both gives you two values that drift apart the moment you edit one.
  `strip_h1` removes the heading Defuddle sometimes leaves at the top of `{{content}}`, so
  you do not end up with two.
- **The filename is secondary**, so it is short kebab-case rather than a 180-character
  title. `kebab_slug` strips diacritics, lowercases, collapses everything else to `-`, and
  truncates at 80 characters on a word boundary.
- **Notes land at the vault root.** Tolaria organises by `type` and by relationships; it
  never infers a type from a folder. A `Clippings/` folder would add nothing that `type:`
  does not already say.
- **`belongs_to` and `related_to` are emitted as bare empty keys**, not omitted and not
  `key: ""`. That is what the "to process" views test for, and it is what makes them show
  up as placeholders in the Properties panel. Clip fast, file later.

There is deliberately no `tags:` property. In Tolaria a list of plain strings creates no
graph edges, so it looks like structure without being any. Use `related_to` with wikilinks.

## Property types

| Type | Emits |
|---|---|
| `text` | `key: value` |
| `multitext` | a YAML list |
| `number` | unquoted number |
| `checkbox` | `true` / `false` |
| `date`, `datetime` | date-formatted scalar |
| `keyword` | unquoted scalar when it is a safe YAML token, e.g. `type: Clippings` |
| `relation` | empty key when unset, `key: "[[x]]"` for one, a YAML list for several |

Property names starting with `_` are reserved by Tolaria and rejected by the editor.

## Behaviours

Create a new note, add to an existing note (at the top or bottom), add to the daily note
(at the top or bottom), or overwrite. Daily-note behaviours use the date format and path
from Settings → General.

## Variables

Available in both the note name and the body.

| Variable | What it is |
|---|---|
| `{{title}}` | Page title |
| `{{content}}` | Extracted article content, as Markdown |
| `{{contentHtml}}` | The same, as HTML |
| `{{selection}}`, `{{selectionHtml}}` | Whatever is selected on the page |
| `{{highlights}}` | Your highlights on this page |
| `{{url}}`, `{{domain}}`, `{{site}}` | Where it came from |
| `{{author}}`, `{{published}}`, `{{description}}` | Page metadata |
| `{{image}}`, `{{favicon}}` | Page images |
| `{{date}}`, `{{time}}` | Now, as an ISO timestamp |
| `{{language}}`, `{{words}}` | Page language, word count |
| `{{fullHtml}}` | The whole page |

Plus anything the page exposes:

- `{{meta:name:description}}` and `{{meta:property:og:image}}` for meta tags
- `{{schema:@Article:author}}` for schema.org data
- Defuddle extras such as `{{transcript}}` on pages that have one

Settings → General → **Show actions button** adds a page-variables inspector to the popup,
which lists what a given page actually offers.

## Filters

Chain them with `|`, pass arguments after `:`.

```
{{title|kebab_slug}}
{{author|split:", "}}
{{date|date:"YYYY-MM-DD"}}
{{content|strip_h1}}
{{description|replace:"\n":" "|trim}}
```

53 filters ship with the extension:

**Text** `lower` `upper` `title` `capitalize` `trim` `replace` `slice` `split` `join`
`length` `unescape` `decode_uri` `template`

**Naming** `kebab_slug` `kebab` `camel` `pascal` `snake` `uncamel` `safe_name`

**Markdown and HTML** `markdown` `strip_md` `stripmd` `strip_h1` `strip_tags` `strip_attr`
`remove_html` `remove_tags` `remove_attr` `replace_tags` `blockquote` `callout` `footnote`
`table` `list` `link` `image` `fragment_link` `html_to_json`

**Lists and objects** `first` `last` `nth` `reverse` `unique` `merge` `map` `object`

**Numbers and dates** `calc` `round` `number_format` `date` `date_modify` `duration`

`kebab_slug` is the one to reach for on filenames; plain `kebab` is the upstream filter and
handles only camelCase, spaces and underscores — it lets accents and punctuation through.
