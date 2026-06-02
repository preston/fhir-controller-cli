#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { inspect } from 'util';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';

import { ImportUtilities } from '../import-utilities.js';
import { SyntheaUtilities } from '../synthea-utilities.js';
import { TerminologyUtilities } from '../terminology-utilities.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8');
const version = JSON.parse(packageJson).version;

const defaultAuditEventSystem = 'http://dicom.nema.org/resources/ontology/DCM';
const defaultAuditEventCode = '110107';
const terminologySystems = ['snomed', 'loinc', 'rxnorm'] as const;

type TerminologySystem = typeof terminologySystems[number];

type CapturedRun<T> =
	| { ok: true; value: T; logs: string[] }
	| { ok: false; error: unknown; logs: string[] };

let consoleCaptureQueue: Promise<void> = Promise.resolve();

const server = new McpServer({
	name: 'fhir-controller-cli',
	version,
});

server.registerTool(
	'fhir_controller_info',
	{
		title: 'FHIR Controller MCP Info',
		description: 'Describe the FHIR Controller CLI MCP tools exposed by this server.',
	},
	async () => ({
		content: [
			{
				type: 'text',
				text: [
					`FHIR Controller CLI MCP server ${version}`,
					'Transport: stdio for local MCP clients. No HTTP port or authentication is started by this binary.',
					'Mutable tools default to dryRun=true; pass dryRun=false to write to a FHIR server.',
				].join('\n'),
			},
		],
		structuredContent: {
			version,
			transport: 'stdio',
			tools: [
				'fhir_poll_auditevent_and_trigger_import',
				'fhir_synthea_upload',
				'fhir_server_reset',
				'fhir_cql_evaluate',
				'fhir_terminology_import',
			],
		},
	})
);

server.registerTool(
	'fhir_server_reset',
	{
		title: 'Reset FHIR Server',
		description: 'Reset server data using the CLI reset drivers. Defaults to dry-run mode.',
		inputSchema: {
			fhirUrl: z.string().min(1).describe('Base URL of the FHIR server, such as http://localhost:8080/fhir.'),
			driver: z.enum(['hapi-fhir', 'wild-fhir', 'hapi', 'wildfhir']).describe('Reset driver to use.'),
			dryRun: z.boolean().default(true).describe('When true, return the request that would be sent without posting it.'),
		},
	},
	async ({ fhirUrl, driver, dryRun }) => runCapturedTool('FHIR server reset completed.', async () => {
		const utils = new ImportUtilities(dryRun, false);
		const result = await utils.resetServerData(fhirUrl, driver);
		if (dryRun) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			console.info(`Server reset request completed using driver "${driver}".`);
			if (result != null && Object.keys(result).length > 0) {
				console.log(JSON.stringify(result, null, 2));
			}
		}
		return result ?? {};
	})
);

server.registerTool(
	'fhir_cql_evaluate',
	{
		title: 'Evaluate CQL Library',
		description: 'Evaluate a FHIR Library resource with the browser-compatible subject parameter shape.',
		inputSchema: {
			fhirUrl: z.string().min(1).describe('Base URL of the FHIR server.'),
			libraryId: z.string().min(1).describe('FHIR Library id to evaluate.'),
			subject: z.string().min(1).describe('Subject value, such as Patient/123 or 123.'),
		},
	},
	async ({ fhirUrl, libraryId, subject }) => runCapturedTool('CQL evaluation completed.', async () => {
		const utils = new ImportUtilities(false, false);
		return utils.evaluateCqlLibrary(fhirUrl, libraryId, subject);
	})
);

server.registerTool(
	'fhir_synthea_upload',
	{
		title: 'Upload Synthea Directory',
		description: 'Upload Synthea-generated FHIR JSON files in dependency order. Defaults to dry-run mode.',
		inputSchema: {
			directory: z.string().min(1).describe('Directory containing Synthea FHIR JSON output.'),
			fhirUrl: z.string().min(1).describe('FHIR server URL to post resources to.'),
			dryRun: z.boolean().default(true).describe('When true, log files that would be uploaded without posting them.'),
		},
	},
	async ({ directory, fhirUrl, dryRun }) => runCapturedTool('Synthea upload completed.', async () => {
		const resolvedDirectory = safeFilePathFor(directory);
		const syntheaUtils = new SyntheaUtilities(dryRun);
		await syntheaUtils.uploadSyntheaDirectory(resolvedDirectory, fhirUrl);
		return { directory: resolvedDirectory, fhirUrl, dryRun };
	})
);

