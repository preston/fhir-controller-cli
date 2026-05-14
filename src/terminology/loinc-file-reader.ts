// Author: Preston Lee

import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import csv from 'csv-parser';
import readline from 'readline';
import { LogPrefixes } from '../constants/log-prefixes.js';
import { LOINC_PROPERTY_CODES } from '../constants/loinc-constants.js';

export interface LoincFileReaderConfig {
  verbose: boolean;
}

export class LoincFileReader {
  private config: LoincFileReaderConfig;

  constructor(config: LoincFileReaderConfig) {
    this.config = config;
  }

  /**
   * Load LOINC concepts using streaming approach
   */
  async loadLoincConcepts(filePath: string): Promise<Map<string, any>> {
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loading LOINC concepts from: ${filePath}`);
    }

    const concepts = new Map<string, any>();
    let processedCount = 0;

    return new Promise((resolve, reject) => {
      createReadStream(filePath)
        .pipe(csv())
        .on('data', (data: any) => {
          if (data.LOINC_NUM && data.LONG_COMMON_NAME) {
            const code = data.LOINC_NUM.trim();
            if (!concepts.has(code)) {
              concepts.set(code, {
                code: code,
                display: data.LONG_COMMON_NAME.trim(),
                definition: this.buildLoincDefinition(data),
                property: [
                  ...(data.COMPONENT ? [{ code: LOINC_PROPERTY_CODES.COMPONENT, valueString: data.COMPONENT.trim() }] : []),
                  ...(data.PROPERTY ? [{ code: LOINC_PROPERTY_CODES.PROPERTY, valueString: data.PROPERTY.trim() }] : []),
                  ...(data.TIME_ASPCT ? [{ code: LOINC_PROPERTY_CODES.TIME, valueString: data.TIME_ASPCT.trim() }] : []),
                  ...(data.SYSTEM ? [{ code: LOINC_PROPERTY_CODES.SYSTEM, valueString: data.SYSTEM.trim() }] : []),
                  ...(data.SCALE_TYP ? [{ code: LOINC_PROPERTY_CODES.SCALE, valueString: data.SCALE_TYP.trim() }] : []),
                  ...(data.METHOD_TYP ? [{ code: LOINC_PROPERTY_CODES.METHOD, valueString: data.METHOD_TYP.trim() }] : []),
                  ...(data.CLASS ? [{ code: LOINC_PROPERTY_CODES.CLASS, valueString: data.CLASS.trim() }] : []),
                  ...(data.CLASSTYPE ? [{ code: LOINC_PROPERTY_CODES.CLASSTYPE, valueString: data.CLASSTYPE.trim() }] : [])
                ]
              });
              processedCount++;
            }

            if (processedCount % 5000 === 0 && this.config.verbose) {
              console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Processed ${processedCount} LOINC concepts`);
            }
          }
        })
        .on('end', () => {
          if (this.config.verbose) {
            console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loaded ${concepts.size} unique LOINC concepts`);
          }
          resolve(concepts);
        })
        .on('error', (error) => {
          console.error(`${LogPrefixes.STAGE_1_PREPROCESS} Error reading LOINC file: ${error}`);
          reject(error);
        });
    });
  }

  /**
   * Process LOINC concepts with streaming to a write stream
   */
  async processLoincConceptsStreaming(
    filePath: string,
    writeStream: fs.WriteStream,
    version: string
  ): Promise<void> {
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Starting streaming LOINC processing: ${filePath}`);
    }

    let conceptCount = 0;
    let lastConceptJson = '';

    return new Promise((resolve, reject) => {
      createReadStream(filePath)
        .pipe(csv())
        .on('data', (data: any) => {
          if (data.LOINC_NUM && data.LONG_COMMON_NAME) {
            const code = data.LOINC_NUM.trim();
            const display = data.LONG_COMMON_NAME.trim();

            const concept: any = {
              code: code,
              display: display,
              definition: this.buildLoincDefinition(data)
            };

            // Add properties
            const properties: any[] = [];
            if (data.COMPONENT) properties.push({ code: LOINC_PROPERTY_CODES.COMPONENT, valueString: data.COMPONENT.trim() });
            if (data.PROPERTY) properties.push({ code: LOINC_PROPERTY_CODES.PROPERTY, valueString: data.PROPERTY.trim() });
            if (data.TIME_ASPCT) properties.push({ code: LOINC_PROPERTY_CODES.TIME, valueString: data.TIME_ASPCT.trim() });
            if (data.SYSTEM) properties.push({ code: LOINC_PROPERTY_CODES.SYSTEM, valueString: data.SYSTEM.trim() });
            if (data.SCALE_TYP) properties.push({ code: LOINC_PROPERTY_CODES.SCALE, valueString: data.SCALE_TYP.trim() });
            if (data.METHOD_TYP) properties.push({ code: LOINC_PROPERTY_CODES.METHOD, valueString: data.METHOD_TYP.trim() });
            if (data.CLASS) properties.push({ code: LOINC_PROPERTY_CODES.CLASS, valueString: data.CLASS.trim() });
            if (data.CLASSTYPE) properties.push({ code: LOINC_PROPERTY_CODES.CLASSTYPE, valueString: data.CLASSTYPE.trim() });
            
            if (properties.length > 0) {
              concept.property = properties;
            }

            const conceptJson = JSON.stringify(concept);

            // If we have a previous concept, write it with a comma
            if (lastConceptJson) {
              writeStream.write(`\n    ${lastConceptJson},`);
            }

            // Store this concept to write later (without comma)
            lastConceptJson = conceptJson;
            conceptCount++;

            if (conceptCount % 10000 === 0 && this.config.verbose) {
              console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Processed ${conceptCount} LOINC concepts`);
            }
          }
        })
        .on('end', () => {
          // Write the last concept without a comma
          if (lastConceptJson) {
            writeStream.write(`\n    ${lastConceptJson}`);
          }
          if (this.config.verbose) {
            console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Completed processing ${conceptCount} LOINC concepts`);
          }
          resolve();
        })
        .on('error', (error) => {
          console.error(`${LogPrefixes.STAGE_1_PREPROCESS} Error reading LOINC file: ${error}`);
          reject(error);
        });
    });
  }

  /**
   * Extract LOINC version from file path
   */
  public extractLoincVersion(filePath: string): string {
    try {
      const pathParts = filePath.split('/');
      
      for (let i = pathParts.length - 1; i >= 0; i--) {
        const part = pathParts[i];
        const versionMatch = part.match(/(\d+\.\d+)/);
        if (versionMatch) {
          return versionMatch[1];
        }
      }
      
      return 'current';
    } catch (error) {
      console.warn('Failed to extract LOINC version, using fallback');
      return 'current';
    }
  }

  /**
   * Build LOINC definition from data
   */
  private buildLoincDefinition(data: any): string {
    let definition = data.LONG_COMMON_NAME || data.LOINC_NUM;
    
    const parts: string[] = [];
    if (data.COMPONENT) parts.push(`Component: ${data.COMPONENT}`);
    if (data.PROPERTY) parts.push(`Property: ${data.PROPERTY}`);
    if (data.SYSTEM) parts.push(`System: ${data.SYSTEM}`);
    if (data.SCALE_TYP) parts.push(`Scale: ${data.SCALE_TYP}`);
    
    if (parts.length > 0) {
      definition += ` (${parts.join(', ')})`;
    }
    
    return definition;
  }
}

