#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { program } from 'commander';
import axios from 'axios';

import { SyntheaUtilities } from '../synthea-utilities.js';
import { ImportUtilities } from '../import-utilities.js';
import { TerminologyUtilities } from '../classes/terminology-utilities.js';
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
	.command('poll-auditevent-and-trigger-import')
	.description('Polls the FHIR server for resources matching the query at the specified interval.')
	.argument('<fhir_base_url>', 'URL of the FHIR server to poll')
	.argument('<stack_json_url>', 'FHIR controller stack.json configuration file')
	.option('--audit-event-system <audit_event_system>', 'System code for data import audit events', 'http://dicom.nema.org/resources/ontology/DCM')
	.option('--audit-event-code <audit_event_code>', 'Code for data import audit events', '110107')
	.option('-i, --interval <interval>', 'Minimum delay interval between polls to the FHIR server in seconds', '3600')
	.option('-v, --verbose', 'Enable verbose debugging mode')
	.option('-d, --dry-run', 'Perform a dry run without uploading any resources')
	.action((fhirBaseUrl, stackJsonUrl, options) => {
		const auditEventSystem = options.auditEventSystem;
		const auditEventCode = options.auditEventCode;
		const pollInterval = options.interval;
		verbose = options.verbose;
		dryRun = options.dryRun;
		console.info(`Downloading stack.json file from: ${stackJsonUrl}`);
		axios.get(stackJsonUrl).then(response => {
			const stack = response.data;
			if (response.status !== 200) {
				console.error(`Error fetching stack.json file. Exiting.`);
				return 1;
			} else {
				if (verbose) {
					console.debug(stack);
				}
				console.info(`Starting polling ${fhirBaseUrl} AuditEvents at ${pollInterval} interval.`);
				importUtils = new ImportUtilities(dryRun, verbose);
				const pollingPromise = importUtils.pollAndImportIndefinitely(stackJsonUrl, fhirBaseUrl, auditEventSystem, auditEventCode, pollInterval);
				activeOperations.add(pollingPromise);
				pollingPromise.finally(() => activeOperations.delete(pollingPromise));
			}
		}).catch(error => {
			console.error(`Error fetching stack.json file. Please check the URL and try again. This is fatal.`);
			return 1;
		});
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
	.option('--replace', 'Delete existing CodeSystem before importing new one')
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
			const allowDirectory = system === 'snomed';
			if (!terminologyUtils.validateFile(filePath, allowDirectory)) {
				console.error('Invalid file path. Exiting.');
				process.exit(1);
			}
			
			const fileSize = terminologyUtils.getFileSize(filePath);
			console.info(`File size: ${fileSize.toFixed(2)} MB`);
			actualFilePath = safeFilePathFor(filePath);
		} else {
			// Find most recent files in temp directory
			const recentFiles = terminologyUtils.findMostRecentFiles(tempDir, system);
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
	if (!path.isAbsolute(fileName)) {
		safePath = path.join(process.cwd(), fileName);
	}
	// console.debug(`Safe path: ${safePath}`);
	return safePath;
}
