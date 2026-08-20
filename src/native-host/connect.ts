// The one file the downloadable archive asks you to run.
//
// Chrome wants an absolute path in the native messaging manifest, and the
// launcher wants an absolute path to Node — neither can be known before the
// archive lands on a machine, so nothing here can be shipped pre-written.
// Running this once is what fills them in.
//
// The host bundle travels inside this file as a string, injected at build time
// by scripts/build-connect.mjs, so the archive holds one thing to run rather
// than two files that must stay side by side.
//
// It deliberately does not install the extension: where that folder lives is
// the reader's choice, and Load unpacked is theirs to do.

import { mkdtempSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { formatDoctor, runDoctor } from './doctor';
import { installHost, parseInstallArgs, uninstallHost } from './installer';

/** The built native host, inlined by esbuild. Same trick as DEBUG_MODE. */
declare const HOST_BUNDLE: string;

function printUsage(): void {
	console.log(`
Usage: node connect.cjs [command] [options]

Commands:
  connect       Register the native host with your browsers (default)
  disconnect    Remove it again
  doctor        Report on the host, the browser manifests and your vaults

Options:
  --dry-run                Print what would be written, without writing
  --browsers=chrome,arc    Restrict to, or opt into, specific browsers
  --extension-id <id>      Allow an extra extension id
  -h, --help               Show this message
`.trim());
}

/** Materialise the embedded host so installHost can copy it like any bundle. */
function stageHostBundle(): string {
	const path = join(mkdtempSync(join(tmpdir(), 'tolaria-clipper-')), 'native-host.cjs');
	writeFileSync(path, HOST_BUNDLE);
	return path;
}

/**
 * The extension ships next to this file in the archive, so point at it by name
 * rather than making the reader work out what to load.
 */
function reportExtensionPath(): void {
	const extension = join(__dirname, 'extension');
	if (!existsSync(join(extension, 'manifest.json'))) return;

	console.log('');
	console.log('If you have not loaded the extension yet: open chrome://extensions');
	console.log('(arc://extensions), enable Developer mode, and "Load unpacked" on:');
	console.log(`  ${extension}`);
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);

	if (argv.includes('-h') || argv.includes('--help')) {
		printUsage();
		return;
	}

	// A bare `node connect.cjs`, or one carrying only flags, means connect.
	const named = argv[0] && !argv[0].startsWith('-');
	const command = named ? argv[0] : 'connect';
	const options = parseInstallArgs(named ? argv.slice(1) : argv);

	switch (command) {
		case 'connect':
			installHost({ ...options, hostBundle: stageHostBundle() });
			if (!options.dryRun) reportExtensionPath();
			return;
		case 'disconnect':
			uninstallHost(options);
			return;
		case 'doctor':
			console.log(formatDoctor(await runDoctor()));
			return;
		default:
			console.error(`Unknown command: ${command}`);
			console.error('');
			printUsage();
			process.exit(1);
	}
}

main().catch(error => {
	console.error((error as Error).message || error);
	process.exit(1);
});
