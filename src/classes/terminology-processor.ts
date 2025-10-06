// Author: Preston Lee

import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import csv from 'csv-parser';
import { CodeSystem, ValueSet, ConceptMap, Coding, CodeableConcept } from 'fhir/r4';
import { TerminologyProcessorConfig } from '../types/terminology-config';



export class TerminologyProcessor {
  private config: TerminologyProcessorConfig;

  constructor(config: TerminologyProcessorConfig) {
    this.config = config;
  }

  /**
   * Process LOINC CSV file and create FHIR CodeSystem
   */
  async processLoincFile(filePath: string): Promise<CodeSystem> {
    console.info(`Processing LOINC file: ${filePath}`);
    
    const concepts: any[] = [];
    let processedCount = 0;

    return new Promise((resolve, reject) => {
      createReadStream(filePath)
        .pipe(csv())
        .on('data', (data: any) => {
          if (data.LOINC_NUM && data.LONG_COMMON_NAME) {
            concepts.push({
              code: data.LOINC_NUM,
              display: data.LONG_COMMON_NAME,
              definition: this.buildLoincDefinition(data),
              property: [
                ...(data.COMPONENT ? [{ code: 'component', valueString: data.COMPONENT }] : []),
                ...(data.PROPERTY ? [{ code: 'property', valueString: data.PROPERTY }] : []),
                ...(data.TIME_ASPCT ? [{ code: 'time', valueString: data.TIME_ASPCT }] : []),
                ...(data.SYSTEM ? [{ code: 'system', valueString: data.SYSTEM }] : []),
                ...(data.SCALE_TYP ? [{ code: 'scale', valueString: data.SCALE_TYP }] : []),
                ...(data.METHOD_TYP ? [{ code: 'method', valueString: data.METHOD_TYP }] : []),
                ...(data.CLASS ? [{ code: 'class', valueString: data.CLASS }] : []),
                ...(data.CLASSTYPE ? [{ code: 'classtype', valueString: data.CLASSTYPE }] : [])
              ]
            });
            processedCount++;
            
            if (this.config.verbose && processedCount % 5000 === 0) {
              process.stdout.write('.');
            }
          }
        })
        .on('end', () => {
          console.info(`Finished processing ${processedCount} LOINC concepts`);
          
          // Deduplicate concepts by code to prevent duplicate concepts in CodeSystem
          const uniqueConcepts = new Map();
          concepts.forEach(concept => {
            if (!uniqueConcepts.has(concept.code)) {
              uniqueConcepts.set(concept.code, concept);
            }
          });
          
          console.info(`Deduplicated ${concepts.length} LOINC concepts to ${uniqueConcepts.size} unique concepts`);
          
          const codeSystem = this.createLoincCodeSystem(Array.from(uniqueConcepts.values()));
          resolve(codeSystem);
        })
        .on('error', (error) => {
          console.error('Error processing LOINC file:', error);
          reject(error);
        });
    });
  }

  /**
   * Process SNOMED CT RF2 files and create FHIR CodeSystem
   */
  async processSnomedFile(filePath: string): Promise<CodeSystem> {
    console.info(`Processing SNOMED CT file: ${filePath}`);
    
    const version = this.extractSnomedVersion(filePath);
    console.info(`Extracted SNOMED CT version: ${version}`);
    
    // Check if it's a directory (extracted RF2 files) or a single file
    const stats = require('fs').statSync(filePath);
    
    if (stats.isDirectory()) {
      return this.processSnomedDirectory(filePath, version);
    } else {
      // Single file - process concepts from the file
      console.info(`Processing SNOMED CT single file: ${filePath}`);
      const concepts = await this.processSnomedConceptsFromFile(filePath);
      return this.createSnomedCodeSystem(concepts, version);
    }
  }

