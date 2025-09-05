// Author: Preston Lee

import fs from 'fs';
import path from 'path';
import axios from 'axios';

export class SyntheaUtilities {
	private dryRun: boolean = false;

	constructor(dryRun: boolean = false) {
		this.dryRun = dryRun;
	}

	async uploadResources(_paths: string[], directory: string, fhirUrl: string): Promise<void> {
		let next = _paths.shift();
		if (next) {
			await this.uploadResource(next, directory, fhirUrl);
			if (_paths.length > 0) {
				await this.uploadResources(_paths, directory, fhirUrl);
			}
		}
	}

	async uploadResource(fileName: string, directory: string, fhirUrl: string): Promise<void> {
		const file = path.join(directory, fileName);
		const raw = fs.readFileSync(file).toString();
		const json = JSON.parse(raw) as any;
		// console.log(json);

		if (this.dryRun) {
			return new Promise<void>((resolve, reject) => {
				console.log(`Dry run: Would have uploaded ${fileName}`);
				resolve();
			});
		} else {
			return axios.post(fhirUrl, json, {
				headers: {
					'Content-Type': 'application/fhir+json',
					'Accept': 'application/fhir+json',
				},
			}).then((response) => {
				console.log(`[SUCCESS]: ${response.status} ${response.statusText}`, file);
				// console.log('Response Data:', JSON.stringify(response.data, null, 2));
			}).catch((error) => {
				if (error.response) {
					console.error(`[FAILURE]: ${error.response.status} ${error.response.statusText}`, file);
					console.error(JSON.stringify(error.response.data, null, 2));
				} else {
					console.error(`[ERROR]: ${error.message}`, file);
				}
			});
		}
	}

	async uploadSyntheaDirectory(directory: string, fhirUrl: string): Promise<void> {
		console.info(`Uploading Synthea-generated FHIR resources from ${directory} to ${fhirUrl}`);
		const files = fs.readdirSync(directory).filter(file => path.extname(file).toLowerCase() === '.json');
		const hospitals: string[] = [];
		const practitioners: string[] = [];
		const patients: string[] = [];
		
		files.forEach((file, i) => {
			if (file.startsWith('hospitalInformation')) {
				hospitals.push(file);
			} else if (file.startsWith('practitionerInformation')) {
				practitioners.push(file);
			} else {
				patients.push(file);
			}
		});

		// Upload in order: hospitals, practitioners, then patients
		await this.uploadResources(hospitals, directory, fhirUrl);
		await this.uploadResources(practitioners, directory, fhirUrl);
		await this.uploadResources(patients, directory, fhirUrl);
		console.info('Done');
	}
}
