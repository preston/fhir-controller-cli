// Author: Preston Lee

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { UploadStrategy, UploadStrategyConfig } from './upload-strategy.js';
import { CodeSystemChunker } from '../utilities/codesystem-chunker.js';
import { getTerminologyEntryByCodeSystem } from '../constants/terminology-registry.js';
import { SNOMED_TERMINOLOGY_INFO } from '../constants/snomed-constants.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

export class StagedUploadStrategy extends UploadStrategy {
  private codeSystemChunker: CodeSystemChunker;

  constructor(config: UploadStrategyConfig) {
    super(config);
    this.codeSystemChunker = new CodeSystemChunker({ verbose: config.verbose });
  }

  /**
   * Upload large resource using staging approach
   */
  async uploadResource(resource: any, fhirUrl: string, resourceType: string): Promise<void> {
    const concepts = resource.concept || [];
    const terminologyType = this.identifyTerminologyType(resource);
    
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} ${terminologyType}: Processing ${concepts.length} concepts with file staging approach`);
    
    // Use the required temp directory
    const stagingDir = `${this.config.tempDir}/fhir-staging-${Date.now()}`;
    
    try {
      // Create staging directory
      this.fileHandler.ensureDirectoryExists(stagingDir);
      console.info(`${LogPrefixes.STAGE_3_UPLOAD} Using staging directory: ${stagingDir}`);
      
      // Stage the complete CodeSystem to temporary file
      const codeSystemFile = path.join(stagingDir, `${resource.id}.json`);
      await this.stageCodeSystemToFile(resource, codeSystemFile);
      
      // Upload the staged CodeSystem file
      await this.uploadStagedCodeSystemFile(codeSystemFile, fhirUrl, resource.id);
      
      console.info(`${LogPrefixes.STAGE_3_UPLOAD} ✓ ${terminologyType} uploaded successfully with ${concepts.length} concepts`);
      
    } finally {
      // Clean up staging directory unless keepTemp is enabled
      if (!this.config.keepTemp) {
        await this.fileHandler.cleanupDirectory(stagingDir);
      } else {
        console.info(`${LogPrefixes.STAGE_3_UPLOAD} Keeping temporary files in: ${stagingDir}`);
      }
    }
  }

  /**
   * Use staged upload for large resources
   */
  shouldUseStrategy(resource: any): boolean {
    if (!resource.concept) {
      return false; // No concepts, use direct upload
    }
    
    const conceptCount = resource.concept.length;
    return conceptCount > 1000; // Use staged upload for large resources
  }

  /**
   * Stage CodeSystem to temporary file using streaming approach
   * This method now handles the case where codeSystem might be too large for memory
   */
  private async stageCodeSystemToFile(codeSystem: any, outputFile: string): Promise<void> {
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Writing CodeSystem to file: ${outputFile}`);
    
    // Create write stream for the output file
    const writeStream = fs.createWriteStream(outputFile);
    
    return new Promise((resolve, reject) => {
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
      
      // Write the CodeSystem header manually to avoid JSON formatting issues
      const header = `{
  "resourceType": "CodeSystem",
  "id": "${codeSystem.id}",
  "url": "${codeSystem.url}",
  "version": "${codeSystem.version}",
  "name": "${codeSystem.name}",
  "status": "${codeSystem.status}",
  "concept": [`;
      
      writeStream.write(header);
      
      // Check if we have concepts to process
      const concepts = codeSystem.concept || [];
      
      if (concepts.length === 0) {
        console.warn(`${LogPrefixes.STAGE_3_UPLOAD} No concepts found in CodeSystem, writing empty concept array`);
        writeStream.write('\n  ]\n}');
        writeStream.end();
        return;
      }
      
      // Stream concepts in batches to avoid memory issues
      const batchSize = 1000;
      
      console.info(`${LogPrefixes.STAGE_3_UPLOAD} CodeSystem has ${concepts.length} concepts to process`);
      
      try {
        for (let i = 0; i < concepts.length; i += batchSize) {
          const batch = concepts.slice(i, i + batchSize);
          
          // Write batch of concepts with proper JSON formatting
          batch.forEach((concept: any, index: number) => {
            const isLast = (i + index === concepts.length - 1);
            const comma = isLast ? '' : ',';
            const conceptJson = JSON.stringify(concept);
            writeStream.write(`\n    ${conceptJson}${comma}`);
          });
          
          // Log progress
          if (i % 10000 === 0) {
            console.info(`${LogPrefixes.STAGE_3_UPLOAD} Processed ${Math.min(i + batchSize, concepts.length)}/${concepts.length} concepts`);
          }
          
          // Force garbage collection for very large datasets
          if (i % 50000 === 0 && global.gc) {
            global.gc();
          }
        }
        
        // Close the concept array and CodeSystem
        writeStream.write('\n  ]\n}');
        writeStream.end();
        
      } catch (error) {
        console.error(`${LogPrefixes.STAGE_3_UPLOAD} Error processing concepts: ${error}`);
        writeStream.write('\n  ]\n}');
        writeStream.end();
        reject(error);
      }
    });
  }


  /**
   * Apply CodeSystem delta add operation
   */
  async applyCodeSystemDeltaAdd(codeSystemId: string, fhirUrl: string, chunkFilePath: string, chunkInfo?: { current: number; total: number }): Promise<void> {
    try {
      // Read the chunk file (small, safe to load)
      const chunkContent = fs.readFileSync(chunkFilePath, 'utf8');
      const concepts = JSON.parse(chunkContent);
      
      // Create Parameters resource for $apply-codesystem-delta-add
      // The operation expects: system (CodeSystem URI) and codeSystem (resource with concepts)
      const parameters = {
        resourceType: 'Parameters',
        parameter: [
          {
            name: 'system',
            valueUri: SNOMED_TERMINOLOGY_INFO.fhirUrls.system // SNOMED CT system URI
          },
          {
            name: 'codeSystem',
            resource: {
              resourceType: 'CodeSystem',
              id: codeSystemId,
              url: SNOMED_TERMINOLOGY_INFO.fhirUrls.system,
              concept: concepts
            }
          }
        ]
      };
      
      // Single consolidated log message
      const chunkProgress = chunkInfo ? `chunk ${chunkInfo.current}/${chunkInfo.total}` : 'chunk';
      console.info(`${LogPrefixes.STAGE_3_UPLOAD} Uploading ${chunkProgress}: ${path.basename(chunkFilePath)} | Applying delta add for CodeSystem ${codeSystemId} with ${concepts.length} concepts to system: ${parameters.parameter[0].valueUri}`);
      
      const response = await axios.post(
        `${fhirUrl}/CodeSystem/$apply-codesystem-delta-add`,
        parameters,
        {
          headers: {
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json',
          },
          timeout: 300000, // 5 minute timeout
        }
      );
      
      console.info(`${LogPrefixes.STAGE_3_UPLOAD} Successfully applied delta add: ${response.status} ${response.statusText}`);
    } catch (error: any) {
      console.error(`${LogPrefixes.STAGE_3_UPLOAD} Failed to apply delta add:`, error?.response?.status, error?.response?.statusText);
      if (error?.response?.data) {
        console.error(JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * Upload staged CodeSystem file to FHIR server using streaming and delta operations
   */
  private async uploadStagedCodeSystemFile(filePath: string, fhirUrl: string, codeSystemId: string): Promise<void> {
    console.info(`${LogPrefixes.STAGING} Uploading staged CodeSystem file using streaming approach: ${filePath}`);
    
    let baseFile = '';
    let chunkFiles: string[] = [];
    
    try {
      // Step 1: Split the large file into base + chunks
      const splitResult = await this.codeSystemChunker.splitCodeSystemFile(filePath, path.dirname(filePath));
      baseFile = splitResult.baseFile;
      chunkFiles = splitResult.chunkFiles;
      
      // Step 2: Upload base CodeSystem (metadata only)
      console.info(`${LogPrefixes.STAGING} Uploading base CodeSystem: ${baseFile}`);
      const baseContent = fs.readFileSync(baseFile, 'utf8');
      const baseCodeSystem = JSON.parse(baseContent);
      
      // Add property definitions if not already present
      if (!baseCodeSystem.property || baseCodeSystem.property.length === 0) {
        console.info(`${LogPrefixes.STAGING} Adding property definitions to base CodeSystem`);
        // Import from chunker if needed
        const { SNOMED_TERMINOLOGY_INFO } = await import('../constants/snomed-constants.js');
        baseCodeSystem.property = [
          {
            code: 'effectiveTime',
            uri: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}#effectiveTime`,
            description: 'The time at which this version of the concept became active',
            type: 'string'
          },
          {
            code: 'active',
            uri: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}#active`,
            description: 'Whether this concept is active',
            type: 'code'
          },
          {
            code: 'moduleId',
            uri: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}#moduleId`,
            description: 'The module that contains this concept',
            type: 'code'
          },
          {
            code: 'definitionStatusId',
            uri: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}#definitionStatusId`,
            description: 'The definition status of this concept (primitive or sufficiently defined)',
            type: 'code'
          },
          {
            code: 'parent',
            uri: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}#parent`,
            description: 'Parent concepts in the SNOMED CT hierarchy (IS-A relationships)',
            type: 'code'
          },
          {
            code: 'child',
            uri: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}#child`,
            description: 'Child concepts in the SNOMED CT hierarchy (inverse IS-A relationships)',
            type: 'code'
          },
          {
            code: 'relationship',
            uri: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}#relationship`,
            description: 'Relationships to other concepts',
            type: 'code'
          }
        ];
      }
      
      await this.fhirClient.uploadResource(baseCodeSystem, fhirUrl, 'CodeSystem');
      console.info(`${LogPrefixes.STAGING} Successfully uploaded base CodeSystem ${codeSystemId}`);
      
      // Step 3: Upload concept chunks using delta operations
      console.info(`${LogPrefixes.STAGING} Uploading ${chunkFiles.length} concept chunks...`);
      for (let i = 0; i < chunkFiles.length; i++) {
        const chunkFile = chunkFiles[i];
        
        await this.applyCodeSystemDeltaAdd(codeSystemId, fhirUrl, chunkFile, { current: i + 1, total: chunkFiles.length });
        
        // Log progress every 10 chunks
        if ((i + 1) % 10 === 0) {
          console.info(`${LogPrefixes.STAGING} Progress: ${i + 1}/${chunkFiles.length} chunks uploaded`);
        }
      }
      
      console.info(`${LogPrefixes.STAGING} Successfully uploaded CodeSystem ${codeSystemId} with ${chunkFiles.length} concept chunks`);
      
      // Step 4: Create and upload ValueSet for all codes in the CodeSystem
      await this.createAndUploadValueSet(baseCodeSystem, fhirUrl);
      
    } catch (error: any) {
      console.error(`${LogPrefixes.STAGING} Failed to upload staged CodeSystem:`, error?.response?.status);
      
      // Cleanup: Delete the CodeSystem if it was created
      if (baseFile && fs.existsSync(baseFile)) {
        try {
          const baseContent = fs.readFileSync(baseFile, 'utf8');
          const baseCodeSystem = JSON.parse(baseContent);
          await this.fhirClient.deleteResource(fhirUrl, 'CodeSystem', baseCodeSystem.id);
        } catch (deleteError) {
          console.warn(`${LogPrefixes.STAGING} Could not delete CodeSystem during cleanup:`, deleteError);
        }
      }
      
      throw error;
    } finally {
      // Clean up chunk files unless keepTemp is set
      if (!this.config.keepTemp) {
        try {
          if (baseFile && fs.existsSync(baseFile)) {
            fs.unlinkSync(baseFile);
          }
          chunkFiles.forEach(chunkFile => {
            if (fs.existsSync(chunkFile)) {
              fs.unlinkSync(chunkFile);
            }
          });
          console.info(`${LogPrefixes.STAGING} Cleaned up temporary files`);
        } catch (cleanupError) {
          console.warn(`${LogPrefixes.STAGING} Could not clean up temporary files:`, cleanupError);
        }
      } else {
        console.info(`${LogPrefixes.STAGING} Keeping temporary files in: ${path.dirname(filePath)}`);
      }
    }
  }

  /**
   * Create and upload ValueSet for all codes in the CodeSystem
   */
  public async createAndUploadValueSet(codeSystem: any, fhirUrl: string): Promise<void> {
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

  /**
   * Create ValueSet that includes all codes from the CodeSystem
   */
  private createValueSetFromCodeSystem(codeSystem: any): any {
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
   */
  private identifyTerminologyType(codeSystem: any): string {
    const terminologyEntry = getTerminologyEntryByCodeSystem(codeSystem);
    return terminologyEntry?.terminologyInfo.identity.terminologyType || 'Unknown';
  }
}
