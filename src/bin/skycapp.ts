#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

import { program } from 'commander';
import axios from 'axios';

import { Bundle, AuditEvent } from 'fhir/r4';
import { SyntheaUtilities } from '../synthea-utilities';

// import {start, stop}  from 'marky';


let dryRun = false;
let debug = false;
const packageJson = fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8');
const packageJsonObject = JSON.parse(packageJson);
const version = packageJsonObject.version;

const cli = program.version(version)
	.description('Skycapp CLI utilities.');

cli
	.command('poll-auditevent-and-trigger-import')
	.description('Polls the FHIR server for resources matching the query at the specified interval.')
	.argument('<fhir_base_url>', 'URL of the FHIR server to poll')
	.argument('<stack_json_url>', 'FHIR controller stack.json configuration file')
	.option('--audit-event-system <audit_event_system>', 'System code for data import audit events', 'http://dicom.nema.org/resources/ontology/DCM')
	.option('--audit-event-code <audit_event_code>', 'Code for data import audit events', '110107')
	.option('-d, --debug', 'Enable debug mode')
	.option('-i, --interval <interval>', 'Minimum delay interval between polls to the FHIR server in seconds', '3600')
	.action((fhirBaseUrl, stackJsonUrl, options) => {
		const auditEventSystem = options.auditEventSystem;
		const auditEventCode = options.auditEventCode;
		const pollInterval = options.interval;
		debug = options.debug;
		console.info(`Downloading stack.json file from: ${stackJsonUrl}`);
		axios.get(stackJsonUrl).then(response => {
			const stack = response.data;
			if(debug) {
				console.debug(stack);
			}
			console.info(`Starting polling ${fhirBaseUrl} AuditEvents at ${pollInterval} interval.`);
			pollAndImportIndefinitely(fhirBaseUrl, auditEventSystem, auditEventCode, pollInterval);
		}).catch(error => {
			console.error(`Error fetching stack.json file.`, error.cause);
		});
	});

async function pollAndImportIndefinitely(fhirBaseUrl: string, auditEventSystem: string, auditEventCode: string, pollInterval: string) {
	while (true) {
		try {
			const url = fhirBaseUrl + '/AuditEvent?type=' + auditEventSystem + '|' + auditEventCode;
			const response = await axios.get<Bundle>(url);
			const now = new Date().toISOString();
			if (typeof response.data.total !== 'undefined' && response.data.total > 0) {
				console.info(`${now}: Found ${response.data.total} resources. No action needed.`);
			} else {
				console.info(`${now}: No resources found. Triggering functions.`);
				await triggerImport(fhirBaseUrl, auditEventSystem, auditEventCode);
			}
			if (debug) {
				console.debug(JSON.stringify(response.data, null, 2));
			}
		} catch (error: any) {
			console.error(`Error polling FHIR server.`, error.cause);
		}
		const intervalMs = Number(pollInterval) * 1000;
		await new Promise(resolve => setTimeout(resolve, intervalMs));
	}
}

async function triggerImport(fhirBaseUrl: string, auditEventSystem: string, auditEventCode: string) {

	const ae = await createImportAuditEvent(fhirBaseUrl, auditEventSystem, auditEventCode);
	if(debug) {
		console.debug(JSON.stringify(ae.data, null, 2));
	}
	return ae.data;
}

function createImportAuditEvent(fhirBaseUrl: string, auditEventSystem: string, auditEventCode: string) {
	const ae: AuditEvent = {
		resourceType: 'AuditEvent',
		type: { system: auditEventSystem, code: auditEventCode, display: 'Data has been imported into the system.' },
		agent: [],
		recorded: new Date().toISOString(),
		source: {
			observer: {}
			// site:  fhirBaseUrl
		}
	};
	return axios.post(fhirBaseUrl + '/AuditEvent', ae, {
		headers: {
			'Content-Type': 'application/fhir+json',
			'Accept': 'application/fhir+json',
		},
	});
}

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