  /**
   * Process SNOMED CT concepts from a single file
   */
  private async processSnomedConceptsFromFile(filePath: string): Promise<any[]> {
    console.info(`Processing SNOMED CT concepts from file: ${filePath}`);
    
    const fs = require('fs');
    const readline = require('readline');
    
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    const concepts: any[] = [];
    let lineNumber = 0;
    
    for await (const line of rl) {
      lineNumber++;
      
      // Skip header line
      if (lineNumber === 1) {
        continue;
      }
      
      // Skip empty lines
      if (!line.trim()) {
        continue;
      }
      
      const parts = line.split('\t');
      if (parts.length >= 6) {
        const conceptId = parts[0];
        const effectiveTime = parts[1];
        const active = parts[2];
        
        // Only process active concepts
        if (active === '1') {
          concepts.push({
            code: conceptId,
            display: `SNOMED CT Concept ${conceptId}`,
            definition: `SNOMED CT concept with ID ${conceptId}`,
            effectiveTime: effectiveTime
          });
        }
      }
      
      // Log progress every 10000 concepts
      if (concepts.length % 10000 === 0) {
        console.info(`Processed ${concepts.length} concepts...`);
      }
    }
    
    console.info(`Finished processing ${concepts.length} SNOMED CT concepts`);
    return concepts;
  }

  /**
   * Process SNOMED CT directory with RF2 files
   */
  private async processSnomedDirectory(directoryPath: string, version?: string): Promise<CodeSystem> {
    console.info(`Processing SNOMED CT directory: ${directoryPath}`);
    
    // Look for the terminology files in the expected structure
    const terminologyPath = this.findTerminologyPath(directoryPath);
    if (!terminologyPath) {
      throw new Error('Could not find terminology files in SNOMED CT directory');
    }

    // Process all RF2 components following Snowstorm patterns
    const concepts = await this.processSnomedConcepts(terminologyPath);
    const descriptions = await this.processSnomedDescriptions(terminologyPath);
    const relationships = await this.processSnomedRelationships(terminologyPath);
    const textDefinitions = await this.processSnomedTextDefinitions(terminologyPath);
    
    // Build comprehensive concept hierarchy
    const mergedConcepts = this.buildSnomedConceptHierarchy(concepts, descriptions, relationships, textDefinitions);
    
    console.info(`Processed ${mergedConcepts.length} SNOMED CT concepts with relationships`);
    return this.createSnomedCodeSystem(mergedConcepts, version);
  }

