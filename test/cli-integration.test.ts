import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile, type ExecFileException } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import axios from 'axios';

const projectRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(projectRoot, 'build/bin/fhir-controller.js');
const defaultFhirBaseUrl = 'http://127.0.0.1:8080/fhir/';
const fhirBaseUrl = normalizeFhirBaseUrl(process.env.FHIR_CONTROLLER_TEST_FHIR_URL ?? defaultFhirBaseUrl);
const skipLiveTests = /^(1|true|yes)$/i.test(process.env.FHIR_CONTROLLER_SKIP_LIVE_TESTS ?? '');
const syntheaFixtureDir = path.join(projectRoot, 'test/data/example/fhir');
const manifestFixturePath = path.join(projectRoot, 'test/data/example/stack.json');
const tempDirs: string[] = [];

afterAll(() => {
	for (const dir of tempDirs) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe('CLI fixture smoke tests', () => {
	beforeAll(() => {
		expect(fs.existsSync(cliPath)).toBe(true);
	});

	test('synthea-upload dry run reads fixture bundles in dependency order', async () => {
		const result = await runCli(['synthea-upload', syntheaFixtureDir, fhirBaseUrl, '--dry-run']);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('Dry run enabled. No resources will be uploaded.');
		expect(result.stdout).toContain('Dry run: Would have uploaded hospitalInformation');
		expect(result.stdout).toContain('Dry run: Would have uploaded practitionerInformation');
		expect(result.stdout).toContain('Dry run: Would have uploaded patient-test.json');
		expect(result.stdout).toContain('Done');
		expect(result.stdout.indexOf('hospitalInformation')).toBeLessThan(result.stdout.indexOf('practitionerInformation'));
		expect(result.stdout.indexOf('practitionerInformation')).toBeLessThan(result.stdout.indexOf('patient-test.json'));

		const uploadedFiles = result.stdout
			.split('\n')
			.filter(line => line.startsWith('Dry run: Would have uploaded '))
			.map(line => line.replace('Dry run: Would have uploaded ', '').trim());
		const firstPractitionerIndex = uploadedFiles.findIndex(file => file.startsWith('practitionerInformation'));
		const firstPatientIndex = uploadedFiles.findIndex(file => file.startsWith('patient'));
		const lastHospitalIndex = lastIndexWhere(uploadedFiles, file => file.startsWith('hospitalInformation'));
		const lastPractitionerIndex = lastIndexWhere(uploadedFiles, file => file.startsWith('practitionerInformation'));

		expect(firstPractitionerIndex).toBeGreaterThan(-1);
		expect(firstPatientIndex).toBeGreaterThan(-1);
		expect(lastHospitalIndex).toBeLessThan(firstPractitionerIndex);
		expect(lastPractitionerIndex).toBeLessThan(firstPatientIndex);
	});

	test('server reset dry run renders the target request without calling the server', async () => {
		const result = await runCli(['server', 'reset', fhirBaseUrl, '--driver', 'hapi-fhir', '--dry-run']);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(JSON.parse(result.stdout)).toEqual({
			dryRun: true,
			method: 'POST',
			url: `${fhirBaseUrl.replace(/\/*$/, '')}/$expunge`,
			payload: {
				resourceType: 'Parameters',
				parameter: [
					{
						name: 'expungeEverything',
						valueBoolean: true,
					},
				],
			},
		});
	});

	test.each([
		['hapi', '$expunge', {
			resourceType: 'Parameters',
			parameter: [
				{
					name: 'expungeEverything',
					valueBoolean: true,
				},
			],
		}],
		['wildfhir', '$purge-all', {}],
	])('server reset preserves the "%s" driver alias', async (driver, operation, payload) => {
		const result = await runCli(['server', 'reset', fhirBaseUrl, '--driver', driver, '--dry-run']);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(JSON.parse(result.stdout)).toEqual({
			dryRun: true,
			method: 'POST',
			url: `${fhirBaseUrl.replace(/\/*$/, '')}/${operation}`,
			payload,
		});
	});

	test('server reset rejects unsupported drivers', async () => {
		const result = await runCli(['server', 'reset', fhirBaseUrl, '--driver', 'generic', '--dry-run']);

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('Server reset failed.');
		expect(result.stderr).toContain('Unsupported reset driver "generic"');
	});

	test('poll import rejects a missing manifest before polling', async () => {
		const result = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			path.join(projectRoot, 'test/data/example/missing-stack.json'),
			'--exit',
			'--dry-run',
		]);

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('Could not load manifest');
		expect(result.stderr).toContain('Failed to read manifest file');
	});

	test('poll import rejects invalid manifest JSON before polling', async () => {
		const dir = makeTempDir();
		const manifestPath = path.join(dir, 'stack.json');
		fs.writeFileSync(manifestPath, '{ invalid json', 'utf8');

		const result = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			manifestPath,
			'--exit',
			'--dry-run',
		]);

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('Could not load manifest');
		expect(result.stderr).toContain('Invalid JSON in manifest');
	});

	test('poll import rejects an unknown scenario id before polling', async () => {
		const result = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			manifestFixturePath,
			'--exit',
			'--dry-run',
			'--scenario',
			'missing-scenario',
		]);

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('Unknown scenario id "missing-scenario"');
	});

	test('synthea-upload rejects invalid JSON fixture files', async () => {
		const dir = makeTempDir();
		fs.writeFileSync(path.join(dir, 'Patient invalid.json'), '{ invalid json', 'utf8');

		const result = await runCli(['synthea-upload', dir, fhirBaseUrl]);

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('SyntaxError');
	});
});