server.registerTool(
	'fhir_poll_auditevent_and_trigger_import',
	{
		title: 'Poll AuditEvent And Trigger Import',
		description: 'Run one AuditEvent poll/import cycle from a stack manifest. Use the CLI binary for indefinite polling.',
		inputSchema: {
			manifestRef: z.string().min(1).describe('HTTP(S), file://, or local path reference to stack.json.'),
			fhirUrl: z.string().min(1).describe('FHIR server URL to poll and import into.'),
			auditEventSystem: z.string().default(defaultAuditEventSystem).describe('AuditEvent type system to search and create.'),
			auditEventCode: z.string().default(defaultAuditEventCode).describe('AuditEvent type code to search and create.'),
			scenarioId: z.string().optional().describe('Optional manifest scenario id. Use default for browser default behavior.'),
			verbose: z.boolean().default(false).describe('Include verbose CLI diagnostics in captured logs.'),
			dryRun: z.boolean().default(true).describe('When true, log import actions without posting resources.'),
		},
	},
	async ({ manifestRef, fhirUrl, auditEventSystem, auditEventCode, scenarioId, verbose, dryRun }) =>
		runCapturedTool('AuditEvent poll/import cycle completed.', async () => {
			const importUtils = new ImportUtilities(dryRun, verbose);
			const trimmedManifestRef = manifestRef.trim();
			console.info(`Loading manifest from: ${trimmedManifestRef}`);
			const stack = await importUtils.loadManifest(trimmedManifestRef);
			importUtils.logStackConfigurationWarnings(stack, trimmedManifestRef);
			importUtils.ensureScenarioValid(stack, scenarioId);
			await importUtils.pollAndImportIndefinitely(
				trimmedManifestRef,
				fhirUrl,
				auditEventSystem,
				auditEventCode,
				'0',
				scenarioId,
				true
			);
			return {
				manifestRef: trimmedManifestRef,
				fhirUrl,
				auditEventSystem,
				auditEventCode,
				scenarioId: scenarioId ?? null,
				dryRun,
				exitAfterFirstCycle: true,
			};
		})
);

server.registerTool(
	'fhir_terminology_import',
	{
		title: 'Import Terminology',
		description: 'Import SNOMED CT, LOINC, or RxNorm terminology using the staged CLI workflow. Defaults to dry-run mode.',
		inputSchema: {
			filePath: z.string().min(1).describe('Terminology file or directory path.'),
			fhirUrl: z.string().min(1).describe('FHIR server URL to upload to.'),
			tempDir: z.string().min(1).describe('Temporary directory for staged terminology files.'),
			system: z.enum(terminologySystems).default('snomed').describe('Terminology system to import.'),
			dryRun: z.boolean().default(true).describe('When true, preprocess/split but do not upload resources.'),
			verbose: z.boolean().default(false).describe('Include verbose CLI diagnostics in captured logs.'),
			keepTemporary: z.boolean().default(false).describe('Keep staged files after processing.'),
			replace: z.boolean().default(false).describe('Replace existing CodeSystem and ValueSet before importing.'),
			batchSize: z.number().int().positive().default(1000).describe('Number of concepts to process in each batch.'),
			skipPreprocess: z.boolean().default(false).describe('Use existing staged preprocessing output.'),
			skipSplit: z.boolean().default(false).describe('Use existing split files.'),
			skipUpload: z.boolean().default(false).describe('Only preprocess and split; do not upload.'),
		},
	},
	async (args) => runCapturedTool('Terminology import completed.', async () => runTerminologyImport(args))
);

async function runTerminologyImport(args: {
	filePath: string;
	fhirUrl: string;
	tempDir: string;
	system: TerminologySystem;
	dryRun: boolean;
	verbose: boolean;
	keepTemporary: boolean;
	replace: boolean;
	batchSize: number;
	skipPreprocess: boolean;
	skipSplit: boolean;
	skipUpload: boolean;
}) {
	const filePath = safeFilePathFor(args.filePath);
	const tempDir = safeFilePathFor(args.tempDir);
	const terminologyUtils = new TerminologyUtilities(
		args.dryRun,
		args.verbose,
		tempDir,
		args.keepTemporary,
		args.replace,
		args.batchSize
	);

	if (args.dryRun) {
		console.log('Dry run enabled. No resources will be uploaded.');
	}
	if (args.keepTemporary) {
		console.log('Keep temp files enabled. Temporary files will not be cleaned up.');
	}

	console.info(`Starting ${args.system.toUpperCase()} terminology import process`);
	console.info(`Using temporary directory: ${tempDir}`);
	if (args.skipPreprocess) console.info(`${LogPrefixes.SKIP} Preprocessing stage will be skipped`);
	if (args.skipSplit) console.info(`${LogPrefixes.SKIP} Splitting stage will be skipped`);
	if (args.skipUpload) console.info(`${LogPrefixes.SKIP} Upload stage will be skipped`);

	let actualFilePath = filePath;
	if (!args.skipPreprocess) {
		if (!terminologyUtils.validateFile(filePath, true)) {
			throw new Error('Invalid file path.');
		}
		const fileSize = terminologyUtils.getFileSize(filePath);
		console.info(`File size: ${fileSize.toFixed(2)} MB`);
	} else {
		const recentFiles = terminologyUtils.fileHandler.findMostRecentFiles(tempDir, args.system);
		if (!recentFiles) {
			throw new Error('No recent files found in temp directory. Cannot skip preprocessing.');
		}
		actualFilePath = recentFiles;
		console.info(`Using most recent files from: ${actualFilePath}`);
	}

	await terminologyUtils.importTerminologyWithSkips(actualFilePath, args.fhirUrl, args.system, {
		skipPreprocess: args.skipPreprocess,
		skipSplit: args.skipSplit,
		skipUpload: args.skipUpload,
	});

	return {
		filePath: actualFilePath,
		fhirUrl: args.fhirUrl,
		tempDir,
		system: args.system,
		dryRun: args.dryRun,
		keepTemporary: args.keepTemporary,
		replace: args.replace,
		batchSize: args.batchSize,
		skipPreprocess: args.skipPreprocess,
		skipSplit: args.skipSplit,
		skipUpload: args.skipUpload,
	};
}

