// Author: Preston Lee

import fs from 'fs';
import path from 'path';
import type { CodeSystem } from 'fhir/r4';
import { BaseTerminologyHandler, TerminologyHandlerConfig } from './base-terminology-handler.js';
import { TerminologyFileInfo } from '../types/terminology-config.js';
import { LoincFileReader } from './loinc-file-reader.js';
import { LOINC_TERMINOLOGY_INFO } from '../constants/loinc-constants.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

export class LoincHandler extends BaseTerminologyHandler {
  private loincFileReader: LoincFileReader;

  constructor(config: TerminologyHandlerConfig) {
    super(config);
    this.loincFileReader = new LoincFileReader({ verbose: config.verbose });
  }

  async processAndUpload(fileInfo: TerminologyFileInfo, fhirUrl: string): Promise<void> {
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Starting LOINC terminology processing...`);

    // Get expected IDs for potential deletion
    const expectedIds = this.getExpectedIdsForDirectory(fileInfo.filePath);
    
    // Delete existing CodeSystems and ValueSets if replace option is enabled
    await this.deleteExistingCodeSystems(fhirUrl, expectedIds);
    await this.deleteExistingValueSets(fhirUrl, expectedIds);

    const exists = await this.checkExists(fhirUrl, fileInfo.filePath);
    if (exists && !this.config.replace) {
      console.info(`${LogPrefixes.SKIP} LOINC CodeSystem already exists on server, skipping processing`);
      return;
    }

    const codeSystem = await this.processor.processLoincFile(fileInfo.filePath);
    const strategy = await this.uploadCodeSystem(codeSystem, fhirUrl);

    // Create ValueSet for all codes in the CodeSystem using the upload strategy
    // This ensures ValueSet creation happens after all chunks are uploaded
    if (codeSystem.concept && codeSystem.concept.length > 0 && strategy.createAndUploadValueSet) {
      await strategy.createAndUploadValueSet(codeSystem, fhirUrl);
      console.info(`${LogPrefixes.VALUESET} Successfully created LOINC ValueSet with ${codeSystem.concept.length} concepts`);
    }

    await this.printResourceSummary(fhirUrl, 'LOINC');
  }

  async processAndStage(fileInfo: TerminologyFileInfo, stagingDir: string): Promise<string | null> {
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Starting LOINC terminology staging...`);
    
    // Use streaming approach for large LOINC datasets
    const stagedFilePath = await this.processLoincFileStreaming(fileInfo.filePath, stagingDir);
    
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Created staged LOINC file: ${stagedFilePath}`);
    return stagedFilePath;
  }

  /**
   * Process LOINC file using streaming approach to avoid memory issues
   */
  private async processLoincFileStreaming(filePath: string, stagingDir: string): Promise<string> {
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Starting streaming LOINC processing: ${filePath}`);
    
    const version = this.loincFileReader.extractLoincVersion(filePath);
    const codeSystemId = `loinc-${version}`;
    const stagedFilePath = path.join(stagingDir, `${codeSystemId}.json`);
    
    // Create CodeSystem header manually to avoid JSON formatting issues
    const header = `{
  "resourceType": "CodeSystem",
  "id": "${codeSystemId}",
  "url": "${LOINC_TERMINOLOGY_INFO.fhirUrls.system}",
  "version": "${version}",
  "name": "LOINC",
  "title": "${LOINC_TERMINOLOGY_INFO.identity.displayName}",
  "status": "active",
  "content": "fragment",
  "publisher": "${LOINC_TERMINOLOGY_INFO.publisher.name}",
  "copyright": "${LOINC_TERMINOLOGY_INFO.publisher.copyright}",
  "concept": [`;

    // Write header and start concept array
    const writeStream = fs.createWriteStream(stagedFilePath);
    writeStream.write(header);

    // Process concepts in streaming fashion
    await this.loincFileReader.processLoincConceptsStreaming(filePath, writeStream, version);

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
   * Get LOINC property definitions for the CodeSystem
   */
  private getLoincPropertyDefinitions(): any[] {
    return [
      {
        code: 'component',
        uri: `${LOINC_TERMINOLOGY_INFO.fhirUrls.system}#component`,
        description: 'Component or analyte name',
        type: 'string'
      },
      {
        code: 'property',
        uri: `${LOINC_TERMINOLOGY_INFO.fhirUrls.system}#property`,
        description: 'Property measured',
        type: 'string'
      },
      {
        code: 'time',
        uri: `${LOINC_TERMINOLOGY_INFO.fhirUrls.system}#time`,
        description: 'Time aspect',
        type: 'string'
      },
      {
        code: 'system',
        uri: `${LOINC_TERMINOLOGY_INFO.fhirUrls.system}#system`,
        description: 'System or specimen type',
        type: 'string'
      },
      {
        code: 'scale',
        uri: `${LOINC_TERMINOLOGY_INFO.fhirUrls.system}#scale`,
        description: 'Scale type',
        type: 'string'
      },
      {
        code: 'method',
        uri: `${LOINC_TERMINOLOGY_INFO.fhirUrls.system}#method`,
        description: 'Method type',
        type: 'string'
      },
      {
        code: 'class',
        uri: `${LOINC_TERMINOLOGY_INFO.fhirUrls.system}#class`,
        description: 'Class',
        type: 'string'
      },
      {
        code: 'classtype',
        uri: `${LOINC_TERMINOLOGY_INFO.fhirUrls.system}#classtype`,
        description: 'Class type',
        type: 'string'
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
      codeSystem.property = this.getLoincPropertyDefinitions();
      
      // Write back with property definitions
      await fs.promises.writeFile(stagedFilePath, JSON.stringify(codeSystem, null, 2));
    } catch (error: any) {
      console.error(`${LogPrefixes.STAGE_2_SPLIT} Error adding property definitions: ${error.message}`);
      throw error;
    }
  }

  async checkExists(fhirUrl: string, filePath?: string): Promise<boolean> {
    const expectedId = this.getExpectedIdsForDirectory(filePath || 'loinc-current')[0];
    
    if (await this.fhirClient.checkResourceExists(fhirUrl, 'CodeSystem', expectedId)) {
      console.info(`${LogPrefixes.SKIP} LOINC CodeSystem ${expectedId} already exists on server`);
      return true;
    }
    
    return false;
  }

  getExpectedIds(): string[] {
    return [];
  }

  getExpectedIdsForDirectory(filePath?: string): string[] {
    if (filePath) {
      const version = this.loincFileReader.extractLoincVersion(filePath);
      const expectedId = `loinc-${version}`;
      return [expectedId];
    }
    return ['loinc-current'];
  }
}