describe('CLI against a live FHIR test server', () => {
	beforeAll(async () => {
		if (skipLiveTests) {
			return;
		}
		await expectServerReachable();
	});

	const maybeTest = skipLiveTests ? test.skip : test;

	maybeTest('synthea-upload writes fixture data and makes a known Patient readable', async () => {
		const result = await runCli(['synthea-upload', syntheaFixtureDir, fhirBaseUrl]);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('[SUCCESS]:');
		expect(result.stdout).toContain('Done');

		const patient = await axios.get(`${fhirBaseUrl}Patient/cfsb1703736930464`, {
			headers: { Accept: 'application/fhir+json' },
		});
		expect(patient.status).toBe(200);
		expect(patient.data).toMatchObject({
			resourceType: 'Patient',
			id: 'cfsb1703736930464',
			name: [
				{
					family: 'Allen1',
				},
			],
		});
	});

	maybeTest('one-shot poll import dry run loads the local manifest and does not mutate the server', async () => {
		const auditEventCode = `cli-vitest-${Date.now()}`;
		const result = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			manifestFixturePath,
			'--exit',
			'--dry-run',
			'--scenario',
			'default',
			'--audit-event-code',
			auditEventCode,
		]);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('Single poll cycle (--exit)');
		expect(result.stdout).toContain(`Scenario "default": importing 2 of 2 manifest rows with load=true`);
		expect(result.stdout).toContain('[DRY RUN] Would POST bundle "patient-test"');
		expect(result.stdout).toContain('[DRY RUN] Would PUT Library "HelloWorld"');
		expect(result.stdout).toContain('[DRY RUN] Would POST AuditEvent');
		expect(result.stdout).toContain('Single poll cycle (--exit): finished. Exiting.');
	});

	maybeTest('one-shot poll import preserves legacy no-scenario behavior by importing every load=true row', async () => {
		const auditEventCode = `cli-vitest-legacy-all-${Date.now()}`;
		const manifestPath = writeManifest({
			fhir_base_url: fhirBaseUrl,
			driver: 'hapi',
			scenarios: [
				{ id: 'partial', name: 'Partial' },
			],
			data: [
				buildBundleManifestRow('untagged', 30),
				buildBundleManifestRow('default-tagged', 20, ['default']),
				buildBundleManifestRow('partial-tagged', 10, ['partial']),
				buildBundleManifestRow('disabled', 5, ['partial'], false),
			],
		});

		const result = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			manifestPath,
			'--exit',
			'--dry-run',
			'--audit-event-code',
			auditEventCode,
		]);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).not.toContain('Scenario "');
		expect(result.stdout).toContain('[DRY RUN] Would POST bundle "partial-tagged"');
		expect(result.stdout).toContain('[DRY RUN] Would POST bundle "default-tagged"');
		expect(result.stdout).toContain('[DRY RUN] Would POST bundle "untagged"');
		expect(result.stdout).not.toContain('disabled');
		expect(result.stdout.indexOf('"partial-tagged"')).toBeLessThan(result.stdout.indexOf('"default-tagged"'));
		expect(result.stdout.indexOf('"default-tagged"')).toBeLessThan(result.stdout.indexOf('"untagged"'));
	});

	maybeTest('one-shot poll import preserves browser default scenario compatibility', async () => {
		const auditEventCode = `cli-vitest-default-scenario-${Date.now()}`;
		const manifestPath = writeManifest({
			fhir_base_url: fhirBaseUrl,
			driver: 'hapi',
			scenarios: [
				{ id: 'partial', name: 'Partial' },
			],
			data: [
				buildBundleManifestRow('untagged', 30),
				buildBundleManifestRow('default-tagged', 20, ['default']),
				buildBundleManifestRow('partial-tagged', 10, ['partial']),
			],
		});

		const result = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			manifestPath,
			'--exit',
			'--dry-run',
			'--scenario',
			'default',
			'--audit-event-code',
			auditEventCode,
		]);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('Scenario "default": importing 2 of 3 manifest rows with load=true');
		expect(result.stdout).toContain('[DRY RUN] Would POST bundle "default-tagged"');
		expect(result.stdout).toContain('[DRY RUN] Would POST bundle "untagged"');
		expect(result.stdout).not.toContain('partial-tagged');
	});

	maybeTest('one-shot poll import writes CQL compatibility alias when manifest id differs from CQL library name', async () => {
		const auditEventCode = `cli-vitest-cql-alias-${Date.now()}`;
		const cqlPath = writeTextFile(
			'browser-library.cql',
			[
				"library BrowserAlignedLibrary version '1.2.3'",
				"using FHIR version '4.0.1'",
				'context Patient',
				'define Test: true',
				'',
			].join('\n')
		);
		const manifestPath = writeManifest({
			fhir_base_url: fhirBaseUrl,
			driver: 'hapi',
			data: [
				{
					file: cqlPath,
					name: 'Legacy Library Name!',
					loader: 'cql-as-fhir-library',
					load: true,
					priority: 10,
					version: '0.9.0',
					evaluate: { id: 'BrowserAlignedLibrary' },
				},
			],
		});

		const result = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			manifestPath,
			'--exit',
			'--dry-run',
			'--audit-event-code',
			auditEventCode,
		]);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('/Library/BrowserAlignedLibrary');
		expect(result.stdout).toContain('/Library/LegacyLibraryName');
		expect(result.stdout.indexOf('/Library/BrowserAlignedLibrary')).toBeLessThan(result.stdout.indexOf('/Library/LegacyLibraryName'));
	});

	maybeTest('one-shot poll import fails when CQL has no versioned library declaration', async () => {
		const auditEventCode = `cli-vitest-cql-legacy-${Date.now()}`;
		const cqlPath = writeTextFile(
			'legacy-library.cql',
			[
				'library LegacyOnlyLibrary',
				"using FHIR version '4.0.1'",
				'context Patient',
				'define Test: true',
				'',
			].join('\n')
		);
		const manifestPath = writeManifest({
			fhir_base_url: fhirBaseUrl,
			driver: 'hapi',
			data: [
				{
					file: cqlPath,
					name: 'Legacy Library Name!',
					loader: 'cql-as-fhir-library',
					load: true,
					priority: 10,
					version: '9.8.7',
					evaluate: { id: 'LegacyLibraryName' },
				},
			],
		});

		const result = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			manifestPath,
			'--exit',
			'--dry-run',
			'--audit-event-code',
			auditEventCode,
		]);

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('Error polling FHIR server.');
		expect(result.stderr).toContain('Could not determine CQL library name and version');
		expect(result.stderr).toContain('Import aborted');
		expect(result.stdout).not.toContain('/Library/LegacyLibraryName');
		expect(result.stdout).not.toContain('/Library/LegacyOnlyLibrary');
	});

	maybeTest('one-shot poll import writes fixture data and an AuditEvent marker', async () => {
		const auditEventCode = `cli-vitest-live-${Date.now()}`;
		const manifestPath = writeManifest({
			fhir_base_url: fhirBaseUrl,
			driver: 'hapi',
			data: [
				{
					file: path.join(syntheaFixtureDir, 'patient-test.json'),
					name: 'Patient 1 - Adrian Allen',
					loader: 'fhir-bundle',
					load: true,
					priority: 10,
				},
			],
		});

		const result = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			manifestPath,
			'--exit',
			'--audit-event-code',
			auditEventCode,
		]);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('No matching AuditEvent resources. Triggering import.');
		expect(result.stdout).toContain('[SUCCESS] Imported "Patient 1 - Adrian Allen"');
		expect(result.stdout).toContain('[SUCCESS] Posted import AuditEvent');

		const patient = await axios.get(`${fhirBaseUrl}Patient/cfsb1703736930464`, {
			headers: { Accept: 'application/fhir+json' },
		});
		expect(patient.status).toBe(200);
		expect(patient.data.resourceType).toBe('Patient');

		const auditEvent = await waitForAuditEvent(auditEventCode);
		expect(auditEvent.entry?.[0]?.resource?.resourceType).toBe('AuditEvent');
	});

	maybeTest('one-shot poll import skips when a matching AuditEvent already exists', async () => {
		const auditEventCode = `cli-vitest-existing-${Date.now()}`;
		const manifestPath = writeManifest({
			fhir_base_url: fhirBaseUrl,
			driver: 'hapi',
			data: [
				{
					file: path.join(syntheaFixtureDir, 'patient-test.json'),
					name: 'Patient 1 - Adrian Allen',
					loader: 'fhir-bundle',
					load: true,
					priority: 10,
				},
			],
		});

		const firstResult = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			manifestPath,
			'--exit',
			'--audit-event-code',
			auditEventCode,
		]);
		expect(firstResult.code).toBe(0);
		await waitForAuditEvent(auditEventCode);

		const secondResult = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			manifestPath,
			'--exit',
			'--audit-event-code',
			auditEventCode,
		]);

		expect(secondResult.code).toBe(0);
		expect(secondResult.stderr).toBe('');
		expect(secondResult.stdout).toContain('Found matching AuditEvent resources');
		expect(secondResult.stdout).toContain('No import needed.');
		expect(secondResult.stdout).not.toContain('Triggering import.');
	});

	maybeTest('one-shot poll import supports file URL manifests', async () => {
		const auditEventCode = `cli-vitest-file-url-${Date.now()}`;
		const manifestUrl = pathToFileURL(manifestFixturePath).href;

		const result = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			manifestUrl,
			'--exit',
			'--dry-run',
			'--scenario',
			'default',
			'--audit-event-code',
			auditEventCode,
		]);

		expect(result.code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain(`Scenario "default": importing 2 of 2 manifest rows with load=true`);
		expect(result.stdout).toContain('[DRY RUN] Would POST bundle "patient-test"');
		expect(result.stdout).toContain('[DRY RUN] Would POST AuditEvent');
	});

	maybeTest('one-shot poll import supports HTTP manifests', async () => {
		const auditEventCode = `cli-vitest-http-manifest-${Date.now()}`;
		const server = await serveJsonManifest({
			fhir_base_url: fhirBaseUrl,
			driver: 'hapi',
			data: [
				{
					file: pathToFileURL(path.join(syntheaFixtureDir, 'patient-test.json')).href,
					name: 'Patient 1 - Adrian Allen',
					loader: 'fhir-bundle',
					load: true,
					priority: 10,
				},
			],
		});

		try {
			const result = await runCli([
				'poll-auditevent-and-trigger-import',
				fhirBaseUrl,
				server.url,
				'--exit',
				'--dry-run',
				'--audit-event-code',
				auditEventCode,
			]);

			expect(result.code).toBe(0);
			expect(result.stderr).toBe('');
			expect(result.stdout).toContain('[DRY RUN] Would POST bundle "Patient 1 - Adrian Allen"');
			expect(result.stdout).toContain('[DRY RUN] Would POST AuditEvent');
		} finally {
			await server.close();
		}
	});

	maybeTest('one-shot poll import fails when a selected data file is missing', async () => {
		const auditEventCode = `cli-vitest-missing-data-${Date.now()}`;
		const manifestPath = writeManifest({
			fhir_base_url: fhirBaseUrl,
			driver: 'hapi',
			data: [
				{
					file: 'missing-patient.json',
					name: 'Missing Patient',
					loader: 'fhir-bundle',
					load: true,
					priority: 10,
				},
			],
		});

		const result = await runCli([
			'poll-auditevent-and-trigger-import',
			fhirBaseUrl,
			manifestPath,
			'--exit',
			'--dry-run',
			'--audit-event-code',
			auditEventCode,
		]);

		expect(result.code).toBe(1);
		expect(result.stderr).toContain('Error polling FHIR server.');
		expect(result.stderr).toContain('Could not read data file for "Missing Patient"');
	});
});

