// Author: Preston Lee

import axios from 'axios';
import type { CodeSystem, ValueSet, ConceptMap } from 'fhir/r4';

export interface FhirClientConfig {
  dryRun: boolean;
  verbose: boolean;
  timeout?: number;
}

export class FhirClient {
  protected config: FhirClientConfig;

  constructor(config: FhirClientConfig) {
    this.config = config;
  }

  /**
   * Check if a FHIR resource already exists on the server
   */
  async checkResourceExists(fhirUrl: string, resourceType: string, resourceId: string): Promise<boolean> {
    try {
      const response = await axios.get(
        `${fhirUrl}/${resourceType}/${resourceId}`,
        {
          headers: {
            'Accept': 'application/fhir+json',
          },
        }
      );
      return response.status === 200;
    } catch (error: any) {
      if (error?.response?.status === 404) {
        return false; // Resource doesn't exist
      }
      // For other errors, log but don't fail
      console.warn(`Warning: Could not check if ${resourceType} ${resourceId} exists: ${error?.response?.status}`);
      return false;
    }
  }

  /**
   * Upload a single FHIR resource
   */
  async uploadResource(resource: any, fhirUrl: string, resourceType: string): Promise<void> {
    if (this.config.dryRun) {
      console.log(`[DRY RUN] Would upload ${resourceType} to ${fhirUrl}/${resourceType}`);
      if (this.config.verbose) {
        console.log(JSON.stringify(resource, null, 2));
      }
      return;
    }

    // Check if resource already exists
    const exists = await this.checkResourceExists(fhirUrl, resourceType, resource.id);
    if (exists) {
      console.info(`[SKIP] ${resourceType} ${resource.id} already exists on server, skipping upload`);
      return;
    }

    try {
      // Add debugging information
      console.info(`[DEBUG] Uploading ${resourceType} ${resource.id} with ${resource.concept?.length || 0} concepts`);
      
      // Validate resource structure
      if (!resource.id || !resource.resourceType) {
        throw new Error('Invalid resource: missing id or resourceType');
      }
      
      // Check for circular references using safe stringify
      try {
        this.safeStringify(resource);
      } catch (circularError) {
        throw new Error('Resource contains circular references');
      }
      
      // Check resource size
      const resourceSize = this.safeStringify(resource).length;
      console.info(`[DEBUG] Resource size: ${(resourceSize / 1024 / 1024).toFixed(2)} MB`);
      
      if (resourceSize > 50 * 1024 * 1024) { // 50MB limit
        console.warn(`[WARNING] Resource is very large (${(resourceSize / 1024 / 1024).toFixed(2)} MB), this may cause issues`);
      }
      
      const response = await axios.put(
        `${fhirUrl}/${resourceType}/${resource.id}`,
        resource,
        {
          headers: {
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json',
          },
          timeout: this.config.timeout || 300000, // 5 minute timeout for large resources
        }
      );
      console.info(`[SUCCESS] Uploaded ${resourceType} ${resource.id}: ${response.status} ${response.statusText}`);
    } catch (error: any) {
      console.error(`[FAILURE] Uploading ${resourceType} ${resource.id}:`, error?.response?.status, error?.response?.statusText);
      if (error?.response?.data) {
        console.error(JSON.stringify(error.response.data, null, 2));
      }
      if (error?.code === 'ECONNABORTED') {
        console.error('[ERROR] Request timed out - resource may be too large');
      }
      if (error?.message?.includes('JSON.stringify')) {
        console.error('[ERROR] Resource contains circular references or invalid data');
      }
      throw error;
    }
  }

  /**
   * Delete a FHIR resource
   */
  async deleteResource(fhirUrl: string, resourceType: string, resourceId: string): Promise<void> {
    console.info(`[CLEANUP] Deleting ${resourceType} ${resourceId}`);
    
    try {
      const response = await axios.delete(
        `${fhirUrl}/${resourceType}/${resourceId}`,
        {
          headers: {
            'Accept': 'application/fhir+json',
          },
          timeout: 60000, // 1 minute timeout
        }
      );
      
      console.info(`[CLEANUP] Successfully deleted ${resourceType}: ${response.status} ${response.statusText}`);
    } catch (error: any) {
      console.error(`[CLEANUP] Failed to delete ${resourceType}:`, error?.response?.status, error?.response?.statusText);
      // Don't throw - cleanup failure shouldn't prevent error reporting
    }
  }

  /**
   * Query server for resource counts
   */
  async getResourceCount(fhirUrl: string, resourceType: string): Promise<number> {
    try {
      const response = await axios.get(`${fhirUrl}/${resourceType}?_summary=count`);
      return response.data.total || 0;
    } catch (error: any) {
      console.warn(`[SUMMARY] Could not query ${resourceType} count: ${error?.response?.status || error.message}`);
      return 0;
    }
  }

  /**
   * Safe JSON stringify that handles circular references
   */
  protected safeStringify(obj: any): string {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular Reference]';
        }
        seen.add(value);
      }
      return value;
    });
  }
}
