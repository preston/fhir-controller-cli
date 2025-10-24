// Author: Preston Lee

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import type { Bundle, AuditEvent } from 'fhir/r4';

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

	async pollAndImportIndefinitely(stackJsonUrl: string, fhirBaseUrl: string, auditEventSystem: string, auditEventCode: string, pollInterval: string): Promise<void> {
		while (!this.isCancelled) {
			try {
				const url = fhirBaseUrl + '/AuditEvent?type=' + auditEventSystem + '|' + auditEventCode;
				const response = await axios.get<Bundle>(url);
				const now = new Date().toISOString();
				if (typeof response.data.total !== 'undefined' && response.data.total > 0) {
					console.info(`${now}: Found ${response.data.total} matching AuditEvent resources. No action needed.`);
				} else {
					console.info(`${now}: No resources found. Triggering functions.`);
					await this.triggerImport(stackJsonUrl, fhirBaseUrl, auditEventSystem, auditEventCode);
				}
				// if (this.debug) {
				// 	console.debug(JSON.stringify(response.data, null, 2));
				// }
			} catch (error: any) {
				console.error(`Error polling FHIR server.`);
				if(this.verbose) {
					console.error(error.cause);
				}
			}
			
			if (this.isCancelled) {
				console.info('Polling cancelled. Exiting...');
				break;
			}
			
			const intervalMs = Number(pollInterval) * 1000;
			await new Promise(resolve => setTimeout(resolve, intervalMs));
		}
	}

	async triggerImport(stackJsonUrl: string, fhirBaseUrl: string, auditEventSystem: string, auditEventCode: string): Promise<any> {
		const stackResponse = await axios.get(stackJsonUrl);
		const stack = stackResponse.data;

		// Sort the data array by priority, filter for load=true
		const dataFiles = (stack.data || [])
			.filter((item: any) => item.load)
			.sort((a: any, b: any) => (a.priority ?? 0) - (b.priority ?? 0));

		for (const item of dataFiles) {
			const filePath = item.file;
			let resourceData: any;

			// Try to fetch relative to stack.json URL
			let baseUrl = stackJsonUrl;
			baseUrl = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
			const fileUrl = filePath.startsWith('http') ? filePath : baseUrl + filePath;
			const fileResp = await axios.get(fileUrl);
			resourceData = fileResp.data;
			if (typeof resourceData === 'object') {
				resourceData = JSON.stringify(resourceData);

			}

			if (item.loader === "fhir-bundle") {
				const bundle = typeof resourceData === 'string' ? JSON.parse(resourceData) : resourceData;
				if (this.dryRun) {
					console.log(`[DRY RUN] Would POST bundle "${item.name}" (${filePath}) to ${fhirBaseUrl}`);
				} else {
					try {
						const postResp = await axios.post(
							`${fhirBaseUrl}`,
							bundle,
							{
								headers: {
									'Content-Type': 'application/fhir+json',
									'Accept': 'application/fhir+json',
								},
							}
						);
						console.info(`[SUCCESS] Imported "${item.name}" (${filePath}) to ${fhirBaseUrl}: ${postResp.status} ${postResp.statusText}`);
					} catch (err: any) {
						console.error(`[FAILURE] Importing "${item.name}" (${filePath}) to ${fhirBaseUrl}:`, err?.response?.status, err?.response?.statusText);
						if (err?.response?.data) {
							console.error(JSON.stringify(err.response.data, null, 2));
						}
					}
				}
			} else if (item.loader === "cql-as-fhir-library") {
				// Assume resourceData is the CQL text
				const cqlContent = typeof resourceData === 'string' ? resourceData : JSON.stringify(resourceData);
				// Derive a name/id for the Library resource
				const libraryId = (item.name || filePath).replace(/[^A-Za-z0-9]/g, '');
				const libraryResource = {
					resourceType: "Library",
					type: {},
					id: libraryId,
					version: item.version || "0.0.0",
					name: libraryId,
					title: libraryId,
					status: "active",
					description: item.description || "",
					url: fhirBaseUrl + '/Library/' + libraryId,
					content: [
						{
							contentType: "text/cql",
							data: Buffer.from(cqlContent, 'utf8').toString('base64')
						}
					]
				};
				if (this.dryRun) {
					console.log(`[DRY RUN] Would PUT Library "${item.name}" (${filePath}) to ${fhirBaseUrl}/Library`);
				} else {
					try {
						// console.log(JSON.stringify(libraryResource, null, 2));
						const postResp = await axios.put(
							`${fhirBaseUrl}/Library/${libraryId}`,
							libraryResource,
							{
								headers: {
									'Content-Type': 'application/fhir+json',
									'Accept': 'application/fhir+json',
								},
							}
						);
						// console.log(JSON.stringify(postResp.data, null, 2));
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
		if (this.dryRun) {
			console.log(`[DRY RUN] Would POST AuditEvent to ${fhirBaseUrl}/AuditEvent`);
			return ae;
		} else {
			let response = await axios.post<AuditEvent>(fhirBaseUrl + '/AuditEvent', ae, {
				headers: {
					'Content-Type': 'application/fhir+json',
					'Accept': 'application/fhir+json',
				},
			});
			return response.data;
		}
	}
}