  /**
   * Find the terminology directory path in SNOMED CT structure
   */
  private findTerminologyPath(directoryPath: string): string | null {
    const fs = require('fs');
    const path = require('path');
    
    // Try Full/Terminology first, then Snapshot/Terminology
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
   * Process SNOMED CT concept files
   */
  private async processSnomedConcepts(terminologyPath: string): Promise<any[]> {
    const fs = require('fs');
    const path = require('path');
    
    // Find the concept file
    const conceptFiles = fs.readdirSync(terminologyPath).filter((file: string) => 
      file.startsWith('sct2_Concept_') && file.endsWith('.txt')
    );
    
    if (conceptFiles.length === 0) {
      throw new Error('No concept file found in terminology directory');
    }
    
    const conceptFile = path.join(terminologyPath, conceptFiles[0]);
    console.info(`Processing concept file: ${conceptFile}`);
    
    const concepts: any[] = [];
    let processedCount = 0;
    
    return new Promise((resolve, reject) => {
      createReadStream(conceptFile)
        .pipe(csv({ separator: '\t' }))
        .on('data', (data: any) => {
          if (data.active === '1' && data.id) {
            concepts.push({
              id: data.id,
              effectiveTime: data.effectiveTime,
              active: data.active,
              moduleId: data.moduleId,
              definitionStatusId: data.definitionStatusId
            });
            processedCount++;
            
            if (this.config.verbose && processedCount % 50000 === 0) {
              process.stdout.write('.');
            }
          }
        })
        .on('end', () => {
          console.info(`Finished processing ${processedCount} SNOMED concepts`);
          resolve(concepts);
        })
        .on('error', (error) => {
          console.error('Error processing SNOMED concept file:', error);
          reject(error);
        });
    });
  }

  /**
   * Process SNOMED CT description files
   */
  private async processSnomedDescriptions(terminologyPath: string): Promise<any[]> {
    const fs = require('fs');
    const path = require('path');
    
    // Find the description file
    const descriptionFiles = fs.readdirSync(terminologyPath).filter((file: string) => 
      file.startsWith('sct2_Description_') && file.endsWith('.txt')
    );
    
    if (descriptionFiles.length === 0) {
      console.warn('No description file found, using concept IDs as displays');
      return [];
    }
    
    const descriptionFile = path.join(terminologyPath, descriptionFiles[0]);
    console.info(`Processing description file: ${descriptionFile}`);
    
    const descriptions: any[] = [];
    let processedCount = 0;
    
    return new Promise((resolve, reject) => {
      createReadStream(descriptionFile)
        .pipe(csv({ separator: '\t' }))
        .on('data', (data: any) => {
          if (data.active === '1' && data.conceptId && data.term) {
            descriptions.push({
              conceptId: data.conceptId,
              term: data.term,
              typeId: data.typeId,
              languageCode: data.languageCode
            });
            processedCount++;
            
            if (this.config.verbose && processedCount % 50000 === 0) {
              process.stdout.write('.');
            }
          }
        })
        .on('end', () => {
          console.info(`Finished processing ${processedCount} SNOMED descriptions`);
          resolve(descriptions);
        })
        .on('error', (error) => {
          console.error('Error processing SNOMED description file:', error);
          reject(error);
        });
    });
  }

  /**
   * Process SNOMED CT relationship files
   */
  private async processSnomedRelationships(terminologyPath: string): Promise<any[]> {
    const fs = require('fs');
    const path = require('path');
    
    // Find the relationship file
    const relationshipFiles = fs.readdirSync(terminologyPath).filter((file: string) => 
      file.startsWith('sct2_Relationship_') && file.endsWith('.txt')
    );
    
    if (relationshipFiles.length === 0) {
      console.warn('No relationship file found');
      return [];
    }
    
    const relationshipFile = path.join(terminologyPath, relationshipFiles[0]);
    console.info(`Processing relationship file: ${relationshipFile}`);
    
    const relationships: any[] = [];
    let processedCount = 0;
    
    return new Promise((resolve, reject) => {
      createReadStream(relationshipFile)
        .pipe(csv({ separator: '\t' }))
        .on('data', (data: any) => {
          if (data.active === '1' && data.sourceId && data.destinationId) {
            relationships.push({
              sourceId: data.sourceId,
              destinationId: data.destinationId,
              typeId: data.typeId,
              characteristicTypeId: data.characteristicTypeId,
              relationshipGroup: data.relationshipGroup
            });
            processedCount++;
            
            if (this.config.verbose && processedCount % 50000 === 0) {
              process.stdout.write('.');
            }
          }
        })
        .on('end', () => {
          console.info(`Finished processing ${processedCount} SNOMED relationships`);
          resolve(relationships);
        })
        .on('error', (error) => {
          console.error('Error processing SNOMED relationship file:', error);
          reject(error);
        });
    });
  }

  /**
   * Process SNOMED CT text definition files
   */
  private async processSnomedTextDefinitions(terminologyPath: string): Promise<any[]> {
    const fs = require('fs');
    const path = require('path');
    
    // Find the text definition file
    const textDefFiles = fs.readdirSync(terminologyPath).filter((file: string) => 
      file.startsWith('sct2_TextDefinition_') && file.endsWith('.txt')
    );
    
    if (textDefFiles.length === 0) {
      console.warn('No text definition file found');
      return [];
    }
    
    const textDefFile = path.join(terminologyPath, textDefFiles[0]);
    console.info(`Processing text definition file: ${textDefFile}`);
    
    const textDefinitions: any[] = [];
    let processedCount = 0;
    
    return new Promise((resolve, reject) => {
      createReadStream(textDefFile)
        .pipe(csv({ separator: '\t' }))
        .on('data', (data: any) => {
          if (data.active === '1' && data.conceptId && data.term) {
            textDefinitions.push({
              conceptId: data.conceptId,
              term: data.term,
              typeId: data.typeId
            });
            processedCount++;
            
            if (this.config.verbose && processedCount % 50000 === 0) {
              process.stdout.write('.');
            }
          }
        })
        .on('end', () => {
          console.info(`Finished processing ${processedCount} SNOMED text definitions`);
          resolve(textDefinitions);
        })
        .on('error', (error) => {
          console.error('Error processing SNOMED text definition file:', error);
          reject(error);
        });
    });
  }

  /**
   * Build comprehensive SNOMED concept hierarchy with relationships
   */
  private buildSnomedConceptHierarchy(concepts: any[], descriptions: any[], relationships: any[], textDefinitions: any[]): any[] {
    const descriptionMap = new Map();
    const textDefMap = new Map();
    const relationshipMap = new Map();
    
    // Create maps for efficient lookup
    descriptions.forEach(desc => {
      if (!descriptionMap.has(desc.conceptId) || desc.typeId === '900000000000013009') {
        descriptionMap.set(desc.conceptId, desc.term);
      }
    });
    
    textDefinitions.forEach(def => {
      if (!textDefMap.has(def.conceptId)) {
        textDefMap.set(def.conceptId, def.term);
      }
    });
    
    // Group relationships by source concept
    relationships.forEach(rel => {
      if (!relationshipMap.has(rel.sourceId)) {
        relationshipMap.set(rel.sourceId, []);
      }
      relationshipMap.get(rel.sourceId).push(rel);
    });
    
    // Deduplicate concepts by ID to prevent duplicate concepts in CodeSystem
    const uniqueConcepts = new Map();
    concepts.forEach(concept => {
      if (!uniqueConcepts.has(concept.id)) {
        uniqueConcepts.set(concept.id, concept);
      }
    });
    
    console.info(`Deduplicated ${concepts.length} concepts to ${uniqueConcepts.size} unique concepts`);
    
    // Build concepts with hierarchy information
    // Process ALL concepts - no artificial limits
    const allConcepts = Array.from(uniqueConcepts.values());
    
    console.info(`[DEBUG] Processing ALL ${allConcepts.length} concepts`);
    
    return allConcepts.map(concept => {
      const conceptRelationships = relationshipMap.get(concept.id) || [];
      const isA = conceptRelationships.filter((rel: any) => rel.typeId === '116680003');
      const parentConcepts = isA.map((rel: any) => rel.destinationId);
      
      const conceptDisplay = descriptionMap.get(concept.id) || `SNOMED CT Concept ${concept.id}`;
      const conceptDefinition = textDefMap.get(concept.id) || `SNOMED CT concept ${concept.id}`;
      
      return {
        code: concept.id,
        display: conceptDisplay,
        definition: conceptDefinition,
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
            value: conceptDisplay
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
            value: conceptDisplay
          }
        ],
        property: [
          {
            code: 'effectiveTime',
            valueString: concept.effectiveTime
          },
          {
            code: 'moduleId',
            valueCode: concept.moduleId
          },
          {
            code: 'definitionStatusId',
            valueCode: concept.definitionStatusId
          },
          ...parentConcepts.slice(0, 10).map((parentId: any) => ({
            code: 'parent',
            valueCode: parentId
          })),
          ...conceptRelationships.slice(0, 10).map((rel: any) => ({
            code: 'relationship',
            valueCode: rel.destinationId,
            valueString: this.getRelationshipTypeDisplay(rel.typeId)
          }))
        ]
      };
    });
  }

  /**
   * Get display name for relationship type
   */
  private getRelationshipTypeDisplay(typeId: string): string {
    const relationshipTypes: { [key: string]: string } = {
      '116680003': 'Is a (attribute)',
      '363698007': 'Finding site',
      '363699004': 'Causative agent',
      '363700003': 'Finding method',
      '363701004': 'Procedure site',
      '363702006': 'Has interpretation',
      '363703001': 'Has focus',
      '363704007': 'Has specimen',
      '363705008': 'Subject relationship context',
      '363706009': 'Temporal context',
      '363707000': 'Subject relationship target',
      '363708005': 'Subject relationship source',
      '363709002': 'Subject relationship destination',
      '363710007': 'Subject relationship context',
      '363711006': 'Subject relationship target',
      '363712004': 'Subject relationship source',
      '363713009': 'Subject relationship destination',
      '363714003': 'Subject relationship context',
      '363715002': 'Subject relationship target',
      '363716001': 'Subject relationship source',
      '363717005': 'Subject relationship destination'
    };
    
    return relationshipTypes[typeId] || `Relationship Type ${typeId}`;
  }

  /**
   * Process RxNorm file and create FHIR CodeSystem
   */
  async processRxNormFile(filePath: string): Promise<CodeSystem> {
    console.info(`Processing RxNorm file: ${filePath}`);
    
    const concepts: any[] = [];
    let processedCount = 0;

    return new Promise((resolve, reject) => {
      const rrfData: any[] = [];
      
      createReadStream(filePath)
        .pipe(csv({ separator: '|', headers: false }))
        .on('data', (data: any) => {
          // RXNCONSO.RRF format: RXCUI|LAT|TS|STT|SUI|ISPREF|AUI|SAUI|SCUI|SDUI|SAB|TTY|CODE|STR|SBR|VER|RELEASE|SRL|SUPPRESS|CVF
          // Column positions: 0=RXCUI, 1=LAT, 2=TS, 3=STT, 4=SUI, 5=ISPREF, 6=AUI, 7=SAUI, 8=SCUI, 9=SDUI, 10=SAB, 11=TTY, 12=CODE, 13=STR, 14=SBR, 15=VER, 16=RELEASE, 17=SRL, 18=SUPPRESS, 19=CVF
          const rxcui = data['0'];
          const str = data['13'];
          const sab = data['10'];
          const tty = data['11'];
          const code = data['12'];
          const ispref = data['5'];
          
          if (rxcui && str && rxcui.trim() && str.trim()) {
            rrfData.push({
              rxcui: rxcui.trim(),
              sab: sab ? sab.trim() : '',
              tty: tty ? tty.trim() : '',
              code: code ? code.trim() : '',
              str: str.trim(),
              ispref: ispref ? ispref.trim() : ''
            });
          }
        })
        .on('end', () => {
          // Process the RRF data to create concepts
          const conceptMap = new Map();
          
          rrfData.forEach(item => {
            if (!conceptMap.has(item.rxcui)) {
              conceptMap.set(item.rxcui, {
                code: item.rxcui,
                display: item.str,
                definition: item.str,
                property: [
                  ...(item.tty ? [{ code: 'tty', valueString: item.tty }] : []),
                  ...(item.sab ? [{ code: 'sab', valueString: item.sab }] : []),
                  ...(item.ispref ? [{ code: 'ispref', valueString: item.ispref }] : [])
                ]
              });
            }
          });
          
          // Process concepts in batches to avoid stack overflow
          const conceptValues = Array.from(conceptMap.values());
          for (let i = 0; i < conceptValues.length; i += this.config.batchSize) {
            concepts.push(...conceptValues.slice(i, i + this.config.batchSize));
          }
          processedCount = concepts.length;
          
          console.info(`Finished processing ${processedCount} RxNorm concepts`);
          const codeSystem = this.createRxNormCodeSystem(concepts);
          resolve(codeSystem);
        })
        .on('error', (error) => {
          console.error('Error processing RxNorm file:', error);
          reject(error);
        });
    });
  }

  /**
   * Create LOINC CodeSystem from concepts
   */
  private createLoincCodeSystem(concepts: any[]): CodeSystem {
    return {
      resourceType: 'CodeSystem',
      id: 'loinc-current',
      url: 'http://loinc.org',
      version: 'http://loinc.org/version/current',
      name: 'LOINC',
      title: 'Logical Observation Identifiers Names and Codes',
      status: 'active',
      date: new Date().toISOString().split('T')[0] + 'T00:00:00+00:00',
      publisher: 'Regenstrief Institute',
      description: 'Logical Observation Identifiers Names and Codes (LOINC) is a universal code system for identifying health measurements, observations, and documents.',
      caseSensitive: true,
      compositional: false,
      versionNeeded: false,
      content: 'complete',
      count: concepts.length,
      concept: concepts, // Limit to first 1000 concepts for performance
      property: [
        {
          code: 'tty',
          uri: 'http://loinc.org#tty',
          description: 'Term type',
          type: 'string'
        },
        {
          code: 'sab',
          uri: 'http://loinc.org#sab',
          description: 'Source abbreviation',
          type: 'string'
        }
      ]
    };
  }

  /**
   * Create SNOMED CT CodeSystem following Snowstorm patterns
   */
  private createSnomedCodeSystem(concepts: any[], version?: string): CodeSystem {
    const actualVersion = version || 'http://snomed.info/sct/731000124108/version/20250901';
    const versionId = actualVersion.split('/').pop() || '20250901';
    
    return {
      resourceType: 'CodeSystem',
      id: `sct-731000124108-${versionId}`,
      url: 'http://snomed.info/sct',
      version: actualVersion,
      name: 'SNOMED_CT',
      title: 'United States Edition',
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
          uri: 'http://snomed.info/sct#effectiveTime',
          description: 'The time at which this version of the concept became active',
          type: 'string'
        },
        {
          code: 'moduleId',
          uri: 'http://snomed.info/sct#moduleId',
          description: 'The module that contains this concept',
          type: 'code'
        },
        {
          code: 'definitionStatusId',
          uri: 'http://snomed.info/sct#definitionStatusId',
          description: 'The definition status of this concept',
          type: 'code'
        },
        {
          code: 'parent',
          uri: 'http://snomed.info/sct#parent',
          description: 'Parent concepts in the SNOMED CT hierarchy',
          type: 'code'
        },
        {
          code: 'child',
          uri: 'http://snomed.info/sct#child',
          description: 'Child concepts in the SNOMED CT hierarchy',
          type: 'code'
        }
      ]
    };
  }

  /**
   * Create SNOMED CT ValueSet following Snowstorm patterns
   */
  createSnomedValueSet(concepts: any[], valueSetId: string, title: string, description: string): ValueSet {
    return {
      resourceType: 'ValueSet',
      id: valueSetId,
      url: `http://snomed.info/fhir/ValueSet/${valueSetId}`,
      version: 'http://snomed.info/sct/900000000000207008/version/current',
      name: valueSetId,
      title: title,
      status: 'active',
      publisher: 'SNOMED International',
      contact: [
        {
          name: 'SNOMED International',
          telecom: [
            {
              system: 'url',
              value: 'https://www.snomed.org'
            }
          ]
        }
      ],
      description: description,
      copyright: 'This value set includes content from SNOMED CT, which is copyright © 2002+ International Health Terminology Standards Development Organisation (SNOMED International), and distributed by agreement between SNOMED International and HL7. Implementer use of SNOMED CT is not covered by this agreement.',
      compose: {
        include: [
          {
            system: 'http://snomed.info/sct',
            version: 'http://snomed.info/sct/900000000000207008/version/current',
            concept: concepts.map(concept => ({
              code: concept.code,
              display: concept.display,
              designation: concept.designation
            }))
          }
        ]
      }
    };
  }

  /**
   * Create LOINC ValueSet following Snowstorm patterns
   */
  createLoincValueSet(concepts: any[], valueSetId: string, title: string, description: string): ValueSet {
    return {
      resourceType: 'ValueSet',
      id: valueSetId,
      url: `http://loinc.org/fhir/ValueSet/${valueSetId}`,
      version: 'current',
      name: valueSetId,
      title: title,
      status: 'active',
      publisher: 'Regenstrief Institute',
      contact: [
        {
          name: 'Regenstrief Institute',
          telecom: [
            {
              system: 'url',
              value: 'https://loinc.org'
            }
          ]
        }
      ],
      description: description,
      copyright: 'This value set includes content from LOINC, which is copyright © 1995+ Regenstrief Institute, Inc. and the LOINC Committee, and is available at no cost under the license at https://loinc.org/license/',
      compose: {
        include: [
          {
            system: 'http://loinc.org',
            version: 'current',
            concept: concepts.map(concept => ({
              code: concept.code,
              display: concept.display,
              property: concept.property
            }))
          }
        ]
      }
    };
  }

  /**
   * Create RxNorm ValueSet following Snowstorm patterns
   */
  createRxNormValueSet(concepts: any[], valueSetId: string, title: string, description: string): ValueSet {
    return {
      resourceType: 'ValueSet',
      id: valueSetId,
      url: `http://www.nlm.nih.gov/research/umls/rxnorm/fhir/ValueSet/${valueSetId}`,
      version: 'current',
      name: valueSetId,
      title: title,
      status: 'active',
      publisher: 'National Library of Medicine',
      contact: [
        {
          name: 'National Library of Medicine',
          telecom: [
            {
              system: 'url',
              value: 'https://www.nlm.nih.gov/research/umls/rxnorm/'
            }
          ]
        }
      ],
      description: description,
      copyright: 'This value set includes content from RxNorm, which is copyright © 2001+ National Library of Medicine (NLM), and is available at no cost under the license at https://www.nlm.nih.gov/research/umls/rxnorm/docs/termsofservice.html',
      compose: {
        include: [
          {
            system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
            version: 'current',
            concept: concepts.map(concept => ({
              code: concept.code,
              display: concept.display,
              property: concept.property
            }))
          }
        ]
      }
    };
  }

  /**
   * Create Coding resource following Snowstorm patterns
   */
  createCoding(system: string, code: string, display: string, version?: string): Coding {
    const coding: Coding = {
      system: system,
      code: code,
      display: display
    };

    if (version) {
      coding.version = version;
    }

    return coding;
  }

  /**
   * Create SNOMED CT Coding following Snowstorm patterns
   */
  createSnomedCoding(code: string, display: string, version?: string): Coding {
    return this.createCoding(
      'http://snomed.info/sct',
      code,
      display,
      version || 'http://snomed.info/sct/731000124108/version/20250901'
    );
  }

  /**
   * Create LOINC Coding following Snowstorm patterns
   */
  createLoincCoding(code: string, display: string, version?: string): Coding {
    return this.createCoding(
      'http://loinc.org',
      code,
      display,
      version || 'http://loinc.org/version/current'
    );
  }

  /**
   * Create RxNorm Coding following Snowstorm patterns
   */
  createRxNormCoding(code: string, display: string, version?: string): Coding {
    return this.createCoding(
      'http://www.nlm.nih.gov/research/umls/rxnorm',
      code,
      display,
      version || 'http://www.nlm.nih.gov/research/umls/rxnorm/version/current'
    );
  }

  /**
   * Create RxNorm CodeSystem from concepts
   */
  private createRxNormCodeSystem(concepts: any[]): CodeSystem {
    return {
      resourceType: 'CodeSystem',
      id: 'rxnorm-current',
      url: 'http://www.nlm.nih.gov/research/umls/rxnorm',
      version: 'http://www.nlm.nih.gov/research/umls/rxnorm/version/current',
      name: 'RxNorm',
      title: 'RxNorm',
      status: 'active',
      date: new Date().toISOString().split('T')[0] + 'T00:00:00+00:00',
      publisher: 'National Library of Medicine',
      description: 'RxNorm - Normalized Names for Clinical Drugs',
      caseSensitive: true,
      compositional: false,
      versionNeeded: false,
      content: 'complete',
      count: concepts.length,
      concept: concepts, // Limit to first 1000 concepts for performance
      property: [
        {
          code: 'tty',
          uri: 'http://www.nlm.nih.gov/research/umls/rxnorm#tty',
          description: 'Term type',
          type: 'string'
        },
        {
          code: 'sab',
          uri: 'http://www.nlm.nih.gov/research/umls/rxnorm#sab',
          description: 'Source abbreviation',
          type: 'string'
        }
      ]
    };
  }

  /**
   * Build LOINC concept definition from CSV data
   */
  private buildLoincDefinition(data: any): string {
    let definition = data.LONG_COMMON_NAME;
    
    if (data.COMPONENT) {
      definition += ` (Component: ${data.COMPONENT})`;
    }
    
    if (data.PROPERTY) {
      definition += ` (Property: ${data.PROPERTY})`;
    }
    
    if (data.SYSTEM) {
      definition += ` (System: ${data.SYSTEM})`;
    }
    
    if (data.SCALE_TYP) {
      definition += ` (Scale: ${data.SCALE_TYP})`;
    }
    
    return definition;
  }

  /**
   * Extract version information from SNOMED CT RF2 files
   */
  private extractSnomedVersion(filePath: string): string {
    try {
      // Look for version in the directory name or file headers
      const pathParts = filePath.split('/');
      const dirName = pathParts[pathParts.length - 2] || pathParts[pathParts.length - 1];
      
      // Extract date from directory name like "SnomedCT_ManagedServiceUS_PRODUCTION_US1000124_20250901T120000Z"
      const dateMatch = dirName.match(/(\d{8})/);
      if (dateMatch) {
        const date = dateMatch[1];
        return `http://snomed.info/sct/731000124108/version/${date}`;
      }
      
      // Fallback to current date
      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
      return `http://snomed.info/sct/731000124108/version/${today}`;
    } catch (error) {
      console.warn('Could not extract SNOMED CT version, using fallback');
      return 'http://snomed.info/sct/731000124108/version/current';
    }
  }

  /**
   * Extract version information from LOINC CSV files
   */
  private extractLoincVersion(filePath: string): string {
    try {
      // Look for version in the directory path
      const pathParts = filePath.split('/');
      
      // Look for version in directory names like "Loinc_2.81"
      for (let i = pathParts.length - 1; i >= 0; i--) {
        const part = pathParts[i];
        const versionMatch = part.match(/Loinc_(\d+\.\d+)/);
        if (versionMatch) {
          return `http://loinc.org/version/${versionMatch[1]}`;
        }
      }
      
      // Fallback to current
      return 'http://loinc.org/version/current';
    } catch (error) {
      console.warn('Could not extract LOINC version, using fallback');
      return 'http://loinc.org/version/current';
    }
  }

  /**
   * Extract version information from RxNorm RRF files
   */
  private extractRxNormVersion(filePath: string): string {
    try {
      // Look for version in the directory path
      const pathParts = filePath.split('/');
      
      // Look for date in directory names like "RxNorm_full_09022025"
      for (let i = pathParts.length - 1; i >= 0; i--) {
        const part = pathParts[i];
        const dateMatch = part.match(/(\d{8})/);
        if (dateMatch) {
          const date = dateMatch[1];
          return `http://www.nlm.nih.gov/research/umls/rxnorm/version/${date}`;
        }
      }
      
      // Fallback to current
      return 'http://www.nlm.nih.gov/research/umls/rxnorm/version/current';
    } catch (error) {
      console.warn('Could not extract RxNorm version, using fallback');
      return 'http://www.nlm.nih.gov/research/umls/rxnorm/version/current';
    }
  }

  /**
   * Create generic CodeableConcept resource
   */
  createCodeableConcept(coding: Coding, text?: string): CodeableConcept {
    return {
      coding: [coding],
      text: text || coding.display
    };
  }

  /**
   * Create SNOMED CT CodeableConcept resource
   */
  createSnomedCodeableConcept(code: string, display: string, text?: string, version?: string): CodeableConcept {
    const coding = this.createSnomedCoding(code, display, version);
    return this.createCodeableConcept(coding, text);
  }

  /**
   * Create LOINC CodeableConcept resource
   */
  createLoincCodeableConcept(code: string, display: string, text?: string, version?: string): CodeableConcept {
    const coding = this.createLoincCoding(code, display, version);
    return this.createCodeableConcept(coding, text);
  }

  /**
   * Create RxNorm CodeableConcept resource
   */
  createRxNormCodeableConcept(code: string, display: string, text?: string, version?: string): CodeableConcept {
    const coding = this.createRxNormCoding(code, display, version);
    return this.createCodeableConcept(coding, text);
  }
}
