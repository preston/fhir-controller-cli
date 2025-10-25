import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import csv from 'csv-parser';
import readline from 'readline';
import type { CodeSystem, ValueSet, ConceptMap, Coding, CodeableConcept } from 'fhir/r4';
import { TerminologyProcessorConfig } from './types/terminology-config.js';
import { 
  SNOMED_CONCEPT_IDS, 
  SNOMED_TERMINOLOGY_INFO, 
  SNOMED_RELATIONSHIP_TYPES, 
  SNOMED_DISPLAY_NAMES, 
  SNOMED_LANGUAGES, 
  SNOMED_PROPERTY_CODES 
} from './constants/snomed-constants.js';
import { 
  LOINC_TERMINOLOGY_INFO, 
  LOINC_PROPERTY_CODES
} from './constants/loinc-constants.js';
import { 
  RXNORM_TERMINOLOGY_INFO, 
  RXNORM_PROPERTY_CODES,
  RXNORM_RRF_FIELDS 
} from './constants/rxnorm-constants.js';

export class TerminologyProcessor {
  private config: TerminologyProcessorConfig;

  constructor(config: TerminologyProcessorConfig) {
    this.config = config;
  }

  async processLoincFile(filePath: string): Promise<CodeSystem> {
    console.info(`Starting LOINC terminology processing from: ${filePath}`);
    
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
                ...(data.COMPONENT ? [{ code: LOINC_PROPERTY_CODES.COMPONENT, valueString: data.COMPONENT }] : []),
                ...(data.PROPERTY ? [{ code: LOINC_PROPERTY_CODES.PROPERTY, valueString: data.PROPERTY }] : []),
                ...(data.TIME_ASPCT ? [{ code: LOINC_PROPERTY_CODES.TIME, valueString: data.TIME_ASPCT }] : []),
                ...(data.SYSTEM ? [{ code: LOINC_PROPERTY_CODES.SYSTEM, valueString: data.SYSTEM }] : []),
                ...(data.SCALE_TYP ? [{ code: LOINC_PROPERTY_CODES.SCALE, valueString: data.SCALE_TYP }] : []),
                ...(data.METHOD_TYP ? [{ code: LOINC_PROPERTY_CODES.METHOD, valueString: data.METHOD_TYP }] : []),
                ...(data.CLASS ? [{ code: LOINC_PROPERTY_CODES.CLASS, valueString: data.CLASS }] : []),
                ...(data.CLASSTYPE ? [{ code: LOINC_PROPERTY_CODES.CLASSTYPE, valueString: data.CLASSTYPE }] : [])
              ]
            });
            processedCount++;
            
            if (this.config.verbose && processedCount % 5000 === 0) {
              process.stdout.write('.');
            }
          }
        })
        .on('end', () => {
          console.info(`Successfully processed ${processedCount} LOINC concepts from file`);
          
          const uniqueConcepts = new Map();
          concepts.forEach(concept => {
            if (!uniqueConcepts.has(concept.code)) {
              uniqueConcepts.set(concept.code, concept);
            }
          });
          
          console.info(`Deduplicated LOINC concepts: ${concepts.length} → ${uniqueConcepts.size} unique concepts`);
          
          const codeSystem = this.createLoincCodeSystem(Array.from(uniqueConcepts.values()));
          resolve(codeSystem);
        })
        .on('error', (error) => {
          console.error('Failed to process LOINC file:', error);
          reject(error);
        });
    });
  }

  async processSnomedFile(filePath: string): Promise<CodeSystem> {
    console.info(`Starting SNOMED CT terminology processing from: ${filePath}`);
    
    const version = this.extractSnomedVersion(filePath);
    console.info(`Detected SNOMED CT version: ${version}`);
    
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      return this.processSnomedDirectory(filePath, version);
    } else {
      console.info(`Processing single SNOMED CT file: ${filePath}`);
      const concepts = await this.processSnomedConceptsFromFile(filePath);
      return this.createSnomedCodeSystem(concepts, version);
    }
  }

  private async processSnomedConceptsFromFile(filePath: string): Promise<any[]> {
    console.info(`Reading SNOMED CT concepts from file: ${filePath}`);
    
    const concepts: any[] = [];
    let lineNumber = 0;
    
    try {
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
      
      for await (const line of rl) {
        lineNumber++;
        
        if (lineNumber === 1) {
          continue;
        }
        
        if (!line.trim()) {
          continue;
        }
      
        const parts = line.split('\t');
        if (parts.length >= 5) {
          const conceptId = parts[0];
          const effectiveTime = parts[1];
          const active = parts[2];
          
          if (active === '1') {
            concepts.push({
              code: conceptId,
              display: `SNOMED CT Concept ${conceptId}`,
              definition: `SNOMED CT concept with ID ${conceptId}`,
              effectiveTime: effectiveTime
            });
          }
        }
        
        if (concepts.length % 10000 === 0) {
          console.info(`Progress: ${concepts.length} SNOMED CT concepts processed...`);
        }
      }
      
      rl.close();
      fileStream.close();
      
    } catch (error) {
      console.error(`Failed to process SNOMED CT file ${filePath}:`, error);
      throw error;
    }
    
    console.info(`Successfully completed processing ${concepts.length} SNOMED CT concepts`);
    return concepts;
  }

  async processSnomedDirectory(directoryPath: string, version?: string): Promise<CodeSystem> {
    console.info(`Starting SNOMED CT directory processing: ${directoryPath}`);
    
    const terminologyPath = this.findTerminologyPath(directoryPath);
    if (!terminologyPath) {
      throw new Error('Could not find terminology files in SNOMED CT directory');
    }

    const actualVersion = version || this.extractSnomedVersion(directoryPath);
    const actualNamespace = this.extractSnomedNamespace(directoryPath);
    console.info(`Using SNOMED CT version: ${actualVersion}`);
    console.info(`Using SNOMED CT namespace: ${actualNamespace}`);

    const concepts = await this.processSnomedConcepts(terminologyPath);
    const descriptions = await this.processSnomedDescriptions(terminologyPath);
    const relationships = await this.processSnomedRelationships(terminologyPath);
    const textDefinitions = await this.processSnomedTextDefinitions(terminologyPath);
    
    console.info(`[DEBUG] Loaded ${concepts.length} concepts, ${descriptions.length} descriptions, ${relationships.length} relationships, ${textDefinitions.length} text definitions`);
    
    const mergedConcepts = this.buildSnomedConceptHierarchy(concepts, descriptions, relationships, textDefinitions);
    
    console.info(`Successfully built ${mergedConcepts.length} SNOMED CT concepts with relationships`);
    const codeSystem = this.createSnomedCodeSystem(mergedConcepts, actualVersion, actualNamespace);
    console.info(`[DEBUG] Created CodeSystem with ${codeSystem.concept?.length || 0} concepts`);
    return codeSystem;
  }

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

  private async processSnomedConcepts(terminologyPath: string): Promise<any[]> {
    const conceptFiles = fs.readdirSync(terminologyPath).filter((file: string) => 
      file.startsWith('sct2_Concept_') && file.endsWith('.txt')
    );
    
    if (conceptFiles.length === 0) {
      throw new Error('No concept file found in terminology directory');
    }
    
    const conceptFile = path.join(terminologyPath, conceptFiles[0]);
    console.info(`Reading SNOMED CT concepts from file: ${conceptFile}`);
    
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
          console.info(`Successfully processed ${processedCount} SNOMED CT concepts`);
          resolve(concepts);
        })
        .on('error', (error) => {
          console.error('Failed to process SNOMED CT concept file:', error);
          reject(error);
        });
    });
  }

  private async processSnomedDescriptions(terminologyPath: string): Promise<any[]> {
    const descriptionFiles = fs.readdirSync(terminologyPath).filter((file: string) => 
      file.startsWith('sct2_Description_') && file.endsWith('.txt')
    );
    
    if (descriptionFiles.length === 0) {
      console.warn('No description file found, using concept IDs as displays');
      return [];
    }
    
    const descriptionFile = path.join(terminologyPath, descriptionFiles[0]);
    console.info(`Reading SNOMED CT descriptions from file: ${descriptionFile}`);
    
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
          console.info(`Successfully processed ${processedCount} SNOMED CT descriptions`);
          resolve(descriptions);
        })
        .on('error', (error) => {
          console.error('Failed to process SNOMED CT description file:', error);
          reject(error);
        });
    });
  }

  private async processSnomedRelationships(terminologyPath: string): Promise<any[]> {
    const relationshipFiles = fs.readdirSync(terminologyPath).filter((file: string) => 
      file.startsWith('sct2_Relationship_') && file.endsWith('.txt')
    );
    
    if (relationshipFiles.length === 0) {
      console.warn('No relationship file found');
      return [];
    }
    
    const relationshipFile = path.join(terminologyPath, relationshipFiles[0]);
    console.info(`Reading SNOMED CT relationships from file: ${relationshipFile}`);
    
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
          console.info(`Successfully processed ${processedCount} SNOMED CT relationships`);
          resolve(relationships);
        })
        .on('error', (error) => {
          console.error('Failed to process SNOMED CT relationship file:', error);
          reject(error);
        });
    });
  }

  private async processSnomedTextDefinitions(terminologyPath: string): Promise<any[]> {
    const textDefFiles = fs.readdirSync(terminologyPath).filter((file: string) => 
      file.startsWith('sct2_TextDefinition_') && file.endsWith('.txt')
    );
    
    if (textDefFiles.length === 0) {
      console.warn('No text definition file found');
      return [];
    }
    
    const textDefFile = path.join(terminologyPath, textDefFiles[0]);
    console.info(`Reading SNOMED CT text definitions from file: ${textDefFile}`);
    
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
          console.info(`Successfully processed ${processedCount} SNOMED CT text definitions`);
          resolve(textDefinitions);
        })
        .on('error', (error) => {
          console.error('Failed to process SNOMED CT text definition file:', error);
          reject(error);
        });
    });
  }

  private buildSnomedConceptHierarchy(concepts: any[], descriptions: any[], relationships: any[], textDefinitions: any[]): any[] {
    const descriptionMap = new Map();
    const textDefMap = new Map();
    const relationshipMap = new Map();
    
    descriptions.forEach(desc => {
      if (!descriptionMap.has(desc.conceptId) || desc.typeId === SNOMED_CONCEPT_IDS.SYNONYM) {
        descriptionMap.set(desc.conceptId, desc.term);
      }
    });
    
    textDefinitions.forEach(def => {
      if (!textDefMap.has(def.conceptId)) {
        textDefMap.set(def.conceptId, def.term);
      }
    });
    
    relationships.forEach(rel => {
      if (!relationshipMap.has(rel.sourceId)) {
        relationshipMap.set(rel.sourceId, []);
      }
      relationshipMap.get(rel.sourceId).push(rel);
    });
    
    const uniqueConcepts = new Map();
    concepts.forEach(concept => {
      if (!uniqueConcepts.has(concept.id)) {
        uniqueConcepts.set(concept.id, concept);
      }
    });
    
    console.info(`Deduplicated SNOMED CT concepts: ${concepts.length} → ${uniqueConcepts.size} unique concepts`);
    
    const allConcepts = Array.from(uniqueConcepts.values());
    
    console.info(`Building concept hierarchy for ${allConcepts.length} SNOMED CT concepts`);
    
    return allConcepts.map(concept => {
      const conceptRelationships = relationshipMap.get(concept.id) || [];
      const isA = conceptRelationships.filter((rel: any) => rel.typeId === SNOMED_CONCEPT_IDS.IS_A);
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
                url: SNOMED_TERMINOLOGY_INFO.fhirUrls.designationUseContextExtension,
                extension: [
                  {
                    url: 'context',
                    valueCoding: {
                      system: SNOMED_TERMINOLOGY_INFO.fhirUrls.system,
                      code: SNOMED_CONCEPT_IDS.CONTEXT
                    }
                  },
                  {
                    url: 'role',
                    valueCoding: {
                      system: SNOMED_TERMINOLOGY_INFO.fhirUrls.system,
                      code: SNOMED_CONCEPT_IDS.PREFERRED_ROLE,
                      display: SNOMED_DISPLAY_NAMES.PREFERRED
                    }
                  },
                  {
                    url: 'type',
                    valueCoding: {
                      system: SNOMED_TERMINOLOGY_INFO.fhirUrls.system,
                      code: SNOMED_CONCEPT_IDS.FULLY_SPECIFIED_NAME,
                      display: SNOMED_DISPLAY_NAMES.FULLY_SPECIFIED_NAME
                    }
                  }
                ]
              }
            ],
            language: SNOMED_LANGUAGES.ENGLISH,
            use: {
              system: SNOMED_TERMINOLOGY_INFO.fhirUrls.system,
              code: SNOMED_CONCEPT_IDS.FULLY_SPECIFIED_NAME,
              display: SNOMED_DISPLAY_NAMES.FULLY_SPECIFIED_NAME
            },
            value: conceptDisplay
          },
          {
            extension: [
              {
                url: SNOMED_TERMINOLOGY_INFO.fhirUrls.designationUseContextExtension,
                extension: [
                  {
                    url: 'context',
                    valueCoding: {
                      system: SNOMED_TERMINOLOGY_INFO.fhirUrls.system,
                      code: SNOMED_CONCEPT_IDS.CONTEXT
                    }
                  },
                  {
                    url: 'role',
                    valueCoding: {
                      system: SNOMED_TERMINOLOGY_INFO.fhirUrls.system,
                      code: SNOMED_CONCEPT_IDS.PREFERRED_ROLE,
                      display: SNOMED_DISPLAY_NAMES.PREFERRED
                    }
                  },
                  {
                    url: 'type',
                    valueCoding: {
                      system: SNOMED_TERMINOLOGY_INFO.fhirUrls.system,
                      code: SNOMED_CONCEPT_IDS.SYNONYM,
                      display: SNOMED_DISPLAY_NAMES.SYNONYM
                    }
                  }
                ]
              }
            ],
            language: SNOMED_LANGUAGES.ENGLISH, 
            use: {
              system: SNOMED_TERMINOLOGY_INFO.fhirUrls.system,
              code: SNOMED_CONCEPT_IDS.SYNONYM,
              display: SNOMED_DISPLAY_NAMES.SYNONYM
            },
            value: conceptDisplay
          }
        ],
        property: [
          {
            code: SNOMED_PROPERTY_CODES.EFFECTIVE_TIME,
            valueString: concept.effectiveTime
          },
          {
            code: SNOMED_PROPERTY_CODES.MODULE_ID,
            valueCode: concept.moduleId
          },
          {
            code: SNOMED_PROPERTY_CODES.DEFINITION_STATUS_ID,
            valueCode: concept.definitionStatusId
          },
          ...parentConcepts.slice(0, 10).map((parentId: any) => ({
            code: SNOMED_PROPERTY_CODES.PARENT,
            valueCode: parentId
          })),
          ...conceptRelationships.slice(0, 10).map((rel: any) => ({
            code: SNOMED_PROPERTY_CODES.RELATIONSHIP,
            valueCode: rel.destinationId,
            valueString: this.getRelationshipTypeDisplay(rel.typeId)
          }))
        ]
      };
    });
  }

  private getRelationshipTypeDisplay(typeId: string): string {
    return SNOMED_RELATIONSHIP_TYPES[typeId] || `Relationship Type ${typeId}`;
  }

  async processRxNormFile(filePath: string): Promise<CodeSystem> {
    console.info(`Starting RxNorm terminology processing from: ${filePath}`);
    
    const concepts: any[] = [];
    let processedCount = 0;

    return new Promise((resolve, reject) => {
      const rrfData: any[] = [];
      
      createReadStream(filePath)
        .pipe(csv({ separator: '|', headers: false }))
        .on('data', (data: any) => {
          // RXNCONSO.RRF format: RXCUI|LAT|TS|STT|SUI|ISPREF|AUI|SAUI|SCUI|SDUI|SAB|TTY|CODE|STR|SBR|VER|RELEASE|SRL|SUPPRESS|CVF
          const rxcui = data[RXNORM_RRF_FIELDS.RXCUI.toString()];
          const str = data[RXNORM_RRF_FIELDS.STR.toString()];
          const sab = data[RXNORM_RRF_FIELDS.SAB.toString()];
          const tty = data[RXNORM_RRF_FIELDS.TTY.toString()];
          const code = data[RXNORM_RRF_FIELDS.CODE.toString()];
          const ispref = data[RXNORM_RRF_FIELDS.ISPREF.toString()];
          
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
          const conceptMap = new Map();
          
          rrfData.forEach(item => {
            if (!conceptMap.has(item.rxcui)) {
              conceptMap.set(item.rxcui, {
                code: item.rxcui,
                display: item.str,
                definition: item.str,
                property: [
                  ...(item.tty ? [{ code: RXNORM_PROPERTY_CODES.TTY, valueString: item.tty }] : []),
                  ...(item.sab ? [{ code: RXNORM_PROPERTY_CODES.SAB, valueString: item.sab }] : []),
                  ...(item.ispref ? [{ code: RXNORM_PROPERTY_CODES.ISPREF, valueString: item.ispref }] : [])
                ]
              });
            }
          });
          
          const conceptValues = Array.from(conceptMap.values());
          for (let i = 0; i < conceptValues.length; i += this.config.batchSize) {
            concepts.push(...conceptValues.slice(i, i + this.config.batchSize));
          }
          processedCount = concepts.length;
          
          console.info(`Successfully processed ${processedCount} RxNorm concepts`);
          const codeSystem = this.createRxNormCodeSystem(concepts);
          resolve(codeSystem);
        })
        .on('error', (error) => {
          console.error('Failed to process RxNorm file:', error);
          reject(error);
        });
    });
  }

  private createLoincCodeSystem(concepts: any[]): CodeSystem {
    return {
      resourceType: 'CodeSystem',
      id: 'loinc-current',
      url: LOINC_TERMINOLOGY_INFO.fhirUrls.system,
      version: LOINC_TERMINOLOGY_INFO.fhirUrls.versionCurrent,
      name: 'LOINC',
      title: LOINC_TERMINOLOGY_INFO.identity.name,
      status: 'active',
      date: new Date().toISOString().split('T')[0] + 'T00:00:00+00:00',
      publisher: LOINC_TERMINOLOGY_INFO.publisher.name,
      description: LOINC_TERMINOLOGY_INFO.identity.description,
      caseSensitive: true,
      compositional: false,
      versionNeeded: false,
      content: 'complete',
      count: concepts.length,
      concept: concepts,
      property: [
        {
          code: LOINC_PROPERTY_CODES.TTY,
          uri: `${LOINC_TERMINOLOGY_INFO.fhirUrls.system}#${LOINC_PROPERTY_CODES.TTY}`,
          description: 'Term type',
          type: 'string'
        },
        {
          code: LOINC_PROPERTY_CODES.SAB,
          uri: `${LOINC_TERMINOLOGY_INFO.fhirUrls.system}#${LOINC_PROPERTY_CODES.SAB}`,
          description: 'Source abbreviation',
          type: 'string'
        }
      ]
    };
  }

  private createSnomedCodeSystem(concepts: any[], version: string, namespace?: string): CodeSystem {
    if (!version) {
      throw new Error('SNOMED CT version is required and must be extracted from the data');
    }
    if (!namespace) {
      throw new Error('SNOMED CT namespace is required and must be extracted from the data');
    }
    const versionId = version.split('/').pop() || 'unknown';
    const edition = this.getSnomedEditionFromNamespace(namespace);
    
    return {
      resourceType: 'CodeSystem',
      id: `sct-${namespace}-${versionId}`,
      url: SNOMED_TERMINOLOGY_INFO.fhirUrls.system,
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
          uri: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}#effectiveTime`,
          description: 'The time at which this version of the concept became active',
          type: 'string'
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
          description: 'The definition status of this concept',
          type: 'code'
        },
        {
          code: 'parent',
          uri: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}#parent`,
          description: 'Parent concepts in the SNOMED CT hierarchy',
          type: 'code'
        },
        {
          code: 'child',
          uri: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}#child`,
          description: 'Child concepts in the SNOMED CT hierarchy',
          type: 'code'
        }
      ]
    };
  }

  createSnomedValueSet(concepts: any[], valueSetId: string, title: string, description: string): ValueSet {
    return {
      resourceType: 'ValueSet',
      id: valueSetId,
      url: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system.replace('/sct', '/fhir')}/ValueSet/${valueSetId}`,
      version: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}/900000000000207008/version/current`,
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
            system: SNOMED_TERMINOLOGY_INFO.fhirUrls.system,
            version: `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}/900000000000207008/version/current`,
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

  createLoincValueSet(concepts: any[], valueSetId: string, title: string, description: string): ValueSet {
    return {
      resourceType: 'ValueSet',
      id: valueSetId,
      url: `${LOINC_TERMINOLOGY_INFO.fhirUrls.fhirBase}/ValueSet/${valueSetId}`,
      version: 'current',
      name: valueSetId,
      title: title,
      status: 'active',
      publisher: LOINC_TERMINOLOGY_INFO.publisher.name,
      contact: [
        {
          name: LOINC_TERMINOLOGY_INFO.publisher.name,
          telecom: [
            {
              system: 'url',
              value: LOINC_TERMINOLOGY_INFO.publisher.website
            }
          ]
        }
      ],
      description: description,
      copyright: LOINC_TERMINOLOGY_INFO.publisher.copyright,
      compose: {
        include: [
          {
            system: LOINC_TERMINOLOGY_INFO.fhirUrls.system,
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

  createRxNormValueSet(concepts: any[], valueSetId: string, title: string, description: string): ValueSet {
    return {
      resourceType: 'ValueSet',
      id: valueSetId,
      url: `${RXNORM_TERMINOLOGY_INFO.fhirUrls.fhirBase}/ValueSet/${valueSetId}`,
      version: 'current',
      name: valueSetId,
      title: title,
      status: 'active',
      publisher: RXNORM_TERMINOLOGY_INFO.publisher.name,
      contact: [
        {
          name: RXNORM_TERMINOLOGY_INFO.publisher.name,
          telecom: [
            {
              system: 'url',
              value: RXNORM_TERMINOLOGY_INFO.publisher.website
            }
          ]
        }
      ],
      description: description,
      copyright: RXNORM_TERMINOLOGY_INFO.publisher.copyright,
      compose: {
        include: [
          {
            system: RXNORM_TERMINOLOGY_INFO.fhirUrls.system,
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

  createSnomedCoding(code: string, display: string, version?: string): Coding {
    return this.createCoding(
      SNOMED_TERMINOLOGY_INFO.fhirUrls.system,
      code,
      display,
      version || 'http://snomed.info/sct/version/current'
    );
  }

  createLoincCoding(code: string, display: string, version?: string): Coding {
    return this.createCoding(
      LOINC_TERMINOLOGY_INFO.fhirUrls.system,
      code,
      display,
      version || LOINC_TERMINOLOGY_INFO.fhirUrls.versionCurrent
    );
  }

  createRxNormCoding(code: string, display: string, version?: string): Coding {
    return this.createCoding(
      RXNORM_TERMINOLOGY_INFO.fhirUrls.system,
      code,
      display,
      version || RXNORM_TERMINOLOGY_INFO.fhirUrls.versionCurrent
    );
  }

  private createRxNormCodeSystem(concepts: any[]): CodeSystem {
    return {
      resourceType: 'CodeSystem',
      id: 'rxnorm-current',
      url: RXNORM_TERMINOLOGY_INFO.fhirUrls.system,
      version: RXNORM_TERMINOLOGY_INFO.fhirUrls.versionCurrent,
      name: 'RxNorm',
      title: RXNORM_TERMINOLOGY_INFO.identity.name,
      status: 'active',
      date: new Date().toISOString().split('T')[0] + 'T00:00:00+00:00',
      publisher: RXNORM_TERMINOLOGY_INFO.publisher.name,
      description: RXNORM_TERMINOLOGY_INFO.identity.description,
      caseSensitive: true,
      compositional: false,
      versionNeeded: false,
      content: 'complete',
      count: concepts.length,
      concept: concepts,
      property: [
        {
          code: RXNORM_PROPERTY_CODES.TTY,
          uri: `${RXNORM_TERMINOLOGY_INFO.fhirUrls.system}#${RXNORM_PROPERTY_CODES.TTY}`,
          description: 'Term type',
          type: 'string'
        },
        {
          code: RXNORM_PROPERTY_CODES.SAB,
          uri: `${RXNORM_TERMINOLOGY_INFO.fhirUrls.system}#${RXNORM_PROPERTY_CODES.SAB}`,
          description: 'Source abbreviation',
          type: 'string'
        }
      ]
    };
  }

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

  private getSnomedEditionFromNamespace(namespace: string): string {
    // Handle special case for International Edition (INT)
    if (namespace.startsWith('INT')) {
      return 'International Edition';
    }
    
    const countryCode = namespace.substring(0, 2);
    
    const editionMap: { [key: string]: string } = {
      'US': 'United States Edition',
      'INT': 'International Edition',
      'AU': 'Australian Edition',
      'CA': 'Canadian Edition',
      'NL': 'Netherlands Edition',
      'SE': 'Swedish Edition',
      'DK': 'Danish Edition',
      'BE': 'Belgian Edition',
      'ES': 'Spanish Edition',
      'CH': 'Swiss Edition',
      'IE': 'Irish Edition',
      'NZ': 'New Zealand Edition',
      'PL': 'Polish Edition',
      'PT': 'Portuguese Edition',
      'BR': 'Brazilian Edition',
      'MX': 'Mexican Edition',
      'AR': 'Argentine Edition',
      'CL': 'Chilean Edition',
      'CO': 'Colombian Edition',
      'PE': 'Peruvian Edition',
      'UY': 'Uruguayan Edition',
      'VE': 'Venezuelan Edition',
      'EC': 'Ecuadorian Edition',
      'BO': 'Bolivian Edition',
      'PY': 'Paraguayan Edition',
      'GY': 'Guyanese Edition',
      'SR': 'Surinamese Edition',
      'TT': 'Trinidad and Tobago Edition',
      'JM': 'Jamaican Edition',
      'BB': 'Barbadian Edition',
      'BS': 'Bahamian Edition',
      'BZ': 'Belizean Edition',
      'CR': 'Costa Rican Edition',
      'CU': 'Cuban Edition',
      'DO': 'Dominican Edition',
      'GT': 'Guatemalan Edition',
      'HN': 'Honduran Edition',
      'NI': 'Nicaraguan Edition',
      'PA': 'Panamanian Edition',
      'SV': 'Salvadoran Edition',
      'HT': 'Haitian Edition',
      'DM': 'Dominican Edition',
      'AG': 'Antiguan Edition',
      'KN': 'Saint Kitts and Nevis Edition',
      'LC': 'Saint Lucian Edition',
      'VC': 'Saint Vincent and the Grenadines Edition',
      'GD': 'Grenadian Edition'
    };
    
    return editionMap[countryCode] || `${countryCode} Edition`;
  }

  public extractSnomedNamespace(filePath: string): string {
    try {
      // First try to extract from directory name
      const pathParts = filePath.split('/');
      const dirName = pathParts[pathParts.length - 1];
      
      const namespaceMatch = dirName.match(/(US|INT|AU|CA|NL|SE|DK|BE|ES|CH|IE|NZ|PL|PT|BR|MX|AR|CL|CO|PE|UY|VE|EC|BO|PY|GY|SR|TT|JM|BB|BS|BZ|CR|CU|DO|GT|HN|NI|PA|SV|HT|DM|AG|KN|LC|VC|GD|BS|BZ|CR|CU|DO|GT|HN|NI|PA|SV|HT|DM|AG|KN|LC|VC|GD)(\d{7})/);
      if (namespaceMatch) {
        const countryCode = namespaceMatch[1];
        const number = namespaceMatch[2];
        return `${countryCode}${number}`;
      }
      
      const namespace = this.extractNamespaceFromRf2Files(filePath);
      if (namespace) {
        return namespace;
      }
      
      throw new Error(`Could not extract SNOMED CT namespace from directory path or RF2 files: ${filePath}`);
    } catch (error) {
      console.error('Failed to extract SNOMED CT namespace from data:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`SNOMED CT namespace extraction failed: ${errorMessage}`);
    }
  }

  private extractNamespaceFromRf2Files(directoryPath: string): string | null {
    try {
      const terminologyPath = this.findTerminologyPath(directoryPath);
      if (!terminologyPath) {
        return null;
      }

      const files = fs.readdirSync(terminologyPath);
      const conceptFileName = files.find(file => 
        file.startsWith('sct2_Concept_Full_') && file.endsWith('.txt')
      );
      
      if (conceptFileName) {
        const conceptFilePath = path.join(terminologyPath, conceptFileName);
        
        const buffer = fs.readFileSync(conceptFilePath, { encoding: 'utf8', flag: 'r' });
        const headerContent = buffer.substring(0, 2000);
        
        const lines = headerContent.split('\n');
        for (const line of lines) {
          const namespaceMatch = line.match(/(US|INT|AU|CA|NL|SE|DK|BE|ES|CH|IE|NZ|PL|PT|BR|MX|AR|CL|CO|PE|UY|VE|EC|BO|PY|GY|SR|TT|JM|BB|BS|BZ|CR|CU|DO|GT|HN|NI|PA|SV|HT|DM|AG|KN|LC|VC|GD|BS|BZ|CR|CU|DO|GT|HN|NI|PA|SV|HT|DM|AG|KN|LC|VC|GD)(\d{7})/);
          if (namespaceMatch) {
            const countryCode = namespaceMatch[1];
            const number = namespaceMatch[2];
            return `${countryCode}${number}`;
          }
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Failed to read RF2 file headers for namespace extraction:', error);
      return null;
    }
  }

  public extractSnomedVersion(filePath: string): string {
    try {
      // First try to extract from directory name
      const pathParts = filePath.split('/');
      const dirName = pathParts[pathParts.length - 1];
      
      const dateMatch = dirName.match(/(\d{8})/);
      if (dateMatch) {
        const date = dateMatch[1];
        const namespace = this.extractSnomedNamespace(filePath);
        return `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}/${namespace}/version/${date}`;
      }
      
      const version = this.extractVersionFromRf2Files(filePath);
      if (version) {
        return version;
      }
      
      throw new Error(`Could not extract SNOMED CT version from directory path or RF2 files: ${filePath}`);
    } catch (error) {
      console.error('Failed to extract SNOMED CT version from data:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`SNOMED CT version extraction failed: ${errorMessage}`);
    }
  }

  private extractVersionFromRf2Files(directoryPath: string): string | null {
    try {
      const terminologyPath = this.findTerminologyPath(directoryPath);
      if (!terminologyPath) {
        return null;
      }

      const files = fs.readdirSync(terminologyPath);
      const conceptFileName = files.find(file => 
        file.startsWith('sct2_Concept_Full_') && file.endsWith('.txt')
      );
      
      if (conceptFileName) {
        const conceptFilePath = path.join(terminologyPath, conceptFileName);
        
        const buffer = fs.readFileSync(conceptFilePath, { encoding: 'utf8', flag: 'r' });
        const headerContent = buffer.substring(0, 1000);
        
        const lines = headerContent.split('\n');
        for (const line of lines) {
          const versionMatch = line.match(/(\d{8})/);
          if (versionMatch) {
            const date = versionMatch[1];
            const namespace = this.extractSnomedNamespace(directoryPath);
            return `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}/${namespace}/version/${date}`;
          }
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Failed to read RF2 file headers for version extraction:', error);
      return null;
    }
  }

  private extractLoincVersion(filePath: string): string {
    try {
      const pathParts = filePath.split('/');
      
      for (let i = pathParts.length - 1; i >= 0; i--) {
        const part = pathParts[i];
        const versionMatch = part.match(/Loinc_(\d+\.\d+)/);
        if (versionMatch) {
          return `${LOINC_TERMINOLOGY_INFO.fhirUrls.system}/version/${versionMatch[1]}`;
        }
      }
      
      return LOINC_TERMINOLOGY_INFO.fhirUrls.versionCurrent;
    } catch (error) {
      console.warn('Failed to extract LOINC version, using fallback');
      return LOINC_TERMINOLOGY_INFO.fhirUrls.versionCurrent;
    }
  }

  private extractRxNormVersion(filePath: string): string {
    try {
      const pathParts = filePath.split('/');
      
      for (let i = pathParts.length - 1; i >= 0; i--) {
        const part = pathParts[i];
        const dateMatch = part.match(/(\d{8})/);
        if (dateMatch) {
          const date = dateMatch[1];
          return `${RXNORM_TERMINOLOGY_INFO.fhirUrls.system}/version/${date}`;
        }
      }
      
      return RXNORM_TERMINOLOGY_INFO.fhirUrls.versionCurrent;
    } catch (error) {
      console.warn('Failed to extract RxNorm version, using fallback');
      return RXNORM_TERMINOLOGY_INFO.fhirUrls.versionCurrent;
    }
  }

  createCodeableConcept(coding: Coding, text?: string): CodeableConcept {
    return {
      coding: [coding],
      text: text || coding.display
    };
  }

  createSnomedCodeableConcept(code: string, display: string, text?: string, version?: string): CodeableConcept {
    const coding = this.createSnomedCoding(code, display, version);
    return this.createCodeableConcept(coding, text);
  }

  createLoincCodeableConcept(code: string, display: string, text?: string, version?: string): CodeableConcept {
    const coding = this.createLoincCoding(code, display, version);
    return this.createCodeableConcept(coding, text);
  }

  createRxNormCodeableConcept(code: string, display: string, text?: string, version?: string): CodeableConcept {
    const coding = this.createRxNormCoding(code, display, version);
    return this.createCodeableConcept(coding, text);
  }
}
