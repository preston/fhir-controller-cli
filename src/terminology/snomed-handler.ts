import fs from 'fs';
import path from 'path';
import type { CodeSystem, ValueSet } from 'fhir/r4';
import { BaseTerminologyHandler, TerminologyHandlerConfig } from './base-terminology-handler.js';
import { TerminologyFileInfo } from '../types/terminology-config.js';
import { SnomedFileReader } from './snomed-file-reader.js';
import { SnomedMetadataExtractor } from './snomed-metadata-extractor.js';
import { SNOMED_TERMINOLOGY_INFO } from '../constants/snomed-constants.js';
import { getTerminologyEntryByCodeSystem } from '../constants/terminology-registry.js';
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

    // Create ValueSet for all codes in the CodeSystem
    if (codeSystem.concept && codeSystem.concept.length > 0) {
      const valueSet = this.createValueSet(codeSystem);
      await this.uploadValueSet(valueSet, fhirUrl);
      console.info(`${LogPrefixes.VALUESET} Successfully created SNOMED CT ValueSet with ${codeSystem.concept.length} concepts`);
    }

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
    const edition = SnomedMetadataExtractor.getSnomedEditionFromNamespace(namespace);
    const header = `{
  "resourceType": "CodeSystem",
  "id": "${codeSystemId}",
  "url": "http://snomed.info/sct",
  "version": "${version}",
  "name": "SNOMED_CT",
  "title": "${edition}",
  "status": "active",
  "hierarchyMeaning": "is-a",
  "compositional": true,
  "content": "complete",
  "publisher": "SNOMED International",
  "copyright": "This CodeSystem includes content from SNOMED CT, which is copyright © 2002+ International Health Terminology Standards Development Organisation (SNOMED International).",
  "concept": [`;

    // Write header and start concept array
    const writeStream = fs.createWriteStream(stagedFilePath);
    writeStream.write(header);

    // Load descriptions and relationships first
    const descriptions = await this.snomedFileReader.loadSnomedDescriptions(terminologyPath);
    const relationships = await this.snomedFileReader.loadSnomedRelationships(terminologyPath);

    // Process concepts in streaming fashion
    await this.snomedFileReader.processSnomedConceptsStreaming(terminologyPath, writeStream, descriptions, relationships);

    // Close the concept array
    writeStream.write('\n  ]');
    writeStream.end();

    // Wait for the stream to finish writing
    await new Promise<void>((resolve) => {
      writeStream.on('finish', () => resolve());
    });

    // Add property definitions to the CodeSystem
    await this.addPropertyDefinitionsToCodeSystem(stagedFilePath);

    // Add child relationships to concepts
    await this.addChildRelationshipsToConcepts(stagedFilePath);

    return stagedFilePath;
  }

  /**
   * Get SNOMED CT property definitions for the CodeSystem
   */
  private getSnomedPropertyDefinitions(): any[] {
    return [
      {
        code: "effectiveTime",
        uri: "http://snomed.info/sct#effectiveTime",
        description: "The time at which this version of the concept became active",
        type: "string"
      },
      {
        code: "active",
        uri: "http://snomed.info/sct#active",
        description: "Whether this concept is active",
        type: "code"
      },
      {
        code: "moduleId",
        uri: "http://snomed.info/sct#moduleId",
        description: "The module that contains this concept",
        type: "code"
      },
      {
        code: "definitionStatusId",
        uri: "http://snomed.info/sct#definitionStatusId",
        description: "The definition status of this concept (primitive or sufficiently defined)",
        type: "code"
      },
      {
        code: "parent",
        uri: "http://snomed.info/sct#parent",
        description: "Parent concepts in the SNOMED CT hierarchy (IS-A relationships)",
        type: "code"
      },
      {
        code: "child",
        uri: "http://snomed.info/sct#child",
        description: "Child concepts in the SNOMED CT hierarchy (inverse IS-A relationships)",
        type: "code"
      },
      {
        code: "relationship",
        uri: "http://snomed.info/sct#relationship",
        description: "Relationships to other concepts",
        type: "code"
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
      codeSystem.property = this.getSnomedPropertyDefinitions();
      
      // Write back with property definitions
      await fs.promises.writeFile(stagedFilePath, JSON.stringify(codeSystem, null, 2));
    } catch (error: any) {
      console.error(`${LogPrefixes.STAGE_2_SPLIT} Error adding property definitions: ${error.message}`);
      throw error;
    }
  }

  /**
   * Add child relationship properties to concepts after processing is complete
   */
  private async addChildRelationshipsToConcepts(stagedFilePath: string): Promise<void> {
    try {
      // Read and parse the CodeSystem
      const fileContent = await fs.promises.readFile(stagedFilePath, 'utf8');
      const codeSystem = JSON.parse(fileContent);
      
      if (!codeSystem.concept || codeSystem.concept.length === 0) {
        console.warn(`${LogPrefixes.STAGE_2_SPLIT} No concepts found to add child relationships`);
        return;
      }

      // Build a map of concept -> children
      const childMap = new Map<string, string[]>();
      
      // First pass: collect all parent relationships
      codeSystem.concept.forEach((concept: any) => {
        const parentProperties = concept.property?.filter((prop: any) => prop.code === 'parent') || [];
        parentProperties.forEach((prop: any) => {
          const parentId = prop.valueCode;
          if (parentId) {
            if (!childMap.has(parentId)) {
              childMap.set(parentId, []);
            }
            childMap.get(parentId)!.push(concept.code);
          }
        });
      });

      // Second pass: add child properties to each concept
      let conceptsUpdated = 0;
      codeSystem.concept.forEach((concept: any) => {
        const children = childMap.get(concept.code) || [];
        if (children.length > 0) {
          // Add child properties
          children.forEach((childId: string) => {
            if (!concept.property) {
              concept.property = [];
            }
            // Check if child property already exists
            const hasChildProperty = concept.property.some((prop: any) => 
              prop.code === 'child' && prop.valueCode === childId
            );
            if (!hasChildProperty) {
              concept.property.push({
                code: 'child',
                valueCode: childId
              });
              conceptsUpdated++;
            }
          });
        }
      });

      if (this.config.verbose && conceptsUpdated > 0) {
        console.info(`${LogPrefixes.STAGE_2_SPLIT} Added child relationships to ${conceptsUpdated} concept properties`);
      }

      // Write the updated CodeSystem back
      await fs.promises.writeFile(stagedFilePath, JSON.stringify(codeSystem, null, 2));
    } catch (error: any) {
      console.error(`${LogPrefixes.STAGE_2_SPLIT} Error adding child relationships: ${error.message}`);
      throw error;
    }
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

  createValueSet(codeSystem: CodeSystem): ValueSet {
    const terminologyEntry = getTerminologyEntryByCodeSystem(codeSystem);
    const valueSetId = `${codeSystem.id}-valueset`;
    
    if (!terminologyEntry) {
      throw new Error('SNOMED CT terminology entry not found in registry');
    }
    
    const { terminologyInfo } = terminologyEntry;
    
    const baseValueSet = {
      resourceType: 'ValueSet' as const,
      id: valueSetId,
      url: `${terminologyInfo.fhirUrls.system.replace('/sct', '/fhir')}/ValueSet/${valueSetId}`,
      version: codeSystem.version,
      name: valueSetId,
      title: `${terminologyInfo.identity.displayName} ${terminologyInfo.valueSetMetadata.titleSuffix}`,
      status: 'active' as const,
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
    
    // Add contact information for SNOMED CT
    if (terminologyInfo.contact) {
      return {
        ...baseValueSet,
        contact: [
          {
            name: terminologyInfo.contact.name,
            telecom: [
              {
                system: 'url',
                value: terminologyInfo.contact.url
              }
            ]
          }
        ]
      };
    }
    
    return baseValueSet;
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
