import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Unlike the CLI build, the host touches no DOM: it only reads and writes
// files. So there is no linkedom external and no DOMParser polyfill banner,
// which keeps the bundle small and cold start fast — it is spawned per clip.
await esbuild.build({
	entryPoints: [path.join(root, 'src/native-host/host.ts')],
	bundle: true,
	platform: 'node',
	target: 'node18',
	format: 'cjs',
	outfile: path.join(root, 'dist/native-host.cjs'),
	define: {
		'DEBUG_MODE': 'false',
	},
	logLevel: 'info',
});

console.log('Native host built successfully → dist/native-host.cjs');
