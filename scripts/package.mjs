// Builds the downloadable archive: the unpacked extension, plus the one file
// that connects it to a Tolaria vault.
//
// Order matters. dist/ is wiped and the Chromium build runs first, so what gets
// copied into extension/ is the extension and nothing else — the Node artifacts
// (cli.cjs, api.mjs, native-host.cjs, connect.cjs) are built afterwards, into a
// directory that has already been copied. No exclusion list to keep in sync.

import { execFileSync } from 'child_process';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));

const dist = path.join(root, 'dist');
const builds = path.join(root, 'builds');
const name = `tolaria-clipper-${version}`;
const stage = path.join(builds, name);

function run(script) {
	console.log(`\n> npm run ${script}`);
	execFileSync('npm', ['run', script], { cwd: root, stdio: 'inherit' });
}

function readme() {
	return `Tolaria Clipper ${version}

Saves web pages into a Tolaria vault as Markdown, without launching or
focusing the app.


INSTALL (Chrome or Arc)

1. Move this folder somewhere permanent.

   Chrome remembers the path to an unpacked extension, not its contents, so
   one loaded from ~/Downloads or the Desktop stops working the day you tidy
   up.

2. Load the extension.

   Open chrome://extensions (arc://extensions), turn on Developer mode, click
   "Load unpacked", and select the "extension" folder next to this file.

3. Connect it to your vault. In a terminal, from this folder:

       node connect.cjs

   On Windows, open PowerShell here and run the same command. Node 18 or
   later is required — https://nodejs.org

   This step cannot be a file to copy: Chrome needs an absolute path to the
   helper, and the helper needs an absolute path to Node. Both depend on your
   machine.

4. Clip a page. Tolaria should not come to the front.


CHECK

    node connect.cjs doctor

Reports where the helper was installed, which browsers know about it, and
which vaults it can see.


REMOVE

    node connect.cjs disconnect

Then remove the extension from chrome://extensions and delete this folder.


https://github.com/reverall/tolaria-clipper
`;
}

// A stale dist/ would leak last build's Node artifacts into extension/.
rmSync(dist, { recursive: true, force: true });
run('build:chrome');

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(dist, path.join(stage, 'extension'), { recursive: true });

run('build:host');
run('build:connect');
copyFileSync(path.join(dist, 'connect.cjs'), path.join(stage, 'connect.cjs'));

writeFileSync(path.join(stage, 'README.txt'), readme());

const archive = `${name}.zip`;
rmSync(path.join(builds, archive), { force: true });
execFileSync('zip', ['-r', '-q', '-X', archive, name, '-x', '*.DS_Store'], {
	cwd: builds,
	stdio: 'inherit',
});

console.log(`\nPackaged → builds/${archive}`);
console.log('Attach it to a release:');
console.log(`  gh release create v${version} builds/${archive}`);
