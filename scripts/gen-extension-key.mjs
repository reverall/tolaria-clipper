// Generates the RSA keypair that pins the Chrome extension ID.
//
// Why this exists: for an unpacked extension Chrome derives the ID from a hash
// of the load directory, so it differs per machine and per checkout. That makes
// it impossible to bake into a native messaging manifest's allowed_origins.
// With a "key" field in manifest.json Chrome derives the ID from the public key
// instead, so the ID becomes a constant everywhere.
//
// Only the public key is committed. The private key is needed solely to build a
// signed .crx and must never be committed.
//
// Usage: node scripts/gen-extension-key.mjs [--write]

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const privateKeyPath = path.join(root, '.keys', 'chrome-extension.pem');
const manifestPath = path.join(root, 'src/manifest.chrome.json');

/**
 * Chrome's extension ID: SHA-256 of the DER public key, first 16 bytes, each
 * hex digit remapped from 0-9a-f to a-p.
 */
export function extensionIdFromDer(der) {
	const digest = createHash('sha256').update(der).digest('hex').slice(0, 32);
	return [...digest].map(c => String.fromCharCode(parseInt(c, 16) + 97)).join('');
}

function loadOrCreateKeyPair() {
	if (existsSync(privateKeyPath)) {
		const privateKey = readFileSync(privateKeyPath, 'utf8');
		const publicDer = createPublicKey(createPrivateKey(privateKey)).export({
			type: 'spki',
			format: 'der',
		});
		return { privateKey, publicDer, reused: true };
	}

	const { privateKey, publicKey } = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
		publicKeyEncoding: { type: 'spki', format: 'der' },
	});

	return { privateKey, publicDer: publicKey, reused: false };
}

const { privateKey, publicDer, reused } = loadOrCreateKeyPair();
const key = Buffer.from(publicDer).toString('base64');
const id = extensionIdFromDer(publicDer);

if (!reused) {
	mkdirSync(path.dirname(privateKeyPath), { recursive: true });
	writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
	console.log(`Private key written to ${privateKeyPath} (gitignored — do not commit)`);
}

console.log(`\nExtension ID: ${id}`);
console.log(`\nmanifest "key":\n${key}\n`);

if (process.argv.includes('--write')) {
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	manifest.key = key;
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	console.log(`Wrote "key" into ${path.relative(root, manifestPath)}`);
} else {
	console.log('Re-run with --write to patch it into src/manifest.chrome.json');
}
