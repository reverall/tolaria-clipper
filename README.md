<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo.svg" alt="" width="112">
  </picture>
</p>

<h1 align="center">Tolaria Clipper</h1>

<p align="center">
  A browser extension that saves web pages into a <a href="https://tolaria.md/">Tolaria</a>
  vault as Markdown, without launching or focusing the app.<br>
  A fork of <a href="https://github.com/obsidianmd/obsidian-clipper">obsidianmd/obsidian-clipper</a> v1.7.1.
</p>

## What changed from upstream

**Clipping no longer steals focus.** Upstream hands the note to the app through an
`obsidian://new?file=…&content=…` URL, and that navigation is what brings the app to the
front on every single clip. Tolaria's `tolaria://` links are navigation-only by design and
have no equivalent, so this fork writes the `.md` file into the vault folder directly,
through a native messaging host. Tolaria's filesystem watcher picks it up — app closed,
app in the background, it does not matter. See [docs/native-host.md](docs/native-host.md).

**Notes are shaped for Tolaria's model.** The first H1 in the body is the title, because
that is what Tolaria reads for note lists, search, wikilink suggestions and tabs. Filenames
are short kebab-case. Notes land at the vault root, since Tolaria organises by `type` and
relationships rather than folders. `belongs_to` and `related_to` are emitted as empty keys
so a fresh clip shows up in "to process" views. `tags:` is gone — a list of plain strings
creates no graph edges in Tolaria, so it looked like structure without being any.
See [docs/templates.md](docs/templates.md).

## Install

Chrome and Arc are the supported targets. Firefox and Safari builds still compile and fall
back to downloading a `.md` file, but the native host is not wired up for them.

```
npm install
npm run install:local
```

That builds the extension, builds and registers the native host, and loads the extension.
Then open `chrome://extensions`, enable **Developer mode**, and confirm the extension is
loaded from the installed directory — **not** from `dist/`, which is rebuilt on every
build and would break the pinned extension id. [docs/native-host.md](docs/native-host.md)
explains why, and what to do when a clip does not land.

Check the install at any time:

```
npx tolaria-clipper doctor
```

## Running alongside Obsidian Web Clipper

Both extensions can be installed in the same browser profile. Everything they inject into
a page — element ids, CSS classes, custom properties, the `CSS.highlights` registry entry,
window globals, custom events — is namespaced under `tolaria-`, so the two do not fight
over the same nodes.

One thing is not solvable in code: Chrome grants a suggested keyboard shortcut to only one
extension. Whichever you install second starts with no shortcuts, silently. This fork uses
different defaults (`Ctrl/Cmd+Shift+Y`, `Alt+Shift+Y`, `Alt+Shift+J`, `Alt+Shift+K`) to
reduce the overlap, but check `chrome://extensions/shortcuts` after installing.

## Documentation

- [Native host](docs/native-host.md) — how clips reach the vault, install and diagnostics
- [Templates](docs/templates.md) — templates, variables and filters
- [Interpreter](docs/interpreter.md) — extracting data with a language model

## Develop

```
npm run build          # chrome, firefox and safari builds
npm run build:chrome   # just chromium
npm test               # vitest
npm run check-strings  # report unused locale keys
```

Builds land in `dist/`, `dist_firefox/` and `dist_safari/`.

Translations live in [src/_locales](src/_locales); `en` is the source of truth and every
other locale falls back to it for missing keys.

## Third-party libraries

- [webextension-polyfill](https://github.com/mozilla/webextension-polyfill) for browser compatibility
- [defuddle](https://github.com/kepano/defuddle) for content extraction and Markdown conversion
- [dayjs](https://github.com/iamkun/dayjs) for date parsing and formatting
- [lz-string](https://github.com/pieroxy/lz-string) to compress templates to reduce storage space
- [lucide](https://github.com/lucide-icons/lucide) for icons
- [dompurify](https://github.com/cure53/DOMPurify) for sanitizing HTML

## Thanks

This is a fork of [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper),
built by [@kepano](https://github.com/kepano) and the Obsidian team, and released under the
MIT licence.

Nearly everything worth using here came from them: the content extraction, the template
engine with its variables and 53 filters, the reader mode, the highlighter, the interpreter,
and translations into 36 languages. Years of work on the hard parts of turning a web page
into a decent Markdown note — including [Defuddle](https://github.com/kepano/defuddle),
which does the extraction and is a fine library in its own right.

What this fork changes is narrow by comparison: where the note goes, and the shape it takes
once it gets there. Everything else is theirs.

Thank you.

## Licence

MIT, inherited from [obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper);
see [LICENSE](LICENSE), which keeps the original copyright notice alongside this fork's.

Obsidian's trademarks, icons and marketing assets are excluded from that licence and are
not present in this repository — the icons and the in-app mark are Tolaria's.
