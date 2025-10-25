import fs from 'fs';
import path from 'path';
import type { CodeSystem, ValueSet } from 'fhir/r4';
import { BaseTerminologyHandler, TerminologyHandlerConfig } from './base-terminology-handler.js';
import { TerminologyFileInfo } from '../types/terminology-config.js';
import { SnomedFileReader } from './snomed-file-reader.js';
import { SnomedMetadataExtractor } from './snomed-metadata-extractor.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

export class SnomedHandler extends BaseTerminologyHandler {
  private snomedFileReader: SnomedFileReader;

  constructor(config: TerminologyHandlerConfig) {
    super(config);
    this.snomedFileReader = new SnomedFileReader({ verbose: config.verbose });
  }

  async processAndUpload(fileInfo: TerminologyFileInfo, fhirUrl: string): Promise<void> {
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Starting SNOMED CT terminology processing...`);

    const directoryPath = fileInfo.filePath.replace(/\/Full\/Terminology\/.*$/, '');

    // Get expected IDs for potential deletion
    const expectedIds = this.getExpectedIdsForDirectory(directoryPath);
    
    // Delete existing CodeSystems if replace option is enabled
    await this.deleteExistingCodeSystems(fhirUrl, expectedIds);

    const exists = await this.checkExists(fhirUrl, directoryPath);
    if (exists && !this.config.replace) {
      console.info(`${LogPrefixes.SKIP} SNOMED CT CodeSystem already exists on server, skipping processing`);
      return;
    }

    const codeSystem = await this.processor.processSnomedDirectory(directoryPath);
    await this.uploadCodeSystem(codeSystem, fhirUrl);

    console.info(`${LogPrefixes.VALUESET} Skipping ValueSet creation to avoid memory issues with large SNOMED CT datasets`);

    await this.printResourceSummary(fhirUrl, 'SNOMED CT');
  }

  async processAndStage(fileInfo: TerminologyFileInfo, stagingDir: string): Promise<string | null> {
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Starting SNOMED CT terminology staging...`);

    const directoryPath = fileInfo.filePath.replace(/\/Full\/Terminology\/.*$/, '');
    
    // Use streaming approach for large SNOMED datasets
    const stagedFilePath = await this.processSnomedDirectoryStreaming(directoryPath, stagingDir);
    
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Created staged SNOMED CT file: ${stagedFilePath}`);
    return stagedFilePath;
  }

  /**
   * Process SNOMED directory using streaming approach to avoid memory issues
   */
  private async processSnomedDirectoryStreaming(directoryPath: string, stagingDir: string): Promise<string> {
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Starting streaming SNOMED CT processing: ${directoryPath}`);
    
    const terminologyPath = this.snomedFileReader.findTerminologyPath(directoryPath);
    if (!terminologyPath) {
      throw new Error('Could not find terminology files in SNOMED CT directory');
    }

    const version = SnomedMetadataExtractor.extractSnomedVersion(directoryPath);
    const namespace = SnomedMetadataExtractor.extractSnomedNamespace(directoryPath);
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Using SNOMED CT version: ${version}`);
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Using SNOMED CT namespace: ${namespace}`);

    // Create staged file with streaming approach
    const stagedFilePath = path.join(stagingDir, `sct-${namespace}-${version.split('/').pop() || 'current'}.json`);
    
    // Create CodeSystem header manually to avoid JSON formatting issues
    const codeSystemId = `sct-${namespace}-${version.split('/').pop() || 'current'}`;
    const header = `{
  "resourceType": "CodeSystem",
  "id": "${codeSystemId}",
  "url": "http://snomed.info/sct",
  "version": "${version}",
  "name": "SNOMED_CT",
  "status": "active",
  "concept": [`;

    // Write header and start concept array
    const writeStream = fs.createWriteStream(stagedFilePath);
    writeStream.write(header);

    // Load descriptions and relationships first
    const descriptions = await this.snomedFileReader.loadSnomedDescriptions(terminologyPath);
    const relationships = await this.snomedFileReader.loadSnomedRelationships(terminologyPath);

    // Process concepts in streaming fashion
    await this.snomedFileReader.processSnomedConceptsStreaming(terminologyPath, writeStream, descriptions, relationships);

    // Close the concept array and CodeSystem
    writeStream.write('\n  ]\n}');
    writeStream.end();

    // Wait for the stream to finish writing
    await new Promise<void>((resolve) => {
      writeStream.on('finish', () => resolve());
    });

    return stagedFilePath;
  }




  async checkExists(fhirUrl: string, directoryPath?: string): Promise<boolean> {
    if (directoryPath) {
      const version = SnomedMetadataExtractor.extractSnomedVersion(directoryPath);
      const namespace = SnomedMetadataExtractor.extractSnomedNamespace(directoryPath);
      const versionId = version.split('/').pop() || 'current';
      const expectedId = `sct-${namespace}-${versionId}`;
      
      if (await this.fhirClient.checkResourceExists(fhirUrl, 'CodeSystem', expectedId)) {
        console.info(`${LogPrefixes.SKIP} SNOMED CT CodeSystem ${expectedId} already exists on server`);
        return true;
      }
    }
    
    const expectedIds = this.getExpectedIds();
    
    for (const id of expectedIds) {
      if (await this.fhirClient.checkResourceExists(fhirUrl, 'CodeSystem', id)) {
        console.info(`${LogPrefixes.SKIP} SNOMED CT CodeSystem ${id} already exists on server`);
        return true;
      }
    }
    
    return false;
  }

  getExpectedIds(): string[] {
    return [];
  }

  getExpectedIdsForDirectory(directoryPath: string): string[] {
    const version = this.processor.extractSnomedVersion(directoryPath);
    const namespace = this.processor.extractSnomedNamespace(directoryPath);
    const versionId = version.split('/').pop() || 'current';
    const expectedId = `sct-${namespace}-${versionId}`;
    
    return [expectedId];
  }

  createValueSet?(codeSystem: CodeSystem): ValueSet {
    throw new Error('SNOMED CT ValueSet creation is not supported to avoid memory issues');
  }

  /**
   * Find terminology path in SNOMED directory
   */
  private findTerminologyPath(directoryPath: string): string | null {
    const possiblePaths = [
      path.join(directoryPath, 'Full', 'Terminology'),
      path.join(directoryPath, 'Snapshot', 'Terminology'),
      path.join(directoryPath, 'Terminology')
    ];
    
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    }
    
    return null;
  }
}
