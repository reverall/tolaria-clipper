import * as esbuild from 'esbuild';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const hostBundle = path.join(root, 'dist/native-host.cjs');
if (!existsSync(hostBundle)) {
	console.error(`Host bundle not found: ${hostBundle}\nRun "npm run build:host" first.`);
	process.exit(1);
}

// The host is inlined as a string rather than shipped as a second file, so the
// archive has exactly one thing to run. Unlike the CLI build this needs no
// externals: installer.ts and doctor.ts only reach for node: modules, which is
// what lets the connector work outside a checkout.
await esbuild.build({
	entryPoints: [path.join(root, 'src/native-host/connect.ts')],
	bundle: true,
	platform: 'node',
	target: 'node18',
	format: 'cjs',
	outfile: path.join(root, 'dist/connect.cjs'),
	banner: {
		js: '#!/usr/bin/env node',
	},
	define: {
		'DEBUG_MODE': 'false',
		'HOST_BUNDLE': JSON.stringify(readFileSync(hostBundle, 'utf-8')),
	},
	logLevel: 'info',
});

console.log('Connector built successfully → dist/connect.cjs');
