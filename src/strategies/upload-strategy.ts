// Author: Preston Lee

import { FhirClient } from '../base/fhir-client.js';
import { FileHandler } from '../base/file-handler.js';
import { getTerminologyEntryByCodeSystem } from '../constants/terminology-registry.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

export interface UploadStrategyConfig {
  dryRun: boolean;
  verbose: boolean;
  tempDir: string;
  keepTemp: boolean;
  replace?: boolean;
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

  /**
   * Create and upload ValueSet after CodeSystem upload is complete
   * This ensures ValueSet creation happens after all chunks are uploaded
   */
  abstract createAndUploadValueSet?(codeSystem: any, fhirUrl: string): Promise<void>;

  /**
   * Create ValueSet that includes all codes from the CodeSystem
   * Shared implementation to avoid duplication
   */
  protected createValueSetFromCodeSystem(codeSystem: any): any {
    const terminologyEntry = getTerminologyEntryByCodeSystem(codeSystem);
    const valueSetId = `${codeSystem.id}-valueset`;
    
    if (!terminologyEntry) {
      // Fallback for unknown terminology types
      return {
        resourceType: 'ValueSet',
        id: valueSetId,
        url: `${codeSystem.url.replace('/CodeSystem', '/ValueSet')}/${valueSetId}`,
        version: codeSystem.version,
        name: valueSetId,
        title: `${codeSystem.id} ValueSet - All Codes`,
        status: 'active',
        publisher: 'Unknown',
        description: `ValueSet containing all codes from the CodeSystem ${codeSystem.id}`,
        copyright: '',
        compose: {
          include: [
            {
              system: codeSystem.url,
              version: codeSystem.version
            }
          ]
        }
      };
    }
    
    const { terminologyInfo } = terminologyEntry;
    
    return {
      resourceType: 'ValueSet',
      id: valueSetId,
      url: `${terminologyInfo.fhirUrls.system.replace('/CodeSystem', '/ValueSet')}/${valueSetId}`,
      version: codeSystem.version,
      name: valueSetId,
      title: `${terminologyInfo.identity.displayName} ${terminologyInfo.valueSetMetadata.titleSuffix}`,
      status: 'active',
      publisher: terminologyInfo.publisher.name,
      description: `${terminologyInfo.valueSetMetadata.descriptionPrefix} ${codeSystem.id}`,
      copyright: terminologyInfo.publisher.copyright,
      compose: {
        include: [
          {
            system: terminologyInfo.fhirUrls.system,
            version: codeSystem.version
          }
        ]
      }
    };
  }

  /**
   * Identify terminology type from CodeSystem for better logging
   * Shared implementation to avoid duplication
   */
  protected identifyTerminologyType(codeSystem: any): string {
    const terminologyEntry = getTerminologyEntryByCodeSystem(codeSystem);
    return terminologyEntry?.terminologyInfo.identity.displayName || 'Unknown';
  }
}
