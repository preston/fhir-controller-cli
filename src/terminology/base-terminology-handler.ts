import type { CodeSystem, ValueSet } from 'fhir/r4';
import { TerminologyProcessor } from '../terminology-processor.js';
import { FhirClient } from '../base/fhir-client.js';
import { FileHandler } from '../base/file-handler.js';
import { UploadStrategyFactory } from '../strategies/upload-strategy-factory.js';
import { TerminologyFileInfo } from '../types/terminology-config.js';
import { SNOMED_FHIR_URLS } from '../constants/snomed-constants.js';
import { LOINC_FHIR_URLS } from '../constants/loinc-constants.js';
import { RXNORM_FHIR_URLS } from '../constants/rxnorm-constants.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

export interface TerminologyHandlerConfig {
  dryRun: boolean;
  verbose: boolean;
  tempDir: string;
  keepTemp: boolean;
  replace?: boolean;
  batchSize?: number;
}

export abstract class BaseTerminologyHandler {
  protected fhirClient: FhirClient;
  protected fileHandler: FileHandler;
  protected processor: TerminologyProcessor;
  protected config: TerminologyHandlerConfig;

  constructor(config: TerminologyHandlerConfig) {
    this.config = config;
    this.fhirClient = new FhirClient({
      dryRun: config.dryRun,
      verbose: config.verbose
    });
    this.fileHandler = new FileHandler({
      verbose: config.verbose
    });
    this.processor = new TerminologyProcessor({
      dryRun: config.dryRun,
      verbose: config.verbose,
      batchSize: config.batchSize || 1000
    });
  }

  abstract processAndUpload(fileInfo: TerminologyFileInfo, fhirUrl: string): Promise<void>;

  abstract processAndStage(fileInfo: TerminologyFileInfo, stagingDir: string): Promise<string | null>;

  abstract checkExists(fhirUrl: string): Promise<boolean>;

  abstract getExpectedIds(): string[];

  abstract createValueSet?(codeSystem: CodeSystem): ValueSet;

  protected async uploadCodeSystem(codeSystem: CodeSystem, fhirUrl: string): Promise<void> {
    const strategy = UploadStrategyFactory.createStrategy(codeSystem, {
      dryRun: this.config.dryRun,
      verbose: this.config.verbose,
      tempDir: this.config.tempDir,
      keepTemp: this.config.keepTemp
    });

    await strategy.uploadResource(codeSystem, fhirUrl, 'CodeSystem');
  }

  protected async uploadValueSet(valueSet: ValueSet, fhirUrl: string): Promise<void> {
    await this.fhirClient.uploadResource(valueSet, fhirUrl, 'ValueSet');
  }

  protected async deleteExistingCodeSystems(fhirUrl: string, expectedIds: string[]): Promise<void> {
    if (!this.config.replace) {
      return;
    }

    console.info(`${LogPrefixes.REPLACE} Checking for existing CodeSystems to delete...`);
    
    for (const id of expectedIds) {
      const exists = await this.fhirClient.checkResourceExists(fhirUrl, 'CodeSystem', id);
      if (exists) {
        console.info(`${LogPrefixes.REPLACE} Deleting existing CodeSystem: ${id}`);
        await this.fhirClient.deleteResource(fhirUrl, 'CodeSystem', id);
      }
    }
  }

  protected async printResourceSummary(fhirUrl: string, terminologyType: string): Promise<void> {
    try {
      console.info(`\n${LogPrefixes.SUMMARY} Querying ${terminologyType} resource counts...`);
      
      const codeSystemCount = await this.fhirClient.getResourceCount(fhirUrl, 'CodeSystem');
      
      const valueSetCount = await this.fhirClient.getResourceCount(fhirUrl, 'ValueSet');
      
      const terminologyCodeSystems = await this.queryTerminologyResources(fhirUrl, terminologyType);
      
      console.info(`\n${terminologyType} Import Summary:`);
      console.info(`   CodeSystems: ${terminologyCodeSystems.length}`);
      console.info(`   ValueSets: ${terminologyCodeSystems.length}`);
      
      for (const cs of terminologyCodeSystems) {
        const conceptCount = cs.concept?.length || 0;
        console.info(`   ${cs.id}: ${conceptCount} concepts`);
      }
      
      console.info(`\nTotal Server Resources:`);
      console.info(`   CodeSystems: ${codeSystemCount}`);
      console.info(`   ValueSets: ${valueSetCount}`);
      
    } catch (error: any) {
      console.warn(`${LogPrefixes.SUMMARY} Could not query resource counts: ${error?.response?.status || error.message}`);
    }
  }

  private async queryTerminologyResources(fhirUrl: string, terminologyType: string): Promise<any[]> {
    try {
      let searchParams = '';
      
      switch (terminologyType) {
        case 'SNOMED CT':
          searchParams = `url=${SNOMED_FHIR_URLS.SYSTEM}`;
          break;
        case 'LOINC':
          searchParams = `url=${LOINC_FHIR_URLS.SYSTEM}`;
          break;
        case 'RxNorm':
          searchParams = `url=${RXNORM_FHIR_URLS.SYSTEM}`;
          break;
        default:
          return [];
      }
      
      const axios = require('axios');
      const response = await axios.get(`${fhirUrl}/CodeSystem?${searchParams}`);
      return response.data.entry?.map((entry: any) => entry.resource) || [];
      
    } catch (error: any) {
      console.warn(`${LogPrefixes.SUMMARY} Could not query ${terminologyType} resources: ${error?.response?.status || error.message}`);
      return [];
    }
  }
}
