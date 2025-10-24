// Author: Preston Lee

import { FhirClient } from '../base/fhir-client.js';
import { FileHandler } from '../base/file-handler.js';

export interface UploadStrategyConfig {
  dryRun: boolean;
  verbose: boolean;
  tempDir: string;
  keepTemp: boolean;
  timeout?: number;
}

export abstract class UploadStrategy {
  protected fhirClient: FhirClient;
  protected fileHandler: FileHandler;
  protected config: UploadStrategyConfig;

  constructor(config: UploadStrategyConfig) {
    this.config = config;
    this.fhirClient = new FhirClient({
      dryRun: config.dryRun,
      verbose: config.verbose,
      timeout: config.timeout
    });
    this.fileHandler = new FileHandler({
      verbose: config.verbose
    });
  }

  /**
   * Upload a FHIR resource using the appropriate strategy
   */
  abstract uploadResource(resource: any, fhirUrl: string, resourceType: string): Promise<void>;

  /**
   * Check if this strategy should be used for the given resource
   */
  abstract shouldUseStrategy(resource: any): boolean;
}
