// Author: Preston Lee

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { extractCqlLibraryNameAndVersion } from './cql-library-metadata.js';
import type { Bundle, AuditEvent } from './types/fhir-types.js';

type ResetDriver = 'hapi' | 'wildfhir';

const VALID_STACK_DRIVERS = ['generic', 'hapi', 'wildfhir', 'fhircandle'];
const VALID_STACK_LOADERS = ['fhir-bundle', 'cql-as-fhir-library'];

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
	/** After POSTing an import AuditEvent, search may lag; direct GET this URL until search finds matches. */
	private lastImportAuditEventDirectReadUrl: string | null = null;
	private loggedSearchLagHint: boolean = false;
	private loggedStackWarningKeys = new Set<string>();

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

	private normalizeFhirBaseUrl(fhirBaseUrl: string): string {
		return fhirBaseUrl.replace(/\/*$/, '');
	}

	cqlEvaluateUrlFor(fhirBaseUrl: string, libraryId: string): string {
		const base = this.normalizeFhirBaseUrl(fhirBaseUrl);
		return `${base}/Library/${encodeURIComponent(libraryId)}/$evaluate`;
	}

	buildEvaluateParameters(subject: string): any {
		return {
			resourceType: 'Parameters',
			parameter: [
				{
					name: 'subject',
					valueString: subject,
				},
			],
		};
	}

	async evaluateCqlLibrary(fhirBaseUrl: string, libraryId: string, subject: string): Promise<any> {
		const url = this.cqlEvaluateUrlFor(fhirBaseUrl, libraryId);
		const parameters = this.buildEvaluateParameters(subject);
		const response = await axios.post(url, parameters, {
			headers: {
				'Content-Type': 'application/fhir+json',
				Accept: 'application/fhir+json',
			},
		});
		return response.data;
	}

	normalizeResetDriver(driver: string): ResetDriver {
		const normalized = driver.trim().toLowerCase().replace(/_/g, '-');
		switch (normalized) {
			case 'hapi':
			case 'hapi-fhir':
				return 'hapi';
			case 'wildfhir':
			case 'wild-fhir':
				return 'wildfhir';
			default:
				throw new Error(`Unsupported reset driver "${driver}". Use hapi-fhir or wild-fhir.`);
		}
	}

	resetServerUrlFor(fhirBaseUrl: string, driver: string): string {
		const base = this.normalizeFhirBaseUrl(fhirBaseUrl);
		switch (this.normalizeResetDriver(driver)) {
			case 'hapi':
				return `${base}/$expunge`;
			case 'wildfhir':
				return `${base}/$purge-all`;
		}
	}

	resetServerPayloadFor(driver: string): any {
		switch (this.normalizeResetDriver(driver)) {
			case 'hapi':
				return {
					resourceType: 'Parameters',
					parameter: [
						{
							name: 'expungeEverything',
							valueBoolean: true,
						},
					],
				};
			case 'wildfhir':
				return {};
		}
	}

	async resetServerData(fhirBaseUrl: string, driver: string): Promise<any> {
		const url = this.resetServerUrlFor(fhirBaseUrl, driver);
		const payload = this.resetServerPayloadFor(driver);
		if (this.dryRun) {
			return {
				dryRun: true,
				method: 'POST',
				url,
				payload,
			};
		}
		const response = await axios.post(url, payload, {
			headers: {
				'Content-Type': 'application/fhir+json',
				Accept: 'application/fhir+json',
			},
		});
		return response.data;
	}

	private rememberPostedImportAuditEventUrl(fhirBaseUrl: string, response: { headers?: any; data?: AuditEvent }): void {
		const base = this.normalizeFhirBaseUrl(fhirBaseUrl);
		const rawLoc = response.headers?.location;
		const loc = Array.isArray(rawLoc) ? rawLoc[0] : rawLoc;
		if (typeof loc === 'string' && loc.length > 0) {
			try {
				this.lastImportAuditEventDirectReadUrl = new URL(loc, `${base}/`).href;
				return;
			} catch {
				// fall through to id-based URL
			}
		}
		const id = response.data?.id;
		if (typeof id === 'string' && id.length > 0) {
			this.lastImportAuditEventDirectReadUrl = `${base}/AuditEvent/${id}`;
		}
	}

	/** True if the AuditEvent still exists at the URL we got from the last successful POST (bypasses search index lag). */
	private async importAuditEventDirectReadOk(readUrl: string): Promise<boolean> {
		try {
			const r = await axios.get(readUrl, {
				headers: { Accept: 'application/fhir+json', 'Cache-Control': 'no-cache' },
				validateStatus: () => true,
			});
			return r.status === 200 && r.data?.resourceType === 'AuditEvent';
		} catch {
			return false;
		}
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

	getStackConfigurationWarnings(config: any): string[] {
		const warnings: string[] = [];
		const warn = (message: string) => warnings.push(message);

		if (!config.fhir_base_url || typeof config.fhir_base_url !== 'string') {
			warn('FHIR Base URL is missing or invalid.');
		} else if (!config.fhir_base_url.match(/^https?:\/\/.+/)) {
			warn('FHIR Base URL may be invalid; expected HTTP or HTTPS URL.');
		}

		if (!config.driver || !VALID_STACK_DRIVERS.includes(config.driver)) {
			warn(`Driver "${config.driver || '(empty)'}" is not recognized; falling back to generic.`);
		}

		if (!config.data || !Array.isArray(config.data)) {
			warn('No data files configured.');
		} else {
			const priorities = new Map<number, number[]>();
			const scenarioIds = new Set([
				'default',
				...((Array.isArray(config.scenarios) ? config.scenarios : [])
					.map((scenario: any) => scenario?.id)
					.filter((id: unknown) => typeof id === 'string') as string[]),
			]);

			config.data.forEach((file: any, index: number) => {
				const fileNum = index + 1;

				if (!file.file || String(file.file).trim() === '') {
					warn(`Data file ${fileNum}: File path is empty.`);
				}
				if (!file.name || String(file.name).trim() === '') {
					warn(`Data file ${fileNum}: Name is empty.`);
				}
				if (file.loader && !VALID_STACK_LOADERS.includes(file.loader)) {
					warn(`Data file ${fileNum}: Loader "${file.loader}" is not recognized.`);
				}
				if (file.loader === 'cql-as-fhir-library' && (!file.evaluate || !file.evaluate.id)) {
					warn(`Data file ${fileNum} (${file.name || 'CQL'}) of type cql-as-fhir-library has no evaluation ID; CQL $evaluate will not be available.`);
				}
				if (typeof file.priority === 'number' && file.priority < 0) {
					warn(`Data file ${fileNum}: Priority is negative (${file.priority}).`);
				}

				const prio = typeof file.priority === 'number' ? file.priority : 0;
				if (!priorities.has(prio)) priorities.set(prio, []);
				priorities.get(prio)!.push(fileNum);

				(file.scenarios || []).forEach((scenarioId: string) => {
					if (scenarioIds.size > 0 && !scenarioIds.has(scenarioId)) {
						warn(`Data file ${fileNum}: Scenario "${scenarioId}" is not defined in scenarios.`);
					}
				});
			});

			priorities.forEach((indices, prio) => {
				if (indices.length > 1) {
					warn(`Multiple data files share priority ${prio} (files ${indices.join(', ')}); load order may be ambiguous.`);
				}
			});
		}

		(config.links || []).forEach((link: any, index: number) => {
			if (!link.url || !String(link.url).match(/^https?:\/\/.+/)) {
				warn(`Link ${index + 1} "${link.name || '(unnamed)'}": URL is missing or invalid.`);
			}
		});

		return warnings;
	}

	logStackConfigurationWarnings(config: any, warningKey?: string): string[] {
		const warnings = this.getStackConfigurationWarnings(config);
		if (warningKey && this.loggedStackWarningKeys.has(warningKey)) {
			return warnings;
		}
		if (warningKey) {
			this.loggedStackWarningKeys.add(warningKey);
		}
		warnings.forEach(message => console.warn('[Stack Config]', message));
		return warnings;
	}

	/**
	 * When the manifest declares scenarios, ensure the given id exists in scenarios[].id.
	 * The browser app always provides a synthetic "default" scenario.
	 */
	ensureScenarioValid(stack: any, scenarioId?: string): void {
		const sid = scenarioId?.trim();
		if (!sid) {
			return;
		}
		if (sid === 'default') {
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
			// Backwards compatibility: existing CLI usage without --scenario imports every load=true row.
			return true;
		}
		const row = item?.scenarios;
		if (sid === 'default') {
			return !Array.isArray(row) || row.length === 0 || row.includes('default');
		}
		return Array.isArray(row) && row.includes(sid);
	}

	selectDataFilesForImport(stack: any, scenarioId?: string): any[] {
		const loadTrue = (stack.data || []).filter((item: any) => item.load);
		return loadTrue
			.filter((item: any) => this.dataRowMatchesScenario(item, scenarioId))
			.sort((a: any, b: any) => (a.priority ?? 0) - (b.priority ?? 0));
	}

	legacyCqlLibraryIdFor(item: any, filePath: string): string {
		return (item.name || filePath).replace(/[^A-Za-z0-9]/g, '');
	}

	buildCqlLibraryResource(
		libraryId: string,
		version: string,
		description: string,
		cqlContent: string,
		fhirBaseUrl: string
	): any {
		return {
			resourceType: 'Library',
			type: {},
			id: libraryId,
			version,
			name: libraryId,
			title: libraryId,
			status: 'active',
			description,
			url: `${fhirBaseUrl}/Library/${libraryId}`,
			content: [
				{
					contentType: 'text/cql',
					data: Buffer.from(cqlContent, 'utf8').toString('base64'),
				},
			],
		};
	}

	private async putCqlLibraryResource(
		fhirBaseUrl: string,
		libraryId: string,
		libraryResource: any,
		itemName: string,
		filePath: string,
		label: string = 'Imported'
	): Promise<void> {
		if (this.dryRun) {
			console.log(`[DRY RUN] Would PUT Library "${itemName}" (${filePath}) to ${fhirBaseUrl}/Library/${libraryId}`);
			return;
		}
		try {
			const postResp = await axios.put(`${fhirBaseUrl}/Library/${libraryId}`, libraryResource, {
				headers: {
					'Content-Type': 'application/fhir+json',
					Accept: 'application/fhir+json',
				},
			});
			console.info(`[SUCCESS] ${label} Library "${itemName}" (${filePath}) to ${fhirBaseUrl}/Library/${libraryId}: ${postResp.status} ${postResp.statusText}`);
		} catch (err: any) {
			console.error(`[FAILURE] Importing Library "${itemName}" (${filePath}) to ${fhirBaseUrl}/Library/${libraryId}:`, err?.response?.status, err?.response?.statusText);
			if (err?.response?.data) {
				console.error(JSON.stringify(err.response.data, null, 2));
			}
			throw err;
		}
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
				const response = await axios.get<Bundle>(url, {
					headers: { Accept: 'application/fhir+json', 'Cache-Control': 'no-cache' },
				});
				const bundle = response.data;
				const now = new Date().toISOString();
				let searchHas = this.auditEventSearchHasMatches(bundle);
				let directHas = false;
				if (!searchHas && this.lastImportAuditEventDirectReadUrl) {
					directHas = await this.importAuditEventDirectReadOk(this.lastImportAuditEventDirectReadUrl);
					if (!directHas) {
						this.lastImportAuditEventDirectReadUrl = null;
					}
				}
				const hasMarker = searchHas || directHas;
				if (hasMarker) {
					if (searchHas) {
						this.loggedSearchLagHint = false;
						this.lastImportAuditEventDirectReadUrl = null;
						const n =
							typeof bundle.total === 'number' && bundle.total > 0
								? bundle.total
								: bundle.entry?.length ?? 0;
						console.info(`${now}: Found matching AuditEvent resources (count ${n}). No import needed.`);
					} else {
						if (this.verbose) {
							console.debug(
								`${now}: Type search has not indexed the import AuditEvent yet; direct read confirms it exists. No import needed.`
							);
						} else if (!this.loggedSearchLagHint) {
							console.info(
								`${now}: Import AuditEvent is not visible in type search yet (index lag); confirmed by direct read. Skipping duplicate import until search catches up.`
							);
							this.loggedSearchLagHint = true;
						}
					}
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
				if (exitAfterFirstCycle) {
					throw error;
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
		this.logStackConfigurationWarnings(stack, manifestRef);
		this.ensureScenarioValid(stack, scenarioId);

		const resolvedManifestLocalPath = this.isRemoteHttpManifest(manifestRef)
			? null
			: this.resolveManifestLocalPath(manifestRef);

		const loadTrue = (stack.data || []).filter((item: any) => item.load);
		const dataFiles = this.selectDataFilesForImport(stack, scenarioId);
		if (scenarioId?.trim()) {
			console.info(
				`Scenario "${scenarioId.trim()}": importing ${dataFiles.length} of ${loadTrue.length} manifest rows with load=true (by priority).`
			);
		}

		for (const item of dataFiles) {
			const filePath = item.file;
			if (typeof filePath !== 'string' || !filePath.trim()) {
				throw new Error(`Manifest row "${item.name ?? '(no name)'}" has no file path.`);
			}
			let resourceData: any;

			try {
				resourceData = await this.readItemFileContent(manifestRef, resolvedManifestLocalPath, filePath);
			} catch (e: any) {
				throw new Error(`Could not read data file for "${item.name}" (${filePath}): ${e?.message ?? e}`);
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
						throw err;
					}
				}
			} else if (item.loader === 'cql-as-fhir-library') {
				const cqlContent = typeof resourceData === 'string' ? resourceData : JSON.stringify(resourceData);
				const cqlInfo = extractCqlLibraryNameAndVersion(cqlContent);
				if (!cqlInfo) {
					throw new Error(
						`Could not determine CQL library name and version from "${filePath}". ` +
							`CQL files must declare \`library <name> version '<version>'\`. Import aborted.`
					);
				}

				const legacyLibraryId = this.legacyCqlLibraryIdFor(item, filePath);
				const description = item.description || 'CQL Library loaded from file: ' + filePath;

				const browserLibraryResource = this.buildCqlLibraryResource(
					cqlInfo.libraryName,
					cqlInfo.version,
					description,
					cqlContent,
					fhirBaseUrl
				);
				await this.putCqlLibraryResource(
					fhirBaseUrl,
					cqlInfo.libraryName,
					browserLibraryResource,
					item.name,
					filePath
				);

				if (legacyLibraryId && legacyLibraryId !== cqlInfo.libraryName) {
					const legacyResource = this.buildCqlLibraryResource(
						legacyLibraryId,
						cqlInfo.version,
						description,
						cqlContent,
						fhirBaseUrl
					);
					await this.putCqlLibraryResource(
						fhirBaseUrl,
						legacyLibraryId,
						legacyResource,
						item.name,
						filePath,
						'Imported compatibility alias for'
					);
				}
			} else {
				throw new Error(`Loader "${item.loader}" not supported for "${item.name}" (${filePath})`);
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
		const postUrl = `${this.normalizeFhirBaseUrl(fhirBaseUrl)}/AuditEvent`;
		try {
			const response = await axios.post<AuditEvent>(postUrl, ae, {
				headers: {
					'Content-Type': 'application/fhir+json',
					Accept: 'application/fhir+json',
				},
			});
			const id = response.data?.id;
			this.rememberPostedImportAuditEventUrl(fhirBaseUrl, response);
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