async function runCapturedTool<T>(summary: string, operation: () => Promise<T>): Promise<CallToolResult> {
	const captured = await runWithCapturedConsole(operation);
	if (!captured.ok) {
		return errorToolResult(summary, captured.error, captured.logs);
	}
	return successToolResult(summary, captured.value, captured.logs);
}

async function runWithCapturedConsole<T>(operation: () => Promise<T>): Promise<CapturedRun<T>> {
	let releaseQueue!: () => void;
	const previousQueue = consoleCaptureQueue;
	consoleCaptureQueue = new Promise<void>(resolve => {
		releaseQueue = resolve;
	});
	await previousQueue;

	const logs: string[] = [];
	const originalConsole = {
		log: console.log,
		info: console.info,
		warn: console.warn,
		error: console.error,
		debug: console.debug,
	};

	console.log = captureConsoleLine(logs, 'log') as typeof console.log;
	console.info = captureConsoleLine(logs, 'info') as typeof console.info;
	console.warn = captureConsoleLine(logs, 'warn') as typeof console.warn;
	console.error = captureConsoleLine(logs, 'error') as typeof console.error;
	console.debug = captureConsoleLine(logs, 'debug') as typeof console.debug;

	try {
		const value = await operation();
		return { ok: true, value, logs };
	} catch (error) {
		return { ok: false, error, logs };
	} finally {
		console.log = originalConsole.log;
		console.info = originalConsole.info;
		console.warn = originalConsole.warn;
		console.error = originalConsole.error;
		console.debug = originalConsole.debug;
		releaseQueue();
	}
}

function captureConsoleLine(logs: string[], level: string) {
	return (...args: unknown[]) => {
		logs.push(`[${level}] ${args.map(formatConsoleArg).join(' ')}`);
	};
}

function formatConsoleArg(arg: unknown): string {
	if (typeof arg === 'string') {
		return arg;
	}
	if (arg instanceof Error) {
		return arg.stack ?? arg.message;
	}
	return inspect(arg, { depth: 8, breakLength: 120, colors: false });
}

function successToolResult(summary: string, result: unknown, logs: string[]): CallToolResult {
	const textParts = [summary];
	if (logs.length > 0) {
		textParts.push(`Captured logs:\n${logs.join('\n')}`);
	}
	if (result !== undefined) {
		textParts.push(`Result:\n${formatJson(result)}`);
	}
	return {
		content: [{ type: 'text', text: textParts.join('\n\n') }],
		structuredContent: {
			success: true,
			result,
			logs,
		},
	};
}

function errorToolResult(summary: string, error: unknown, logs: string[]): CallToolResult {
	const details = errorDetails(error);
	const textParts = [`${summary} Failed.`, `Error: ${details.message}`];
	if (logs.length > 0) {
		textParts.push(`Captured logs:\n${logs.join('\n')}`);
	}
	if (details.responseData !== undefined) {
		textParts.push(`Response data:\n${formatJson(details.responseData)}`);
	}
	return {
		isError: true,
		content: [{ type: 'text', text: textParts.join('\n\n') }],
		structuredContent: {
			success: false,
			error: details,
			logs,
		},
	};
}

function errorDetails(error: unknown): Record<string, unknown> & { message: string; responseData?: unknown } {
	const e = error as any;
	return {
		message: e?.message ?? String(error),
		status: e?.response?.status,
		statusText: e?.response?.statusText,
		responseData: e?.response?.data,
	};
}

function formatJson(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return inspect(value, { depth: 8, breakLength: 120, colors: false });
	}
}

function safeFilePathFor(fileName: string) {
	let safePath = fileName;
	if (fileName.startsWith('~/')) {
		safePath = path.join(os.homedir(), fileName.slice(2));
	} else if (fileName === '~') {
		safePath = os.homedir();
	} else if (!path.isAbsolute(fileName)) {
		safePath = path.join(process.cwd(), fileName);
	}
	return safePath;
}

const transport = new StdioServerTransport();
await server.connect(transport);
