// Author: Preston Lee

import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import csv from 'csv-parser';
import readline from 'readline';
import { LogPrefixes } from '../constants/log-prefixes.js';
import { RXNORM_PROPERTY_CODES, RXNORM_RRF_FIELDS } from '../constants/rxnorm-constants.js';

export interface RxNormFileReaderConfig {
  verbose: boolean;
}

export class RxNormFileReader {
  private config: RxNormFileReaderConfig;

  constructor(config: RxNormFileReaderConfig) {
    this.config = config;
  }

  /**
   * Load RxNorm concepts using streaming approach
   */
  async loadRxNormConcepts(filePath: string): Promise<Map<string, any>> {
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loading RxNorm concepts from: ${filePath}`);
    }

    const concepts = new Map<string, any>();
    let processedCount = 0;

    return new Promise((resolve, reject) => {
      const rrfData: any[] = [];
      
      createReadStream(filePath)
        .pipe(csv({ separator: '|', headers: false }))
        .on('data', (data: any) => {
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
          
          processedCount = conceptMap.size;
          
          if (this.config.verbose) {
            console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loaded ${processedCount} unique RxNorm concepts`);
          }
          
          resolve(conceptMap);
        })
        .on('error', (error) => {
          console.error(`${LogPrefixes.STAGE_1_PREPROCESS} Error reading RxNorm file: ${error}`);
          reject(error);
        });
    });
  }

  /**
   * Process RxNorm concepts with streaming to a write stream
   */
  async processRxNormConceptsStreaming(
    filePath: string,
    writeStream: fs.WriteStream,
    version: string
  ): Promise<void> {
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Starting streaming RxNorm processing: ${filePath}`);
    }

    const seenRxcuis = new Set<string>();
    let conceptCount = 0;
    let lastConceptJson = '';

    return new Promise((resolve, reject) => {
      createReadStream(filePath)
        .pipe(csv({ separator: '|', headers: false }))
        .on('data', (data: any) => {
          const rxcui = data[RXNORM_RRF_FIELDS.RXCUI.toString()]?.trim();
          const str = data[RXNORM_RRF_FIELDS.STR.toString()]?.trim();
          const sab = data[RXNORM_RRF_FIELDS.SAB.toString()]?.trim();
          const tty = data[RXNORM_RRF_FIELDS.TTY.toString()]?.trim();
          const ispref = data[RXNORM_RRF_FIELDS.ISPREF.toString()]?.trim();

          // Only process if we haven't seen this RXCUI yet and have valid data
          if (rxcui && str && !seenRxcuis.has(rxcui)) {
            seenRxcuis.add(rxcui);

            const concept: any = {
              code: rxcui,
              display: str,
              definition: str
            };

            // Add properties
            const properties: any[] = [];
            if (tty) properties.push({ code: RXNORM_PROPERTY_CODES.TTY, valueString: tty });
            if (sab) properties.push({ code: RXNORM_PROPERTY_CODES.SAB, valueString: sab });
            if (ispref) properties.push({ code: RXNORM_PROPERTY_CODES.ISPREF, valueString: ispref });
            
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
              console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Processed ${conceptCount} RxNorm concepts`);
            }
          }
        })
        .on('end', () => {
          // Write the last concept without a comma
          if (lastConceptJson) {
            writeStream.write(`\n    ${lastConceptJson}`);
          }
          if (this.config.verbose) {
            console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Completed processing ${conceptCount} RxNorm concepts`);
          }
          resolve();
        })
        .on('error', (error) => {
          console.error(`${LogPrefixes.STAGE_1_PREPROCESS} Error reading RxNorm file: ${error}`);
          reject(error);
        });
    });
  }

  /**
   * Extract RxNorm version from file path
   */
  public extractRxNormVersion(filePath: string): string {
    try {
      const pathParts = filePath.split('/');
      
      for (let i = pathParts.length - 1; i >= 0; i--) {
        const part = pathParts[i];
        const dateMatch = part.match(/(\d{8})/);
        if (dateMatch) {
          const date = dateMatch[1];
          return date;
        }
      }
      
      return 'current';
    } catch (error) {
      console.warn('Failed to extract RxNorm version, using fallback');
      return 'current';
    }
  }
}

