import fs from 'fs';
import path from 'path';
import { ITerminologyFileReader, TerminologyFileReaderConfig, TerminologyFileInfo, TerminologyReaderResult } from './terminology-file-reader.js';
import { SnomedFileReader } from '../terminology/snomed-file-reader.js';
import { SnomedMetadataExtractor } from '../terminology/snomed-metadata-extractor.js';
import { SnomedConceptBuilder } from '../terminology/snomed-concept-builder.js';
import { SNOMED_FHIR_URLS } from '../constants/snomed-constants.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

export class Rf2FileReader implements ITerminologyFileReader {
  private config: TerminologyFileReaderConfig;
  private snomedFileReader: SnomedFileReader;
  private conceptBuilder: SnomedConceptBuilder;

  constructor(config: TerminologyFileReaderConfig) {
    this.config = config;
    this.snomedFileReader = new SnomedFileReader({ verbose: config.verbose });
    this.conceptBuilder = new SnomedConceptBuilder({ verbose: config.verbose });
  }

  canHandle(fileInfo: TerminologyFileInfo): boolean {
    return fileInfo.fileType === 'snomed' && fileInfo.format === 'rf2';
  }

  getTerminologyType(): 'snomed' | 'loinc' | 'rxnorm' {
    return 'snomed';
  }

  async readFile(fileInfo: TerminologyFileInfo): Promise<TerminologyReaderResult> {
    if (!this.canHandle(fileInfo)) {
      throw new Error('RF2FileReader can only handle SNOMED RF2 files');
    }

    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Starting SNOMED CT terminology processing from: ${fileInfo.filePath}`);

    const directoryPath = fileInfo.filePath;
    const terminologyPath = this.snomedFileReader.findTerminologyPath(directoryPath);
    
    if (!terminologyPath) {
      throw new Error('Could not find terminology files in SNOMED CT directory');
    }

    const version = SnomedMetadataExtractor.extractSnomedVersion(directoryPath);
    const namespace = SnomedMetadataExtractor.extractSnomedNamespace(directoryPath);
    
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_3_UPLOAD} Using SNOMED CT version: ${version}`);
      console.info(`${LogPrefixes.STAGE_3_UPLOAD} Using SNOMED CT namespace: ${namespace}`);
    }

    // Load descriptions and relationships
    const descriptions = await this.snomedFileReader.loadSnomedDescriptions(terminologyPath);
    const relationships = await this.snomedFileReader.loadSnomedRelationships(terminologyPath);

    // Process concepts using streaming approach
    const concepts = await this.processSnomedConceptsStreaming(terminologyPath, descriptions, relationships);

    // Build concept hierarchy
    const mergedConcepts = this.conceptBuilder.buildSnomedConceptHierarchy(
      concepts, 
      Array.from(descriptions.values()).flat(), 
      Array.from(relationships.values()).flat(), 
      []
    );

    // Create CodeSystem
    const codeSystem = this.createSnomedCodeSystem(mergedConcepts, version, namespace);

    return {
      codeSystem,
      processedCount: mergedConcepts.length
    };
  }

  /**
   * Process SNOMED concepts using streaming approach
   */
  private async processSnomedConceptsStreaming(
    terminologyPath: string,
    descriptions: Map<string, any[]>,
    relationships: Map<string, any[]>
  ): Promise<any[]> {
    const conceptFiles = fs.readdirSync(terminologyPath).filter(file => 
      file.startsWith('sct2_Concept_Full_') && file.endsWith('.txt')
    );
    
    if (conceptFiles.length === 0) {
      throw new Error(`No concept file found in ${terminologyPath}`);
    }
    
    const conceptFile = path.join(terminologyPath, conceptFiles[0]);
    const concepts: any[] = [];
    let processedCount = 0;

    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(conceptFile, { encoding: 'utf8' });
      const readline = require('readline');
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      rl.on('line', (line: string) => {
        if (line.trim() === '' || line.includes('id\t') || line.includes('conceptId\t')) {
          return; // Skip empty lines and header
        }

        try {
          const concept = this.parseSnomedConceptLine(line, descriptions, relationships);
          if (concept) {
            concepts.push(concept);
            processedCount++;

            if (processedCount % 10000 === 0 && this.config.verbose) {
              console.info(`${LogPrefixes.STAGE_3_UPLOAD} Processed ${processedCount} concepts`);
            }
          }
        } catch (error) {
          console.warn(`${LogPrefixes.STAGE_3_UPLOAD} Skipping malformed concept line: ${line.substring(0, 100)}...`);
        }
      });

      rl.on('close', () => {
        if (this.config.verbose) {
          console.info(`${LogPrefixes.STAGE_3_UPLOAD} Completed processing ${processedCount} concepts`);
        }
        resolve(concepts);
      });

      rl.on('error', (error) => {
        console.error(`${LogPrefixes.STAGE_3_UPLOAD} Error reading concept file: ${error}`);
        reject(error);
      });
    });
  }

  /**
   * Parse a single SNOMED concept line from RF2 format
   */
  private parseSnomedConceptLine(line: string, descriptions: Map<string, any[]>, relationships: Map<string, any[]>): any | null {
    const fields = line.split('\t');
    if (fields.length < 5) {
      return null;
    }

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
      id,
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
   * Create SNOMED CodeSystem
   */
  private createSnomedCodeSystem(concepts: any[], version: string, namespace: string): any {
    const versionId = version.split('/').pop() || 'unknown';
    const edition = SnomedMetadataExtractor.getSnomedEditionFromNamespace(namespace);
    
    return {
      resourceType: 'CodeSystem',
      id: `sct-${namespace}-${versionId}`,
      url: SNOMED_FHIR_URLS.SYSTEM,
      version: version,
      name: 'SNOMED_CT',
      title: edition,
      status: 'active',
      date: new Date().toISOString().split('T')[0] + 'T00:00:00+00:00',
      publisher: 'SNOMED International',
      hierarchyMeaning: 'is-a',
      compositional: true,
      content: 'complete',
      count: concepts.length,
      concept: concepts,
      property: [
        {
          code: 'effectiveTime',
          uri: `${SNOMED_FHIR_URLS.SYSTEM}#effectiveTime`,
          description: 'The time at which this version of the concept became active',
          type: 'string'
        },
        {
          code: 'moduleId',
          uri: `${SNOMED_FHIR_URLS.SYSTEM}#moduleId`,
          description: 'The module that contains this concept',
          type: 'code'
        },
        {
          code: 'definitionStatusId',
          uri: `${SNOMED_FHIR_URLS.SYSTEM}#definitionStatusId`,
          description: 'The definition status of this concept',
          type: 'code'
        },
        {
          code: 'parent',
          uri: `${SNOMED_FHIR_URLS.SYSTEM}#parent`,
          description: 'Parent concepts in the SNOMED CT hierarchy',
          type: 'code'
        },
        {
          code: 'child',
          uri: `${SNOMED_FHIR_URLS.SYSTEM}#child`,
          description: 'Child concepts in the SNOMED CT hierarchy',
          type: 'code'
        }
      ]
    };
  }
}
