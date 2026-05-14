// Author: Preston Lee

import fs from 'fs';
import path from 'path';
import type { CodeSystem } from 'fhir/r4';
import { BaseTerminologyHandler, TerminologyHandlerConfig } from './base-terminology-handler.js';
import { TerminologyFileInfo } from '../types/terminology-config.js';
import { RxNormFileReader } from './rxnorm-file-reader.js';
import { RXNORM_TERMINOLOGY_INFO } from '../constants/rxnorm-constants.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

export class RxNormHandler extends BaseTerminologyHandler {
  private rxnormFileReader: RxNormFileReader;

  constructor(config: TerminologyHandlerConfig) {
    super(config);
    this.rxnormFileReader = new RxNormFileReader({ verbose: config.verbose });
  }

  async processAndUpload(fileInfo: TerminologyFileInfo, fhirUrl: string): Promise<void> {
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Starting RxNorm terminology processing...`);

    // Get expected IDs for potential deletion
    const expectedIds = this.getExpectedIdsForDirectory(fileInfo.filePath);

    // Delete existing CodeSystems and ValueSets if replace option is enabled
    await this.deleteExistingCodeSystems(fhirUrl, expectedIds);
    await this.deleteExistingValueSets(fhirUrl, expectedIds);

    const exists = await this.checkExists(fhirUrl, fileInfo.filePath);
    if (exists && !this.config.replace) {
      console.info(`${LogPrefixes.SKIP} RxNorm CodeSystem already exists on server, skipping processing`);
      return;
    }

    const codeSystem = await this.processor.processRxNormFile(fileInfo.filePath);
    const strategy = await this.uploadCodeSystem(codeSystem, fhirUrl);

    // Create ValueSet for all codes in the CodeSystem using the upload strategy
    // This ensures ValueSet creation happens after all chunks are uploaded
    if (codeSystem.concept && codeSystem.concept.length > 0 && strategy.createAndUploadValueSet) {
      await strategy.createAndUploadValueSet(codeSystem, fhirUrl);
      console.info(`${LogPrefixes.VALUESET} Successfully created RxNorm ValueSet with ${codeSystem.concept.length} concepts`);
    }

    await this.printResourceSummary(fhirUrl, 'RxNorm');
  }

  async processAndStage(fileInfo: TerminologyFileInfo, stagingDir: string): Promise<string | null> {
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Starting RxNorm terminology staging...`);

    // Use streaming approach for large RxNorm datasets
    const stagedFilePath = await this.processRxNormFileStreaming(fileInfo.filePath, stagingDir);

    console.info(`${LogPrefixes.STAGE_2_SPLIT} Created staged RxNorm file: ${stagedFilePath}`);
    return stagedFilePath;
  }

  /**
   * Process RxNorm file using streaming approach to avoid memory issues
   */
  private async processRxNormFileStreaming(filePath: string, stagingDir: string): Promise<string> {
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Starting streaming RxNorm processing: ${filePath}`);

    const version = this.rxnormFileReader.extractRxNormVersion(filePath);
    const codeSystemId = `rxnorm-${version}`;
    const stagedFilePath = path.join(stagingDir, `${codeSystemId}.json`);

    // Create CodeSystem header manually to avoid JSON formatting issues
    const header = `{
  "resourceType": "CodeSystem",
  "id": "${codeSystemId}",
  "url": "${RXNORM_TERMINOLOGY_INFO.fhirUrls.system}",
  "version": "${version}",
  "name": "RxNorm",
  "title": "${RXNORM_TERMINOLOGY_INFO.identity.displayName}",
  "status": "active",
  "content": "fragment",
  "publisher": "${RXNORM_TERMINOLOGY_INFO.publisher.name}",
  "copyright": "${RXNORM_TERMINOLOGY_INFO.publisher.copyright}",
  "concept": [`;

    // Write header and start concept array
    const writeStream = fs.createWriteStream(stagedFilePath);
    writeStream.write(header);

    // Process concepts in streaming fashion
    await this.rxnormFileReader.processRxNormConceptsStreaming(filePath, writeStream, version);

    // Close the concept array and CodeSystem
    writeStream.write('\n  ]\n}');
    writeStream.end();

    // Wait for the stream to finish writing
    await new Promise<void>((resolve) => {
      writeStream.on('finish', () => resolve());
    });

    // Add property definitions to the CodeSystem
    await this.addPropertyDefinitionsToCodeSystem(stagedFilePath);

    return stagedFilePath;
  }

  /**
   * Get RxNorm property definitions for the CodeSystem
   */
  private getRxNormPropertyDefinitions(): any[] {
    return [
      {
        code: 'tty',
        uri: `${RXNORM_TERMINOLOGY_INFO.fhirUrls.system}#tty`,
        description: 'Term type',
        type: 'string'
      },
      {
        code: 'sab',
        uri: `${RXNORM_TERMINOLOGY_INFO.fhirUrls.system}#sab`,
        description: 'Source abbreviation',
        type: 'string'
      },
      {
        code: 'ispref',
        uri: `${RXNORM_TERMINOLOGY_INFO.fhirUrls.system}#ispref`,
        description: 'Is preferred term',
        type: 'code'
      }
    ];
  }

  /**
   * Add property definitions to the CodeSystem after concepts have been written
   */
  private async addPropertyDefinitionsToCodeSystem(stagedFilePath: string): Promise<void> {
    try {
      // Read and parse the file
      const fileContent = await fs.promises.readFile(stagedFilePath, 'utf8');
      const codeSystem = JSON.parse(fileContent);

      // Add property definitions
      codeSystem.property = this.getRxNormPropertyDefinitions();

      // Write back with property definitions
      await fs.promises.writeFile(stagedFilePath, JSON.stringify(codeSystem, null, 2));
    } catch (error: any) {
      console.error(`${LogPrefixes.STAGE_2_SPLIT} Error adding property definitions: ${error.message}`);
      throw error;
    }
  }

  async checkExists(fhirUrl: string, filePath?: string): Promise<boolean> {
    const expectedId = this.getExpectedIdsForDirectory(filePath || 'rxnorm-current')[0];

    if (await this.fhirClient.checkResourceExists(fhirUrl, 'CodeSystem', expectedId)) {
      console.info(`${LogPrefixes.SKIP} RxNorm CodeSystem ${expectedId} already exists on server`);
      return true;
    }

    return false;
  }

  getExpectedIds(): string[] {
    return [];
  }

  getExpectedIdsForDirectory(filePath?: string): string[] {
    if (filePath) {
      const version = this.rxnormFileReader.extractRxNormVersion(filePath);
      const expectedId = `rxnorm-${version}`;
      return [expectedId];
    }
    return ['rxnorm-current'];
  }
}
