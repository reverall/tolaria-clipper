# Native host

Tolaria Clipper writes clipped notes **straight into your Tolaria vault folder**.
Tolaria watches the vault with a filesystem watcher, so a new note shows up on
its own — without the app being launched, focused, or even running.

A browser extension cannot write to disk, so a small helper does it: a native
messaging host the browser starts on demand, talks to over stdin/stdout, and
shuts down again.

## Why not a URL scheme

Tolaria's `tolaria://` links are **navigation-only by design** (ADR-0129: they
"never create missing files, import external content"). There is no equivalent
of Obsidian's `obsidian://new?file=…&content=…`, and the URL navigation Obsidian
relied on is exactly what brought the app to the foreground on every clip.

Tolaria's local WebSocket bridges (ports 9710/9711) are not an option either:
the tool bridge rejects any request carrying an `Origin` header, and browsers
always send one.

## Install

### From the archive

The downloadable archive carries the extension and one file that registers the
host:

```sh
node connect.cjs             # register with Chrome and Arc
node connect.cjs doctor      # diagnose
node connect.cjs disconnect  # remove
```

It takes the same flags as `install-host` below — `--dry-run`, `--browsers=`,
`--extension-id`. The host bundle is embedded in `connect.cjs` itself, so the
archive has nothing else to keep together, and it installs to the same place a
checkout would. Loading the extension is left to you; see the README.

### From a checkout

One command builds and installs everything:

```sh
npm run install:local
```

That is equivalent to:

```sh
npm run build:chrome && npm run build:host && npm run build:cli
node dist/cli.cjs install-extension   # copies the extension somewhere stable
node dist/cli.cjs install-host        # registers the helper with Chrome and Arc
```

`install-host` will:

1. Copy the host bundle to `~/.tolaria-clipper/host/host.cjs`.
2. Write `~/.tolaria-clipper/host/run.sh`, a launcher pointing at an **absolute**
   Node path.
3. Register `com.tolaria.clipper.json` for Chrome and Arc.

Then load the extension (below) and clip a page.

## Never load the extension from `dist/`

Chrome does **not** copy an unpacked extension. It stores the *path* and re-reads
that directory on every launch. A build directory is the wrong thing to point it
at: `dist/` is gitignored, gets rebuilt, and inside a scratch workspace it can
disappear entirely — at which point Chrome disables the extension.

So `install-extension` copies the build to a stable location:

```sh
node dist/cli.cjs install-extension [--from <dir>] [--dry-run]
```

```
~/.tolaria-clipper/extension/
```

Load **that** path via **Load unpacked** in `chrome://extensions` (and
`arc://extensions`), with Developer mode enabled.

The Node build outputs that share `dist/` — `cli.cjs`, `native-host.cjs`,
`api.mjs` — are left out of the copy; they are not part of the extension and
would add megabytes to what the browser loads.

**After every rebuild**, re-run `install-extension` and press Reload on the
extension card. The extension id does not change when the directory moves,
because it is pinned by the manifest's `key` field — so the native messaging
registration keeps working.

### Options

| Flag | Effect |
| --- | --- |
| `--dry-run` | Print what would be written, without writing |
| `--browsers=chrome,arc` | Restrict to, or opt into, specific browsers |
| `--extension-id <id>` | Allow an additional extension id (sideloaded builds) |
| `--force` | Write even where the browser profile directory is absent |

Supported ids: `chrome`, `arc` (default), plus `brave`, `edge`, `chromium`,
`vivaldi`, `chrome-beta`, `chrome-canary` on request.

### Why the launcher shim

Browsers start native hosts with a minimal `PATH` — roughly
`/usr/bin:/bin:/usr/sbin:/sbin`. That excludes Homebrew, nvm and `~/.local/bin`,
so a `#!/usr/bin/env node` shebang **fails silently** on most developer
machines. The installer resolves `process.execPath` at install time and bakes
the absolute path into `run.sh`.

