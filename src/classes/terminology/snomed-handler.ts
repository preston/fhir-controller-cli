import fs from 'fs';
import path from 'path';
import readline from 'readline';
import type { CodeSystem, ValueSet } from 'fhir/r4';
import { BaseTerminologyHandler, TerminologyHandlerConfig } from './base-terminology-handler.js';
import { TerminologyFileInfo } from '../../types/terminology-config.js';
import { LogPrefixes } from '../../constants/log-prefixes.js';

export class SnomedHandler extends BaseTerminologyHandler {
  constructor(config: TerminologyHandlerConfig) {
    super(config);
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
    
    const terminologyPath = this.findTerminologyPath(directoryPath);
    if (!terminologyPath) {
      throw new Error('Could not find terminology files in SNOMED CT directory');
    }

    const version = this.processor.extractSnomedVersion(directoryPath);
    const namespace = this.processor.extractSnomedNamespace(directoryPath);
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

    // Process concepts in streaming fashion
    await this.processSnomedConceptsStreaming(terminologyPath, writeStream);

    // Close the concept array and CodeSystem
    writeStream.write('\n  ]\n}');
    writeStream.end();

    // Wait for the stream to finish writing
    await new Promise<void>((resolve) => {
      writeStream.on('finish', () => resolve());
    });

    return stagedFilePath;
  }

  /**
   * Process SNOMED concepts using streaming approach with descriptions and relationships
   */
  private async processSnomedConceptsStreaming(terminologyPath: string, writeStream: fs.WriteStream): Promise<void> {
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Starting comprehensive SNOMED CT processing...`);
    
    // First, load descriptions and relationships into memory for lookup
    const descriptions = await this.loadSnomedDescriptions(terminologyPath);
    const relationships = await this.loadSnomedRelationships(terminologyPath);
    
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Loaded ${descriptions.size} descriptions and ${relationships.size} relationships`);
    
    // Find the concept file dynamically
    const conceptFiles = fs.readdirSync(terminologyPath).filter(file => 
      file.startsWith('sct2_Concept_Full_') && file.endsWith('.txt')
    );
    
    if (conceptFiles.length === 0) {
      throw new Error(`No concept file found in ${terminologyPath}`);
    }
    
