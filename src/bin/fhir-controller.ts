#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

import { program } from 'commander';

import { SyntheaUtilities } from '../synthea-utilities.js';
import { ImportUtilities } from '../import-utilities.js';
import { TerminologyUtilities } from '../terminology-utilities.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dryRun = false;
let verbose = false;
let isShuttingDown = false;
let activeOperations: Set<Promise<any>> = new Set();
let importUtils: ImportUtilities | null = null;
const packageJson = fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8');
const packageJsonObject = JSON.parse(packageJson);
const version = packageJsonObject.version;

const cli = program.version(version)
	.description('FHIR Controller CLI utilities.');

cli
	.command('mcp')
	.description('Run the FHIR Controller MCP server.')
	.option('--transport <transport>', 'MCP transport to use: http or stdio', 'http')
	.option('--http', 'Run MCP over Streamable HTTP')
	.option('--stdio', 'Run MCP over stdio')
	.option('--host <host>', 'HTTP host to bind', process.env.FHIR_CONTROLLER_MCP_HOST ?? '0.0.0.0')
	.option('--port <port>', 'HTTP port to bind', process.env.FHIR_CONTROLLER_MCP_PORT ?? process.env.MCP_PORT ?? process.env.PORT ?? '8002')
	.option('--path <path>', 'HTTP MCP endpoint path', process.env.FHIR_CONTROLLER_MCP_PATH ?? '/mcp')
	.action(async (options) => {
		const { parseMcpPort, startMcpServer } = await import('../mcp-server.js');
		let transport = String(options.transport).toLowerCase();
		if (options.http) {
			transport = 'http';
		}
		if (options.stdio) {
			transport = 'stdio';
		}
		if (transport !== 'http' && transport !== 'stdio') {
			console.error(`Invalid MCP transport: ${options.transport}. Must be "http" or "stdio".`);
			process.exit(1);
		}
		await startMcpServer({
			transport,
			host: options.host,
			port: parseMcpPort(options.port),
			path: options.path,
			installSignalHandlers: false,
		});
	});

cli
	.command('poll-auditevent-and-trigger-import')
	.description('Polls the FHIR server for resources matching the query at the specified interval.')
	.argument('<fhir_base_url>', 'URL of the FHIR server to poll')
	.argument(
		'<manifest_ref>',
		'FHIR Controller stack manifest: HTTP(S) URL, file:// URL, or filesystem path to stack.json'
	)
	.option('--audit-event-system <audit_event_system>', 'System code for data import audit events', 'http://dicom.nema.org/resources/ontology/DCM')
	.option('--audit-event-code <audit_event_code>', 'Code for data import audit events', '110107')
	.option('-i, --interval <interval>', 'Minimum delay interval between polls to the FHIR server in seconds', '3600')
	.option('-v, --verbose', 'Enable verbose debugging mode')
	.option('-d, --dry-run', 'Perform a dry run without uploading any resources')
	.option(
		'--scenario <scenario_id>',
		'Only import manifest data rows for this scenario id (see manifest scenarios[].id)'
	)
	.option('--exit', 'Run one AuditEvent poll (and import if needed) then exit; do not repeat on an interval')
	.action(async (fhirBaseUrl, manifestRef, options) => {
		const auditEventSystem = options.auditEventSystem;
		const auditEventCode = options.auditEventCode;
		const pollInterval = options.interval;
		const scenarioId = options.scenario as string | undefined;
		const exitAfterFirstCycle = Boolean(options.exit);
		verbose = options.verbose;
		dryRun = options.dryRun;
		console.info(`Loading manifest from: ${manifestRef}`);
		importUtils = new ImportUtilities(dryRun, verbose);
		let stack: any;
		try {
			stack = await importUtils.loadManifest(manifestRef);
		} catch (error: any) {
			console.error('Could not load manifest (missing file, invalid JSON, or HTTP error). This is fatal.');
			console.error(error?.message ?? String(error));
			process.exit(1);
		}
		importUtils.logStackConfigurationWarnings(stack, manifestRef.trim());
		try {
			importUtils.ensureScenarioValid(stack, scenarioId);
		} catch (error: any) {
			console.error(error?.message ?? error);
			process.exit(1);
		}
		if (verbose) {
			console.debug(stack);
		}
		if (exitAfterFirstCycle) {
			console.info(`Single poll cycle (--exit) against ${fhirBaseUrl} AuditEvents.`);
		} else {
			console.info(`Starting polling ${fhirBaseUrl} AuditEvents at ${pollInterval} interval.`);
		}
		const pollingPromise = importUtils.pollAndImportIndefinitely(
			manifestRef,
			fhirBaseUrl,
			auditEventSystem,
			auditEventCode,
			pollInterval,
			scenarioId,
			exitAfterFirstCycle
		);
		activeOperations.add(pollingPromise);
		pollingPromise.finally(() => activeOperations.delete(pollingPromise));
		if (exitAfterFirstCycle) {
			await pollingPromise;
		}
	});