If you later change Node versions and the helper stops responding, re-run
`install-host` to refresh the path.

## Diagnose

```sh
node dist/cli.cjs doctor   # or: node connect.cjs doctor
```

Reports the resolved Node and host paths, which browser manifests exist and
which extension ids they allow, the vaults read from Tolaria's registry and
whether they are writable, and whether Tolaria's optional tool bridge is up.

The same report is available in the extension's settings, under **Tolaria
connection → Check again**.

## Remove

```sh
node dist/cli.cjs uninstall-host   # or: node connect.cjs disconnect
```

Removes the browser manifests and `~/.tolaria-clipper/host/`.

It deliberately leaves `~/.tolaria-clipper/extension/` alone — deleting a
directory the browser is actively loading would break the extension rather than
uninstall it. Remove the extension from `chrome://extensions` first, then delete
that folder by hand if you want it gone.

## Where things live

| Path | Purpose |
| --- | --- |
| `~/.tolaria-clipper/extension/` | The unpacked extension Chrome loads |
| `~/.tolaria-clipper/host/host.cjs` | The host bundle |
| `~/.tolaria-clipper/host/run.sh` | Launcher with an absolute Node path |
| `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.tolaria.clipper.json` | Chrome registration |
| `~/Library/Application Support/Arc/User Data/NativeMessagingHosts/com.tolaria.clipper.json` | Arc registration |
| `~/Library/Application Support/com.tolaria.app/vaults.json` | Tolaria's vault registry (read-only) |

Arc nests its profile under an extra `User Data` segment, unlike every other
Chromium browser. Getting that wrong is the classic "works on Chrome, silently
does nothing on Arc" failure.

## Extension id pinning

For an unpacked extension Chrome derives the id from a hash of the load
directory, so it differs per machine — which makes it impossible to bake into
`allowed_origins`. The repo therefore ships a `key` field in
`src/manifest.chrome.json`, from which Chrome derives a **constant** id.

Regenerate the pair with:

```sh
node scripts/gen-extension-key.mjs --write
```

This writes the public key into the manifest and the private key into `.keys/`
(gitignored — never commit it). Update `PINNED_EXTENSION_IDS` in
`src/native-host/installer.ts` with the printed id.

## Protocol

Framing is standard native messaging: a 4-byte native-endian `uint32` length
prefix, then UTF-8 JSON, in both directions. Requests are
`{v, id, op, params}`; responses are `{v, id, ok: true, result}` or
`{v, id, ok: false, error: {code, message}}`.

| Op | Purpose |
| --- | --- |
| `ping` | Liveness and version check |
| `listVaults` | Vaults from Tolaria's registry |
| `resolveNote` | Preview the exact path a save would use |
| `saveNote` | Write a note (`create`/`overwrite`/`append`/`prepend`/`skipIfExists`) |
| `openNote` | Open a note via `tolaria://` — the only op that focuses Tolaria |
| `doctor` | Full diagnostic report |

Responses are capped at 1 MB by the browser; oversized ones are replaced with an
`E_TOO_LARGE` error rather than being silently dropped.

### Safety properties

- **Atomic writes.** Every write goes through a sibling temp file plus
  `rename(2)`. Vaults are watched live and often auto-committed and pushed by
  AutoGit, so a partial write would become a partial commit on your remote.
- **No paths from the browser.** The host only accepts a vault *reference*
  resolved against Tolaria's own registry; a caller can never hand it an
  absolute path.
- **Containment.** Resolved targets must stay under the vault root, checked both
  literally and after resolving symlinks on the deepest existing ancestor.
  `.git`, `.obsidian`, `.tolaria-rename-txn` and dot-segments are refused.
- **Frontmatter-aware prepend.** Content is inserted *after* a closing `---`, so
  prepending never corrupts the YAML that carries a note's type and
  relationships.
- **No focus stealing.** `openNote` is the single code path that can bring
  Tolaria forward, and it only runs on explicit request.
