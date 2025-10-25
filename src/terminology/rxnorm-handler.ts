import type { CodeSystem, ValueSet } from 'fhir/r4';
import { BaseTerminologyHandler, TerminologyHandlerConfig } from './base-terminology-handler.js';
import { TerminologyFileInfo } from '../types/terminology-config.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

export class RxNormHandler extends BaseTerminologyHandler {
  constructor(config: TerminologyHandlerConfig) {
    super(config);
  }

  async processAndUpload(fileInfo: TerminologyFileInfo, fhirUrl: string): Promise<void> {
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Starting RxNorm terminology processing...`);

    // Get expected IDs for potential deletion
    const expectedIds = this.getExpectedIds();
    
    // Delete existing CodeSystems if replace option is enabled
    await this.deleteExistingCodeSystems(fhirUrl, expectedIds);

    const exists = await this.checkExists(fhirUrl);
    if (exists && !this.config.replace) {
      console.info(`${LogPrefixes.SKIP} RxNorm CodeSystem already exists on server, skipping processing`);
      return;
    }

    const codeSystem = await this.processor.processRxNormFile(fileInfo.filePath);
    await this.uploadCodeSystem(codeSystem, fhirUrl);

    if (codeSystem.concept && codeSystem.concept.length > 0) {
      const valueSet = this.createValueSet(codeSystem);
      await this.uploadValueSet(valueSet, fhirUrl);
      console.info(`${LogPrefixes.VALUESET} Successfully created RxNorm ValueSet with ${codeSystem.concept.length} concepts`);
    }

    await this.printResourceSummary(fhirUrl, 'RxNorm');
  }

  async processAndStage(fileInfo: TerminologyFileInfo, stagingDir: string): Promise<string | null> {
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Starting RxNorm terminology staging...`);
    
    // For RxNorm, we can use the direct processing approach since CSV files are manageable
    const codeSystem = await this.processor.processRxNormFile(fileInfo.filePath);
    
    // Write the CodeSystem to staging directory
    const stagedFilePath = `${stagingDir}/rxnorm-current.json`;
    await this.fileHandler.writeJsonFile(stagedFilePath, codeSystem);
    
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Created staged RxNorm file: ${stagedFilePath}`);
    return stagedFilePath;
  }

  async checkExists(fhirUrl: string): Promise<boolean> {
    const expectedId = this.getExpectedIds()[0];
    return await this.fhirClient.checkResourceExists(fhirUrl, 'CodeSystem', expectedId);
  }

  getExpectedIds(): string[] {
    return ['rxnorm-current'];
  }

  createValueSet(codeSystem: CodeSystem): ValueSet {
    return this.processor.createRxNormValueSet(
      codeSystem.concept || [],
      'rxnorm-drugs',
      'RxNorm Drugs',
      'Drugs and medications from RxNorm'
    );
  }
}