    const conceptFile = path.join(terminologyPath, conceptFiles[0]);
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Using concept file: ${conceptFile}`);

    console.info(`${LogPrefixes.STAGE_2_SPLIT} Processing concepts from: ${conceptFile}`);
    
    const fileStream = fs.createReadStream(conceptFile, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let conceptCount = 0;
    let lastConceptJson = '';

    return new Promise((resolve, reject) => {
      rl.on('line', (line: string) => {
        if (line.trim() === '' || line.includes('id\t') || line.includes('conceptId\t')) {
          return; // Skip empty lines and header
        }

        try {
          const concept = this.parseSnomedConceptLineWithData(line, descriptions, relationships);
          if (concept) {
            const conceptJson = JSON.stringify(concept);
            
            // If we have a previous concept, write it with a comma
            if (lastConceptJson) {
              writeStream.write(`\n    ${lastConceptJson},`);
            }
            
            // Store this concept to write later (without comma)
            lastConceptJson = conceptJson;
            conceptCount++;

            if (conceptCount % 10000 === 0) {
              console.info(`${LogPrefixes.STAGE_2_SPLIT} Processed ${conceptCount} concepts`);
            }
          } else if (conceptCount < 5 && line.trim() !== '') {
            // Debug: Show first few non-empty lines that aren't being processed
            console.info(`${LogPrefixes.STAGE_2_SPLIT} Debug - Skipping line: ${line.substring(0, 100)}...`);
          }
        } catch (error) {
          console.warn(`${LogPrefixes.STAGE_2_SPLIT} Skipping malformed concept line: ${line.substring(0, 100)}...`);
        }
      });

      rl.on('close', () => {
        // Write the last concept without a comma
        if (lastConceptJson) {
          writeStream.write(`\n    ${lastConceptJson}`);
        }
        console.info(`${LogPrefixes.STAGE_2_SPLIT} Completed processing ${conceptCount} concepts`);
        resolve();
      });

      rl.on('error', (error) => {
        console.error(`${LogPrefixes.STAGE_2_SPLIT} Error reading concept file: ${error}`);
        reject(error);
      });
    });
  }

  /**
   * Load SNOMED descriptions into a Map for efficient lookup
   */
  private async loadSnomedDescriptions(terminologyPath: string): Promise<Map<string, any[]>> {
    // Debug: List all files in the directory
    const allFiles = fs.readdirSync(terminologyPath);
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Available files in ${terminologyPath}:`, allFiles);
    
    // Try multiple patterns for description files
    const descriptionFiles = fs.readdirSync(terminologyPath).filter(file => 
      (file.startsWith('sct2_Description_Full') || 
       file.startsWith('sct2_Description_') ||
       (file.includes('Description') && file.endsWith('.txt')))
    );
    
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Found description files:`, descriptionFiles);
    
    if (descriptionFiles.length === 0) {
      console.warn(`${LogPrefixes.STAGE_2_SPLIT} No description file found, using fallback display text`);
      return new Map();
    }
    
    const descriptionFile = path.join(terminologyPath, descriptionFiles[0]);
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Loading descriptions from: ${descriptionFile}`);
    
    const descriptions = new Map<string, any[]>();
    let processedCount = 0;
    
    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(descriptionFile, { encoding: 'utf8' });
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      rl.on('line', (line: string) => {
        if (line.trim() === '' || line.includes('id\t') || line.includes('conceptId\t')) {
          return; // Skip empty lines and header
        }

        try {
          const fields = line.split('\t');
          if (fields.length >= 9) {
            const [id, effectiveTime, active, moduleId, conceptId, languageCode, typeId, term, caseSignificanceId] = fields;
            
            if (active === '1' && conceptId && term) {
              if (!descriptions.has(conceptId)) {
                descriptions.set(conceptId, []);
              }
              
              descriptions.get(conceptId)!.push({
                id,
                effectiveTime,
                active,
                moduleId,
                conceptId,
                languageCode,
                typeId,
                term,
                caseSignificanceId
              });
              
              processedCount++;
            }
          }
        } catch (error) {
          // Skip malformed lines
        }
      });

      rl.on('close', () => {
        console.info(`${LogPrefixes.STAGE_2_SPLIT} Loaded ${processedCount} descriptions for ${descriptions.size} concepts`);
        resolve(descriptions);
      });

      rl.on('error', (error) => {
        console.error(`${LogPrefixes.STAGE_2_SPLIT} Error reading description file: ${error}`);
        reject(error);
      });
    });
  }

  /**
   * Load SNOMED relationships into a Map for efficient lookup
   */
  private async loadSnomedRelationships(terminologyPath: string): Promise<Map<string, any[]>> {
    // Try multiple patterns for relationship files
    const relationshipFiles = fs.readdirSync(terminologyPath).filter(file => 
      (file.startsWith('sct2_Relationship_Full') || 
       file.startsWith('sct2_Relationship_') ||
       (file.includes('Relationship') && file.endsWith('.txt')))
    );
    
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Found relationship files:`, relationshipFiles);
    
    if (relationshipFiles.length === 0) {
      console.warn(`${LogPrefixes.STAGE_2_SPLIT} No relationship file found`);
      return new Map();
    }
    
    const relationshipFile = path.join(terminologyPath, relationshipFiles[0]);
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Loading relationships from: ${relationshipFile}`);
    
    const relationships = new Map<string, any[]>();
    let processedCount = 0;
    
    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(relationshipFile, { encoding: 'utf8' });
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      rl.on('line', (line: string) => {
        if (line.trim() === '' || line.includes('id\t') || line.includes('conceptId\t')) {
          return; // Skip empty lines and header
        }

        try {
          const fields = line.split('\t');
          if (fields.length >= 10) {
            const [id, effectiveTime, active, moduleId, sourceId, destinationId, relationshipGroup, typeId, characteristicTypeId, modifierId] = fields;
            
            if (active === '1' && sourceId && destinationId) {
              if (!relationships.has(sourceId)) {
                relationships.set(sourceId, []);
              }
              
              relationships.get(sourceId)!.push({
                id,
                effectiveTime,
                active,
                moduleId,
                sourceId,
                destinationId,
                relationshipGroup,
                typeId,
                characteristicTypeId,
                modifierId
              });
              
              processedCount++;
            }
          }
        } catch (error) {
          // Skip malformed lines
        }
      });

      rl.on('close', () => {
        console.info(`${LogPrefixes.STAGE_2_SPLIT} Loaded ${processedCount} relationships for ${relationships.size} concepts`);
        resolve(relationships);
      });

      rl.on('error', (error) => {
        console.error(`${LogPrefixes.STAGE_2_SPLIT} Error reading relationship file: ${error}`);
        reject(error);
      });
    });
  }

  /**
   * Parse a single SNOMED concept line from RF2 format with descriptions and relationships
   */
  private parseSnomedConceptLineWithData(line: string, descriptions: Map<string, any[]>, relationships: Map<string, any[]>): any | null {
    const fields = line.split('\t');
    if (fields.length < 5) {
      return null;
    }

    // SNOMED CT RF2 concept file format: id	effectiveTime	active	moduleId	definitionStatusId
    const [id, effectiveTime, active, moduleId, definitionStatusId] = fields;

    if (active !== '1') {
      return null; // Skip inactive concepts
    }

    const conceptDescriptions = descriptions.get(id) || [];
    const conceptRelationships = relationships.get(id) || [];
    
    // Find the best display text
    const fullySpecifiedName = conceptDescriptions.find(desc => 
      desc.typeId === '900000000000003001' && desc.languageCode === 'en'
    );
    const preferredTerm = conceptDescriptions.find(desc => 
      desc.typeId === '900000000000013009' && desc.languageCode === 'en'
    );
    
    const displayText = fullySpecifiedName?.term || preferredTerm?.term || `SNOMED CT Concept ${id}`;
    const definitionText = fullySpecifiedName?.term || preferredTerm?.term || `SNOMED CT concept ${id}`;
    
    // Build designations from descriptions
    const designations = conceptDescriptions
      .filter(desc => desc.languageCode === 'en' && desc.term)
      .map(desc => {
        const isFullySpecified = desc.typeId === '900000000000003001';
        const isSynonym = desc.typeId === '900000000000013009';
        
        return {
          extension: [
            {
              url: 'http://snomed.info/fhir/StructureDefinition/designation-use-context',
              extension: [
                {
                  url: 'context',
                  valueCoding: {
                    system: 'http://snomed.info/sct',
                    code: '900000000000509007'
                  }
                },
                {
                  url: 'role',
                  valueCoding: {
                    system: 'http://snomed.info/sct',
                    code: '900000000000548007',
                    display: 'PREFERRED'
                  }
                },
                {
                  url: 'type',
                  valueCoding: {
                    system: 'http://snomed.info/sct',
                    code: desc.typeId,
                    display: isFullySpecified ? 'Fully specified name' : 'Synonym'
                  }
                }
              ]
            }
          ],
          language: 'en',
          use: {
            system: 'http://snomed.info/sct',
            code: desc.typeId,
            display: isFullySpecified ? 'Fully specified name' : 'Synonym'
          },
          value: desc.term
        };
      });

    // Build properties including relationships
    const properties = [
      {
        code: 'effectiveTime',
        valueString: effectiveTime
      },
      {
        code: 'moduleId',
        valueCode: moduleId
      },
      {
        code: 'definitionStatusId',
        valueCode: definitionStatusId
      }
    ];

    // Add relationship properties
    conceptRelationships.forEach(rel => {
      if (rel.typeId === '116680003') { // IS_A relationship
        properties.push({
          code: 'parent',
          valueCode: rel.destinationId
        });
      } else {
        properties.push({
          code: 'relationship',
          valueCode: rel.typeId,
          valueString: rel.destinationId
        });
      }
    });

    return {
      code: id,
      display: displayText,
      definition: definitionText,
      designation: designations.length > 0 ? designations : [
        {
          extension: [
            {
              url: 'http://snomed.info/fhir/StructureDefinition/designation-use-context',
              extension: [
                {
                  url: 'context',
                  valueCoding: {
                    system: 'http://snomed.info/sct',
                    code: '900000000000509007'
                  }
                },
                {
                  url: 'role',
                  valueCoding: {
                    system: 'http://snomed.info/sct',
                    code: '900000000000548007',
                    display: 'PREFERRED'
                  }
                },
                {
                  url: 'type',
                  valueCoding: {
                    system: 'http://snomed.info/sct',
                    code: '900000000000003001',
                    display: 'Fully specified name'
                  }
                }
              ]
            }
          ],
          language: 'en',
          use: {
            system: 'http://snomed.info/sct',
            code: '900000000000003001',
            display: 'Fully specified name'
          },
          value: displayText
        }
      ],
      property: properties
    };
  }

  /**
   * Parse a single SNOMED concept line from RF2 format (legacy method for backward compatibility)
   */
  private parseSnomedConceptLine(line: string): any | null {
    const fields = line.split('\t');
    if (fields.length < 5) {
      return null;
    }

    // SNOMED CT RF2 concept file format: id	effectiveTime	active	moduleId	definitionStatusId
    const [id, effectiveTime, active, moduleId, definitionStatusId] = fields;

    if (active !== '1') {
      return null; // Skip inactive concepts
    }

    return {
      code: id,
      display: `SNOMED CT Concept ${id}`,
      definition: `SNOMED CT concept ${id}`,
      designation: [
        {
          extension: [
            {
              url: 'http://snomed.info/fhir/StructureDefinition/designation-use-context',
              extension: [
                {
                  url: 'context',
                  valueCoding: {
                    system: 'http://snomed.info/sct',
                    code: '900000000000509007'
                  }
                },
                {
                  url: 'role',
                  valueCoding: {
                    system: 'http://snomed.info/sct',
                    code: '900000000000548007',
                    display: 'PREFERRED'
                  }
                },
                {
                  url: 'type',
                  valueCoding: {
                    system: 'http://snomed.info/sct',
                    code: '900000000000003001',
                    display: 'Fully specified name'
                  }
                }
              ]
            }
          ],
          language: 'en',
          use: {
            system: 'http://snomed.info/sct',
            code: '900000000000003001',
            display: 'Fully specified name'
          },
          value: `SNOMED CT Concept ${id}`
        },
        {
          extension: [
            {
              url: 'http://snomed.info/fhir/StructureDefinition/designation-use-context',
              extension: [
                {
                  url: 'context',
                  valueCoding: {
                    system: 'http://snomed.info/sct',
                    code: '900000000000509007'
                  }
                },
                {
                  url: 'role',
                  valueCoding: {
                    system: 'http://snomed.info/sct',
                    code: '900000000000548007',
                    display: 'PREFERRED'
                  }
                },
                {
                  url: 'type',
                  valueCoding: {
                    system: 'http://snomed.info/sct',
                    code: '900000000000013009',
                    display: 'Synonym'
                  }
                }
              ]
            }
          ],
          language: 'en',
          use: {
            system: 'http://snomed.info/sct',
            code: '900000000000013009',
            display: 'Synonym'
          },
          value: `SNOMED CT Concept ${id}`
        }
      ],
      property: [
        {
          code: 'effectiveTime',
          valueString: effectiveTime
        },
        {
          code: 'moduleId',
          valueCode: moduleId
        },
        {
          code: 'definitionStatusId',
          valueCode: definitionStatusId
        }
      ]
    };
  }

  async checkExists(fhirUrl: string, directoryPath?: string): Promise<boolean> {
    if (directoryPath) {
      const version = this.processor.extractSnomedVersion(directoryPath);
      const namespace = this.processor.extractSnomedNamespace(directoryPath);
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
