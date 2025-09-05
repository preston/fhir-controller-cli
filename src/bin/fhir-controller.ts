#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

import { program } from 'commander';
import axios from 'axios';

import { SyntheaUtilities } from '../synthea-utilities';
import { ImportUtilities } from '../import-utilities';


let dryRun = false;
let verbose = false;
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
				const importUtils = new ImportUtilities(dryRun, verbose);
				importUtils.pollAndImportIndefinitely(stackJsonUrl, fhirBaseUrl, auditEventSystem, auditEventCode, pollInterval);
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
		await syntheaUtils.uploadSyntheaDirectory(sDirectory, fhirUrl);
	});


program.parse(process.argv);


function safeFilePathFor(fileName: string) {
	let safePath = fileName;
	if (!path.isAbsolute(fileName)) {
		safePath = path.join(process.cwd(), fileName);
	}
	// console.debug(`Safe path: ${safePath}`);
	return safePath;
}
