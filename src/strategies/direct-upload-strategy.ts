// Author: Preston Lee

import { UploadStrategy, UploadStrategyConfig } from './upload-strategy.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

export class DirectUploadStrategy extends UploadStrategy {
  constructor(config: UploadStrategyConfig) {
    super(config);
  }

  /**
   * Upload resource directly using standard FHIR client
   */
  async uploadResource(resource: any, fhirUrl: string, resourceType: string): Promise<void> {
    await this.fhirClient.uploadResource(resource, fhirUrl, resourceType);
  }

  /**
   * Use direct upload for small resources
   */
  shouldUseStrategy(resource: any): boolean {
    if (!resource.concept) {
      return true; // No concepts, safe to upload directly
    }
    
    const conceptCount = resource.concept.length;
    return conceptCount <= 1000; // Use direct upload for small resources
  }

  /**
   * Create and upload ValueSet after CodeSystem upload is complete
   * For direct upload, this happens immediately after CodeSystem upload
   */
  async createAndUploadValueSet(codeSystem: any, fhirUrl: string): Promise<void> {
    try {
      const terminologyType = this.identifyTerminologyType(codeSystem);
      console.info(`${LogPrefixes.VALUESET} Creating ValueSet for ${terminologyType} CodeSystem: ${codeSystem.id}`);
      
      const valueSet = this.createValueSetFromCodeSystem(codeSystem);
      
      // Upload the ValueSet
      await this.fhirClient.uploadResource(valueSet, fhirUrl, 'ValueSet');
      
      console.info(`${LogPrefixes.VALUESET} Successfully created ValueSet: ${valueSet.id} for CodeSystem: ${codeSystem.id}`);
      
    } catch (error: any) {
      console.error(`${LogPrefixes.VALUESET} Failed to create ValueSet for CodeSystem ${codeSystem.id}:`, error?.response?.status || error.message);
      // Don't throw error - ValueSet creation is optional
    }
  }
}
