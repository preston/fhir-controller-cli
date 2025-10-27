import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { LogPrefixes } from '../constants/log-prefixes.js';

export interface SnomedFileReaderConfig {
  verbose: boolean;
}

export class SnomedFileReader {
  private config: SnomedFileReaderConfig;

  constructor(config: SnomedFileReaderConfig) {
    this.config = config;
  }

  /**
   * Find terminology path in SNOMED directory
   */
  findTerminologyPath(directoryPath: string): string | null {
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

  /**
   * Load SNOMED descriptions into a Map for efficient lookup
   */
  async loadSnomedDescriptions(terminologyPath: string): Promise<Map<string, any[]>> {
    // Debug: List all files in the directory
    const allFiles = fs.readdirSync(terminologyPath);
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Available files in ${terminologyPath}:`, allFiles);
    }
    
    // Try multiple patterns for description files
    const descriptionFiles = fs.readdirSync(terminologyPath).filter(file => 
      (file.startsWith('sct2_Description_Full') || 
       file.startsWith('sct2_Description_') ||
       (file.includes('Description') && file.endsWith('.txt')))
    );
    
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Found description files:`, descriptionFiles);
    }
    
    if (descriptionFiles.length === 0) {
      console.warn(`${LogPrefixes.STAGE_1_PREPROCESS} No description file found, using fallback display text`);
      return new Map();
    }
    
    const descriptionFile = path.join(terminologyPath, descriptionFiles[0]);
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loading descriptions from: ${descriptionFile}`);
    }
    
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
        if (this.config.verbose) {
          console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loaded ${processedCount} descriptions for ${descriptions.size} concepts`);
        }
        resolve(descriptions);
      });

      rl.on('error', (error) => {
        console.error(`${LogPrefixes.STAGE_1_PREPROCESS} Error reading description file: ${error}`);
        reject(error);
      });
    });
  }

  /**
   * Load SNOMED relationships into a Map for efficient lookup
   */
  async loadSnomedRelationships(terminologyPath: string): Promise<Map<string, any[]>> {
    // Try multiple patterns for relationship files
    const relationshipFiles = fs.readdirSync(terminologyPath).filter(file => 
      (file.startsWith('sct2_Relationship_Full') || 
       file.startsWith('sct2_Relationship_') ||
       (file.includes('Relationship') && file.endsWith('.txt')))
    );
    
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Found relationship files:`, relationshipFiles);
    }
    
    if (relationshipFiles.length === 0) {
      console.warn(`${LogPrefixes.STAGE_1_PREPROCESS} No relationship file found`);
      return new Map();
    }
    
    const relationshipFile = path.join(terminologyPath, relationshipFiles[0]);
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loading relationships from: ${relationshipFile}`);
    }
    
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
        if (this.config.verbose) {
          console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loaded ${processedCount} relationships for ${relationships.size} concepts`);
        }
        if (processedCount === 0) {
          console.warn(`${LogPrefixes.STAGE_1_PREPROCESS} WARNING: No relationships were loaded from ${relationshipFile}`);
          console.warn(`${LogPrefixes.STAGE_1_PREPROCESS} The SNOMED CodeSystem may be missing hierarchical and associative relationship data.`);
        }
        resolve(relationships);
      });

      rl.on('error', (error) => {
        console.error(`${LogPrefixes.STAGE_1_PREPROCESS} Error reading relationship file: ${error}`);
        reject(error);
      });
    });
  }

  /**
   * Process SNOMED concepts using streaming approach with descriptions and relationships
   */
  async processSnomedConceptsStreaming(
    terminologyPath: string, 
    writeStream: fs.WriteStream,
    descriptions: Map<string, any[]>,
    relationships: Map<string, any[]>
  ): Promise<void> {
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Starting comprehensive SNOMED CT processing...`);
    }
    
    // Find the concept file dynamically
    const conceptFiles = fs.readdirSync(terminologyPath).filter(file => 
      file.startsWith('sct2_Concept_Full_') && file.endsWith('.txt')
    );
    
    if (conceptFiles.length === 0) {
      throw new Error(`No concept file found in ${terminologyPath}`);
    }
    
    const conceptFile = path.join(terminologyPath, conceptFiles[0]);
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Using concept file: ${conceptFile}`);
    }

    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Processing concepts from: ${conceptFile}`);
    }
    
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

            if (conceptCount % 10000 === 0 && this.config.verbose) {
              console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Processed ${conceptCount} concepts (including both active and inactive)`);
            }
          } else if (conceptCount < 5 && line.trim() !== '' && this.config.verbose) {
            // Debug: Show first few non-empty lines that aren't being processed due to parsing issues
            const fields = line.split('\t');
            if (fields.length < 5) {
              console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Debug - Skipping line with insufficient fields (${fields.length}): ${line.substring(0, 100)}...`);
            } else {
              console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Debug - Skipping line for unknown reason: ${line.substring(0, 100)}...`);
            }
          }
        } catch (error) {
          console.warn(`${LogPrefixes.STAGE_1_PREPROCESS} Skipping malformed concept line: ${line.substring(0, 100)}...`);
        }
      });

      rl.on('close', () => {
        // Write the last concept without a comma
        if (lastConceptJson) {
          writeStream.write(`\n    ${lastConceptJson}`);
        }
        if (this.config.verbose) {
          console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Completed processing ${conceptCount} concepts`);
        }
        resolve();
      });

      rl.on('error', (error) => {
        console.error(`${LogPrefixes.STAGE_1_PREPROCESS} Error reading concept file: ${error}`);
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

    // Include all concepts regardless of active status
    const conceptDescriptions = descriptions.get(id) || [];
    const conceptRelationships = relationships.get(id) || [];
    
    // Debug logging for relationship processing
    if (conceptRelationships.length > 0 && this.config.verbose && Math.random() < 0.001) {
      // Log 0.1% of concepts with relationships for debugging
      console.log(`${LogPrefixes.STAGE_1_PREPROCESS} Concept ${id} has ${conceptRelationships.length} relationships`);
    }
    
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
        code: 'active',
        valueString: active === '1' ? 'true' : 'false'
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
}
