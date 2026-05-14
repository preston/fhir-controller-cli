// Author: Preston Lee

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import type { Bundle, AuditEvent } from 'fhir/r4';

function resolveUserFilePath(input: string): string {
	const trimmed = input.trim();
	if (trimmed.startsWith('~/')) {
		return path.join(os.homedir(), trimmed.slice(2));
	}
	if (trimmed === '~') {
		return os.homedir();
	}
	if (path.isAbsolute(trimmed)) {
		return trimmed;
	}
	return path.join(process.cwd(), trimmed);
}

export class ImportUtilities {
	private dryRun: boolean = false;
	private verbose: boolean = false;
	private isCancelled: boolean = false;

	constructor(dryRun: boolean = false, debug: boolean = false) {
		this.dryRun = dryRun;
		this.verbose = debug;
	}

	cancel() {
		this.isCancelled = true;
	}

	/** True if this search bundle indicates at least one matching AuditEvent (HAPI often omits `total` but includes `entry`). */
	private auditEventSearchHasMatches(bundle: Bundle): boolean {
		if (typeof bundle.total === 'number' && bundle.total > 0) {
			return true;
		}
		return Array.isArray(bundle.entry) && bundle.entry.length > 0;
	}

	/** FHIR token search `type=system|code` with correct query encoding. */
	private buildAuditEventSearchUrl(fhirBaseUrl: string, auditEventSystem: string, auditEventCode: string): string {
		const base = fhirBaseUrl.replace(/\/*$/, '');
		const url = new URL('AuditEvent', `${base}/`);
		url.searchParams.set('type', `${auditEventSystem}|${auditEventCode}`);
		return url.href;
	}

	private isRemoteHttpManifest(ref: string): boolean {
		return /^https?:\/\//i.test(ref.trim());
	}

	private isHttpItemRef(ref: string): boolean {
		return /^https?:\/\//i.test(ref.trim());
	}

	private isFileUrlRef(ref: string): boolean {
		return /^file:\/\//i.test(ref.trim());
	}

	private resolveManifestLocalPath(stackRef: string): string {
		const t = stackRef.trim();
		if (this.isFileUrlRef(t)) {
			return fileURLToPath(new URL(t));
		}
		return resolveUserFilePath(t);
	}

	/**
	 * Load stack.json from an HTTP(S) URL or local filesystem path (or file:// URL).
	 */
	async loadManifest(stackRef: string): Promise<any> {
		const trimmed = stackRef.trim();
		if (this.isRemoteHttpManifest(trimmed)) {
			try {
				const response = await axios.get(trimmed);
				if (response.status !== 200) {
					throw new Error(`Manifest HTTP request failed with status ${response.status}`);
				}
				return response.data;
			} catch (e: any) {
				const msg = e?.message ?? String(e);
				throw new Error(`Failed to load manifest from URL ${trimmed}: ${msg}`);
			}
		}
		const localPath = this.resolveManifestLocalPath(trimmed);
		let raw: string;
		try {
			raw = await fs.promises.readFile(localPath, 'utf8');
		} catch (e: any) {
			const msg = e?.message ?? String(e);
			throw new Error(`Failed to read manifest file (resolved path: ${localPath}): ${msg}`);
		}
		try {
			return JSON.parse(raw);
		} catch (e: any) {
			const msg = e?.message ?? String(e);
			throw new Error(`Invalid JSON in manifest ${localPath}: ${msg}`);
		}
	}

	/**
	 * When the manifest declares scenarios, ensure the given id exists in scenarios[].id.
	 */
	ensureScenarioValid(stack: any, scenarioId?: string): void {
		const sid = scenarioId?.trim();
		if (!sid) {
			return;
		}
		const scenarios = stack?.scenarios;
		if (!Array.isArray(scenarios) || scenarios.length === 0) {
			return;
		}
		const known = scenarios.map((s: any) => s?.id).filter((id: unknown) => typeof id === 'string');
		if (!known.includes(sid)) {
			throw new Error(
				`Unknown scenario id "${sid}". Valid ids from manifest: ${known.length ? known.join(', ') : '(none)'}`
			);
		}
	}

	private dataRowMatchesScenario(item: any, scenarioId?: string): boolean {
		const sid = scenarioId?.trim();
		if (!sid) {
			return true;
		}
		const row = item?.scenarios;
		if (!Array.isArray(row) || row.length === 0) {
			return true;
		}
		return row.includes(sid);
	}

	private async readItemFileContent(
		manifestRef: string,
		resolvedManifestLocalPath: string | null,
		itemFile: string
	): Promise<any> {
		const fileRef = itemFile.trim();
		if (this.isHttpItemRef(fileRef)) {
			const fileResp = await axios.get(fileRef);
			return fileResp.data;
		}
		if (this.isFileUrlRef(fileRef)) {
			const p = fileURLToPath(new URL(fileRef));
			const text = await fs.promises.readFile(p, 'utf8');
			return text;
		}
		const remote = this.isRemoteHttpManifest(manifestRef.trim());
		if (remote) {
			const fileUrl = new URL(fileRef, manifestRef.trim()).href;
			const fileResp = await axios.get(fileUrl);
			return fileResp.data;
		}
		const baseDir = path.dirname(resolvedManifestLocalPath!);
		const resolvedItemPath = path.isAbsolute(fileRef)
			? fileRef
			: path.join(baseDir, fileRef);
		return fs.promises.readFile(resolvedItemPath, 'utf8');
	}

	async pollAndImportIndefinitely(
		stackJsonUrl: string,
		fhirBaseUrl: string,
		auditEventSystem: string,
		auditEventCode: string,
		pollInterval: string,
		scenarioId?: string,
		exitAfterFirstCycle?: boolean
	): Promise<void> {
		while (!this.isCancelled) {
			try {
				const url = this.buildAuditEventSearchUrl(fhirBaseUrl, auditEventSystem, auditEventCode);
				if (this.verbose) {
					console.debug(`AuditEvent poll GET ${url}`);
				}
				const response = await axios.get<Bundle>(url);
				const bundle = response.data;
				const now = new Date().toISOString();
				if (this.auditEventSearchHasMatches(bundle)) {
					const n =
						typeof bundle.total === 'number' && bundle.total > 0
							? bundle.total
							: bundle.entry?.length ?? 0;
					console.info(`${now}: Found matching AuditEvent resources (count ${n}). No import needed.`);
				} else {
					console.info(`${now}: No matching AuditEvent resources. Triggering import.`);
					await this.triggerImport(stackJsonUrl, fhirBaseUrl, auditEventSystem, auditEventCode, scenarioId);
				}
			} catch (error: any) {
				console.error('Error polling FHIR server.');
				if (error?.message) {
					console.error(error.message);
				}
				if (this.verbose && error?.cause) {
					console.error(error.cause);
				}
			}

			if (this.isCancelled) {
				console.info('Polling cancelled. Exiting...');
				break;
			}

			if (exitAfterFirstCycle) {
				console.info('Single poll cycle (--exit): finished. Exiting.');
				break;
			}

			const intervalMs = Number(pollInterval) * 1000;
			await new Promise(resolve => setTimeout(resolve, intervalMs));
		}
	}

	async triggerImport(
		stackJsonUrl: string,
		fhirBaseUrl: string,
		auditEventSystem: string,
		auditEventCode: string,
		scenarioId?: string
	): Promise<any> {
		const manifestRef = stackJsonUrl.trim();
		const stack = await this.loadManifest(manifestRef);
		this.ensureScenarioValid(stack, scenarioId);

		const resolvedManifestLocalPath = this.isRemoteHttpManifest(manifestRef)
			? null
			: this.resolveManifestLocalPath(manifestRef);

		const loadTrue = (stack.data || []).filter((item: any) => item.load);
		const afterScenario = loadTrue.filter((item: any) => this.dataRowMatchesScenario(item, scenarioId));
		if (scenarioId?.trim()) {
			console.info(
				`Scenario "${scenarioId.trim()}": importing ${afterScenario.length} of ${loadTrue.length} manifest rows with load=true (by priority).`
			);
		}
		const dataFiles = afterScenario.sort((a: any, b: any) => (a.priority ?? 0) - (b.priority ?? 0));

		for (const item of dataFiles) {
			const filePath = item.file;
			if (typeof filePath !== 'string' || !filePath.trim()) {
				console.warn(`[SKIP] Manifest row "${item.name ?? '(no name)'}" has no file path.`);
				continue;
			}
			let resourceData: any;

			try {
				resourceData = await this.readItemFileContent(manifestRef, resolvedManifestLocalPath, filePath);
			} catch (e: any) {
				console.error(`[FAILURE] Could not read data file for "${item.name}" (${filePath}):`, e?.message ?? e);
				continue;
			}
			if (typeof resourceData === 'object') {
				resourceData = JSON.stringify(resourceData);
			}

			if (item.loader === 'fhir-bundle') {
				const bundle = typeof resourceData === 'string' ? JSON.parse(resourceData) : resourceData;
				if (this.dryRun) {
					console.log(`[DRY RUN] Would POST bundle "${item.name}" (${filePath}) to ${fhirBaseUrl}`);
				} else {
					try {
						const postResp = await axios.post(`${fhirBaseUrl}`, bundle, {
							headers: {
								'Content-Type': 'application/fhir+json',
								Accept: 'application/fhir+json',
							},
						});
						console.info(`[SUCCESS] Imported "${item.name}" (${filePath}) to ${fhirBaseUrl}: ${postResp.status} ${postResp.statusText}`);
					} catch (err: any) {
						console.error(`[FAILURE] Importing "${item.name}" (${filePath}) to ${fhirBaseUrl}:`, err?.response?.status, err?.response?.statusText);
						if (err?.response?.data) {
							console.error(JSON.stringify(err.response.data, null, 2));
						}
					}
				}
			} else if (item.loader === 'cql-as-fhir-library') {
				const cqlContent = typeof resourceData === 'string' ? resourceData : JSON.stringify(resourceData);
				const libraryId = (item.name || filePath).replace(/[^A-Za-z0-9]/g, '');
				const libraryResource = {
					resourceType: 'Library',
					type: {},
					id: libraryId,
					version: item.version || '0.0.0',
					name: libraryId,
					title: libraryId,
					status: 'active',
					description: item.description || '',
					url: fhirBaseUrl + '/Library/' + libraryId,
					content: [
						{
							contentType: 'text/cql',
							data: Buffer.from(cqlContent, 'utf8').toString('base64'),
						},
					],
				};
				if (this.dryRun) {
					console.log(`[DRY RUN] Would PUT Library "${item.name}" (${filePath}) to ${fhirBaseUrl}/Library`);
				} else {
					try {
						const postResp = await axios.put(`${fhirBaseUrl}/Library/${libraryId}`, libraryResource, {
							headers: {
								'Content-Type': 'application/fhir+json',
								Accept: 'application/fhir+json',
							},
						});
						console.info(`[SUCCESS] Imported Library "${item.name}" (${filePath}) to ${fhirBaseUrl}/Library: ${postResp.status} ${postResp.statusText}`);
					} catch (err: any) {
						console.error(`[FAILURE] Importing Library "${item.name}" (${filePath}) to ${fhirBaseUrl}/Library:`, err?.response?.status, err?.response?.statusText);
						if (err?.response?.data) {
							console.error(JSON.stringify(err.response.data, null, 2));
						}
					}
				}
			} else {
				console.warn(`[SKIP] Loader "${item.loader}" not supported for "${item.name}" (${filePath})`);
			}
		}
		console.info(`[SUCCESS] Imported ${dataFiles.length} resources to ${fhirBaseUrl}`);
		const ae = await this.createImportAuditEvent(fhirBaseUrl, auditEventSystem, auditEventCode);
		return ae;
	}

	async createImportAuditEvent(fhirBaseUrl: string, auditEventSystem: string, auditEventCode: string) {
		// R4 requires agent 1..*, agent.requestor 1..1, and source.observer 1..1 (Reference needs at least one of reference|identifier|display).
		const ae: AuditEvent = {
			resourceType: 'AuditEvent',
			type: {
				system: auditEventSystem,
				code: auditEventCode,
				display: 'Data has been imported into the system.',
			},
			recorded: new Date().toISOString(),
			agent: [
				{
					requestor: false,
					who: { display: 'FHIR Controller CLI' },
				},
			],
			source: {
				observer: { display: 'FHIR Controller CLI' },
			},
		};
		if (this.dryRun) {
			console.log(`[DRY RUN] Would POST AuditEvent to ${fhirBaseUrl}/AuditEvent`);
			return ae;
		}
		const postUrl = `${fhirBaseUrl.replace(/\/*$/, '')}/AuditEvent`;
		try {
			const response = await axios.post<AuditEvent>(postUrl, ae, {
				headers: {
					'Content-Type': 'application/fhir+json',
					Accept: 'application/fhir+json',
				},
			});
			const id = response.data?.id;
			console.info(
				`[SUCCESS] Posted import AuditEvent to ${postUrl}${id != null ? ` (id: ${id})` : ''}: ${response.status} ${response.statusText}`
			);
			return response.data;
		} catch (err: any) {
			console.error(
				`[FAILURE] Could not POST import AuditEvent to ${postUrl}:`,
				err?.response?.status,
				err?.response?.statusText
			);
			if (err?.response?.data) {
				console.error(JSON.stringify(err.response.data, null, 2));
			} else if (err?.message) {
				console.error(err.message);
			}
			throw err;
		}
	}
}