cli.command('synthea-upload')
	.description('Upload a directory of Synthea-generated FHIR resources to a FHIR URL using Synthea file naming conventions and loading order.')
	.argument('<directory>', 'Directory with Synthea-generate "fhir" resource files')
	.argument('<url>', 'URL of the FHIR server to upload the resources to')
	.option('-d, --dry-run', 'Perform a dry run without uploading any resources')
	.action(async (directory, fhirUrl, options) => {
		dryRun = options.dryRun;
		if (dryRun) {
			console.log('Dry run enabled. No resources will be uploaded.');
		}
		const sDirectory = safeFilePathFor(directory);
		const syntheaUtils = new SyntheaUtilities(dryRun);
		const uploadPromise = syntheaUtils.uploadSyntheaDirectory(sDirectory, fhirUrl);
		activeOperations.add(uploadPromise);
		uploadPromise.finally(() => activeOperations.delete(uploadPromise));
		await uploadPromise;
	});

const serverCommand = cli.command('server');

serverCommand
	.command('reset')
	.description('Permanently reset server data using a supported FHIR Controller driver.')
	.argument('<fhir_url>', 'URL of the FHIR server to reset')
	.requiredOption('--driver <driver>', 'Reset driver to use: hapi-fhir or wild-fhir')
	.option('-d, --dry-run', 'Print the reset request without sending it')
	.action(async (fhirUrl: string, options: any) => {
		const dryRunReset = Boolean(options.dryRun);
		const utils = new ImportUtilities(dryRunReset, false);
		try {
			const result = await utils.resetServerData(fhirUrl, options.driver);
			if (dryRunReset) {
				console.log(JSON.stringify(result, null, 2));
			} else {
				console.info(`Server reset request completed using driver "${options.driver}".`);
				if (result != null && Object.keys(result).length > 0) {
					console.log(JSON.stringify(result, null, 2));
				}
			}
		} catch (error: any) {
			console.error('Server reset failed.');
			if (error?.response?.data) {
				console.error(JSON.stringify(error.response.data, null, 2));
			} else if (error?.message) {
				console.error(error.message);
			} else {
				console.error(error);
			}
			process.exit(1);
		}
	});

const cqlCommand = cli.command('cql');

cqlCommand
	.command('evaluate')
	.description('Evaluate a CQL Library resource with the same subject parameter shape used by the browser app.')
	.argument('<fhir_url>', 'URL of the FHIR server to evaluate against')
	.argument('<library_id>', 'FHIR Library id to evaluate')
	.argument('<subject>', 'Subject value to send, such as Patient/123 or 123')
	.action(async (fhirUrl: string, libraryId: string, subject: string) => {
		const utils = new ImportUtilities(false, false);
		try {
			const result = await utils.evaluateCqlLibrary(fhirUrl, libraryId, subject);
			console.log(JSON.stringify(result, null, 2));
		} catch (error: any) {
			console.error(`CQL evaluation failed for Library/${libraryId}.`);
			if (error?.response?.data) {
				console.error(JSON.stringify(error.response.data, null, 2));
			} else if (error?.message) {
				console.error(error.message);
			} else {
				console.error(error);
			}
			process.exit(1);
		}
	});

const terminologyCommand = cli.command('terminology');

