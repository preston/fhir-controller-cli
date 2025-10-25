// Author: Preston Lee

import { UploadStrategy, UploadStrategyConfig } from './upload-strategy.js';

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
}