function normalizeFhirBaseUrl(url: string): string {
	return `${url.replace(/\/*$/, '')}/`;
}

function lastIndexWhere<T>(items: T[], predicate: (item: T) => boolean): number {
	for (let i = items.length - 1; i >= 0; i--) {
		const item = items[i];
		if (item !== undefined && predicate(item)) {
			return i;
		}
	}
	return -1;
}

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fhir-controller-cli-vitest-'));
	tempDirs.push(dir);
	return dir;
}

function writeManifest(manifest: any): string {
	const dir = makeTempDir();
	const manifestPath = path.join(dir, 'stack.json');
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
	return manifestPath;
}

function writeTextFile(fileName: string, content: string): string {
	const dir = makeTempDir();
	const filePath = path.join(dir, fileName);
	fs.writeFileSync(filePath, content, 'utf8');
	return filePath;
}

function buildBundleManifestRow(name: string, priority: number, scenarios?: string[], load: boolean = true): any {
	return {
		file: path.join(syntheaFixtureDir, 'patient-test.json'),
		name,
		loader: 'fhir-bundle',
		load,
		priority,
		...(scenarios ? { scenarios } : {}),
	};
}

async function serveJsonManifest(manifest: any): Promise<{ url: string; close: () => Promise<void> }> {
	const server: Server = createServer((request, response) => {
		if (request.url !== '/stack.json') {
			response.writeHead(404, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify({ error: 'Not found' }));
			return;
		}
		response.writeHead(200, { 'Content-Type': 'application/json' });
		response.end(JSON.stringify(manifest));
	});

	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const address = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${address.port}/stack.json`,
		close: () => new Promise<void>((resolve, reject) => {
			server.close(error => error ? reject(error) : resolve());
		}),
	};
}

async function expectServerReachable() {
	try {
		const response = await axios.get(`${fhirBaseUrl}metadata`, {
			headers: { Accept: 'application/fhir+json' },
			timeout: 5000,
		});
		expect(response.status).toBe(200);
		expect(response.data.resourceType).toBe('CapabilityStatement');
	} catch (error: any) {
		throw new Error(
			`FHIR test server is not reachable at ${fhirBaseUrl}. Start the server, set FHIR_CONTROLLER_TEST_FHIR_URL to override it, or set FHIR_CONTROLLER_SKIP_LIVE_TESTS=true to skip live CLI tests. ${error?.message ?? error}`
		);
	}
}

async function waitForAuditEvent(auditEventCode: string): Promise<any> {
	const searchUrl = `${fhirBaseUrl}AuditEvent?type=${encodeURIComponent(`http://dicom.nema.org/resources/ontology/DCM|${auditEventCode}`)}`;
	const deadline = Date.now() + 30000;
	let lastError: any;

	while (Date.now() < deadline) {
		try {
			const response = await axios.get(searchUrl, {
				headers: { Accept: 'application/fhir+json', 'Cache-Control': 'no-cache' },
			});
			const bundle = response.data;
			if ((typeof bundle.total === 'number' && bundle.total > 0) || (Array.isArray(bundle.entry) && bundle.entry.length > 0)) {
				return bundle;
			}
		} catch (error: any) {
			lastError = error;
		}
		await new Promise(resolve => setTimeout(resolve, 1000));
	}

	throw new Error(`Timed out waiting for AuditEvent code ${auditEventCode}. ${lastError?.message ?? ''}`);
}

function runCli(args: string[]) {
	return new Promise<{ code: number, error: ExecFileException | null, stdout: string, stderr: string }>(resolve => {
		execFile(
			process.execPath,
			[cliPath, ...args],
			{
				cwd: projectRoot,
				timeout: 80000,
				maxBuffer: 1024 * 1024 * 20,
			},
			(error, stdout, stderr) => {
				resolve({
					code: error && typeof error.code === 'number' ? error.code : 0,
					error,
					stdout,
					stderr,
				});
			}
		);
	});
}