terminologyCommand
	.command('import')
	.description('Import terminology systems to a FHIR server')
	.argument('<file_path>', 'Path to unzipped terminology files directory (SNOMED CT RF2 files/ZIP, LOINC CSV, or RxNorm CSV)')
	.argument('<fhir_url>', 'URL of the FHIR server to upload to')
	.argument('<temp_dir>', 'Temporary directory for staging large terminology files')
	.option('-s, --system <system>', 'Terminology system to import (snomed, loinc, rxnorm)', 'snomed')
	.option('-d, --dry-run', 'Perform a dry run without uploading any resources')
	.option('-v, --verbose', 'Enable verbose debugging mode')
	.option('--keep-temporary', 'Keep temporary files after upload for debugging')
	.option('--replace', 'Delete existing CodeSystem and ValueSet before importing new ones')
	.option('--batch-size <size>', 'Number of concepts to process in each batch', '1000')
	.option('--skip-preprocess', 'Skip preprocessing stage (use most recent files in temp directory)')
	.option('--skip-split', 'Skip splitting stage (use most recent files in temp directory)')
	.option('--skip-upload', 'Skip upload stage (only preprocess and split)')
	.action(async (filePath: string, fhirUrl: string, tempDir: string, options: any) => {
		dryRun = options.dryRun;
		verbose = options.verbose;
		const keepTemp = options.keepTemporary;
		const replace = options.replace;
		const system = options.system;
		const batchSize = parseInt(options.batchSize);
		const skipPreprocess = options.skipPreprocess;
		const skipSplit = options.skipSplit;
		const skipUpload = options.skipUpload;
		
		// Validate system option
		const validSystems = ['snomed', 'loinc', 'rxnorm'];
		if (!validSystems.includes(system)) {
			console.error(`Invalid system: ${system}. Must be one of: ${validSystems.join(', ')}`);
			process.exit(1);
		}
		
		if (dryRun) {
			console.log('Dry run enabled. No resources will be uploaded.');
		}
		
		if (keepTemp) {
			console.log('Keep temp files enabled. Temporary files will not be cleaned up.');
		}
		
		console.info(`Starting ${system.toUpperCase()} terminology import process`);
		console.info(`Using temporary directory: ${tempDir}`);
		
		// Show which stages will be skipped
		if (skipPreprocess) console.info(`${LogPrefixes.SKIP} Preprocessing stage will be skipped`);
		if (skipSplit) console.info(`${LogPrefixes.SKIP} Splitting stage will be skipped`);
		if (skipUpload) console.info(`${LogPrefixes.SKIP} Upload stage will be skipped`);
		
		const terminologyUtils = new TerminologyUtilities(dryRun, verbose, tempDir, keepTemp, replace, batchSize);
		
		// Determine file path based on skip options
		let actualFilePath = filePath;
		if (!skipPreprocess) {
			// Validate file based on system type
			const allowDirectory = system === 'snomed' || system === 'loinc' || system === 'rxnorm';
			if (!terminologyUtils.validateFile(filePath, allowDirectory)) {
				console.error('Invalid file path. Exiting.');
				process.exit(1);
			}
			
			const fileSize = terminologyUtils.getFileSize(filePath);
			console.info(`File size: ${fileSize.toFixed(2)} MB`);
			actualFilePath = safeFilePathFor(filePath);
		} else {
			// Find most recent files in temp directory
			const recentFiles = terminologyUtils.fileHandler.findMostRecentFiles(tempDir, system);
			if (!recentFiles) {
				console.error('No recent files found in temp directory. Cannot skip preprocessing.');
				process.exit(1);
			}
			actualFilePath = recentFiles;
			console.info(`Using most recent files from: ${actualFilePath}`);
		}
		
		// Run the import process with skip options
		const importPromise = terminologyUtils.importTerminologyWithSkips(actualFilePath, fhirUrl, system, {
			skipPreprocess,
			skipSplit,
			skipUpload
		});
		activeOperations.add(importPromise);
		importPromise.finally(() => activeOperations.delete(importPromise));
		await importPromise;
	});



// Handle SIGINT signal for graceful shutdown
process.on('SIGINT', () => {
	console.info('Received SIGINT signal. Shutting down gracefully...');
	shutdown();
});

// Handle SIGTERM signal for graceful shutdown
process.on('SIGTERM', () => {
	console.info('Received SIGTERM signal. Shutting down gracefully...');
	shutdown();
});

function shutdown() {
	if (isShuttingDown) {
		console.info('Already shutting down, forcing exit...');
		process.exit(1);
	}
		isShuttingDown = true;
	
	// Cancel the import utilities if it exists
	if (importUtils) {
		console.info('Cancelling polling operation...');
		importUtils.cancel();
	}
	
	if (activeOperations.size === 0) {
		console.info('No active operations to cancel. Exiting...');
		process.exit(0);
	}
	
	console.info(`Cancelling ${activeOperations.size} active operations...`);
	
	// Wait for all operations to complete or timeout after 10 seconds
	Promise.allSettled(Array.from(activeOperations))
		.then(() => {
			console.info('All operations completed. Exiting...');
			process.exit(0);
		})
		.catch(() => {
			console.info('Some operations failed to complete. Exiting...');
			process.exit(0);
		});
	
	// Force exit after 10 seconds if operations don't complete
	setTimeout(() => {
		console.warn('Operations did not complete in time. Forcing exit...');
		process.exit(1);
	}, 3000);
}

program.parse(process.argv);


function safeFilePathFor(fileName: string) {
	let safePath = fileName;
	
	// Handle tilde expansion for home directory
	if (fileName.startsWith('~/')) {
		safePath = path.join(os.homedir(), fileName.slice(2));
	} else if (fileName === '~') {
		safePath = os.homedir();
	} else if (!path.isAbsolute(fileName)) {
		safePath = path.join(process.cwd(), fileName);
	}
	
	// console.debug(`Safe path: ${safePath}`);
	return safePath;
}
