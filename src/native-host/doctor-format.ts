// Rendering for a DoctorResult.
//
// Kept apart from doctor.ts, which collects the report using node APIs: the
// settings page renders diagnostics too, and must not pull node:fs into the
// browser bundle.

import { DoctorResult } from './protocol';

export function formatDoctor(report: DoctorResult): string {
	const lines: string[] = [];
	const mark = (ok: boolean) => (ok ? 'ok' : 'FAIL');

	lines.push(`tolaria-clipper host ${report.hostVersion} (${report.platform})`);
	lines.push(`  node:    ${report.nodePath}`);
	lines.push(`  host:    ${report.hostPath}`);
	lines.push('');

	lines.push('Native messaging manifests');
	if (report.manifests.length === 0) {
		lines.push('  (no supported browser directories found)');
	}
	for (const manifest of report.manifests) {
		lines.push(`  [${mark(manifest.present)}] ${manifest.browser}`);
		lines.push(`         ${manifest.path}`);
		if (manifest.present && manifest.allowedOrigins.length > 0) {
			lines.push(`         allowed: ${manifest.allowedOrigins.join(', ')}`);
		}
	}
	lines.push('');

	lines.push(`Vault registry: ${report.vaultsJson.path ?? '(not found)'}`);
	if (report.vaults.length === 0) {
		lines.push('  (no vaults)');
	}
	for (const vault of report.vaults) {
		const state = !vault.exists ? 'missing' : vault.writable ? 'writable' : 'read-only';
		lines.push(`  [${mark(vault.exists && vault.writable)}] ${vault.label} — ${vault.path} (${state})`);
	}
	lines.push('');

	lines.push(
		`Tolaria tool bridge on ${report.bridge.port}: ${report.bridge.reachable ? 'reachable' : 'not running'}`
	);
	lines.push('  Only needed for the optional refresh nudge; the file watcher works without it.');

	if (report.warnings.length > 0) {
		lines.push('');
		lines.push('Warnings');
		for (const warning of report.warnings) lines.push(`  - ${warning}`);
	}

	return lines.join('\n');
}
