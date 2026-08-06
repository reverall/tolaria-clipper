// Diagnostics. Turns "it doesn't work" into a single readable report.

import { existsSync, readFileSync } from 'node:fs';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';

import { BRIDGE_PORT, isBridgeReachable } from './bridge';
import { HOST_NAME, DoctorResult } from './protocol';
import { browserTargets, hostInstallDir, hostLauncherPath } from './browsers';
import { isWritableDir } from './fs-ops';
import { loadVaults } from './vaults';

export const HOST_VERSION = '1.7.1';

export async function runDoctor(): Promise<DoctorResult> {
	const warnings: string[] = [];
	const { vaults, vaultsJsonPath: jsonPath } = loadVaults();

	const manifests = browserTargets()
		// Only report browsers that are actually installed, or whose manifest we
		// already wrote — otherwise the report is a wall of irrelevant failures.
		.filter(target => target.manifestDir !== null
			// Default targets whose browser is installed, plus anything we have
			// already written to — anything else is noise.
			&& ((target.supported && existsSync(dirname(target.manifestDir)))
				|| existsSync(join(target.manifestDir, `${HOST_NAME}.json`))))
		.map(target => {
			const manifestPath = join(target.manifestDir as string, `${HOST_NAME}.json`);
			const present = existsSync(manifestPath);

			let allowedOrigins: string[] = [];
			if (present) {
				try {
					const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
					allowedOrigins = parsed.allowed_origins ?? parsed.allowed_extensions ?? [];
				} catch {
					warnings.push(`Manifest for ${target.name} is present but unreadable: ${manifestPath}`);
				}
			}

			return {
				browser: target.name,
				path: manifestPath,
				present,
				writable: isWritableDir(target.manifestDir as string),
				allowedOrigins,
			};
		});

	if (!manifests.some(m => m.present)) {
		warnings.push('No native messaging manifest found. Run: npx tolaria-clipper install-host');
	}

	const launcher = hostLauncherPath();
	if (!existsSync(launcher)) {
		warnings.push(`Host launcher missing at ${launcher}. Run: npx tolaria-clipper install-host`);
	}

	if (vaults.length === 0) {
		warnings.push(
			jsonPath && existsSync(jsonPath)
				? `No vaults listed in ${jsonPath}. Open a vault in Tolaria first.`
				: 'Tolaria vault registry not found. Is Tolaria installed?'
		);
	}

	for (const vault of vaults) {
		if (!vault.exists) {
			warnings.push(`Vault folder is missing: ${vault.label} (${vault.path})`);
		} else if (!isWritableDir(vault.path)) {
			warnings.push(`Vault folder is not writable: ${vault.label} (${vault.path})`);
		}
	}

	return {
		hostVersion: HOST_VERSION,
		hostPath: join(hostInstallDir(), 'host.cjs'),
		nodePath: process.execPath,
		platform: platform(),
		manifests,
		vaultsJson: {
			path: jsonPath,
			present: jsonPath !== null && existsSync(jsonPath),
			readable: jsonPath !== null && existsSync(jsonPath),
			vaultCount: vaults.length,
		},
		vaults: vaults.map(v => ({
			label: v.label,
			path: v.path,
			exists: v.exists,
			writable: v.exists && isWritableDir(v.path),
		})),
		bridge: { port: BRIDGE_PORT, reachable: await isBridgeReachable() },
		warnings,
	};
}

export { formatDoctor } from './doctor-format';
