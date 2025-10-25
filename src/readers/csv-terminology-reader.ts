import { createReadStream } from 'fs';
import csv from 'csv-parser';
import { ITerminologyFileReader, TerminologyFileReaderConfig, TerminologyFileInfo, TerminologyReaderResult } from './terminology-file-reader.js';
import { LOINC_FHIR_URLS, LOINC_PROPERTY_CODES, LOINC_ORGANIZATION, LOINC_RESOURCE_INFO } from '../constants/loinc-constants.js';
import { RXNORM_FHIR_URLS, RXNORM_PROPERTY_CODES, RXNORM_ORGANIZATION, RXNORM_RESOURCE_INFO, RXNORM_RRF_FIELDS } from '../constants/rxnorm-constants.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

export class CsvTerminologyReader implements ITerminologyFileReader {
  private config: TerminologyFileReaderConfig;

  constructor(config: TerminologyFileReaderConfig) {
    this.config = config;
  }

  canHandle(fileInfo: TerminologyFileInfo): boolean {
    return (fileInfo.fileType === 'loinc' && fileInfo.format === 'csv') ||
           (fileInfo.fileType === 'rxnorm' && fileInfo.format === 'txt');
  }

  getTerminologyType(): 'snomed' | 'loinc' | 'rxnorm' {
    // This reader can handle both LOINC and RxNorm, but we'll determine based on file content
    return 'loinc'; // Default, will be determined by file content
  }

  async readFile(fileInfo: TerminologyFileInfo): Promise<TerminologyReaderResult> {
    if (fileInfo.fileType === 'loinc') {
      return this.readLoincFile(fileInfo);
    } else if (fileInfo.fileType === 'rxnorm') {
      return this.readRxNormFile(fileInfo);
    } else {
      throw new Error('CsvTerminologyReader can only handle LOINC CSV or RxNorm RRF files');
    }
  }

  /**
   * Read LOINC CSV file
   */
  private async readLoincFile(fileInfo: TerminologyFileInfo): Promise<TerminologyReaderResult> {
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Starting LOINC terminology processing from: ${fileInfo.filePath}`);
    
    const concepts: any[] = [];
    let processedCount = 0;

    return new Promise((resolve, reject) => {
      createReadStream(fileInfo.filePath)
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
          console.info(`${LogPrefixes.STAGE_3_UPLOAD} Successfully processed ${processedCount} LOINC concepts from file`);
          
          const uniqueConcepts = new Map();
          concepts.forEach(concept => {
            if (!uniqueConcepts.has(concept.code)) {
              uniqueConcepts.set(concept.code, concept);
            }
          });
          
          console.info(`${LogPrefixes.STAGE_3_UPLOAD} Deduplicated LOINC concepts: ${concepts.length} → ${uniqueConcepts.size} unique concepts`);
          
          const codeSystem = this.createLoincCodeSystem(Array.from(uniqueConcepts.values()));
          resolve({ codeSystem, processedCount: uniqueConcepts.size });
        })
        .on('error', (error) => {
          console.error(`${LogPrefixes.STAGE_3_UPLOAD} Failed to process LOINC file:`, error);
          reject(error);
        });
    });
  }

  /**
   * Read RxNorm RRF file
   */
  private async readRxNormFile(fileInfo: TerminologyFileInfo): Promise<TerminologyReaderResult> {
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Starting RxNorm terminology processing from: ${fileInfo.filePath}`);
    
    const concepts: any[] = [];
    let processedCount = 0;

    return new Promise((resolve, reject) => {
      const rrfData: any[] = [];
      
      createReadStream(fileInfo.filePath)
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
          for (let i = 0; i < conceptValues.length; i += (this.config.batchSize || 1000)) {
            concepts.push(...conceptValues.slice(i, i + (this.config.batchSize || 1000)));
          }
          processedCount = concepts.length;
          
          console.info(`${LogPrefixes.STAGE_3_UPLOAD} Successfully processed ${processedCount} RxNorm concepts`);
          const codeSystem = this.createRxNormCodeSystem(concepts);
          resolve({ codeSystem, processedCount });
        })
        .on('error', (error) => {
          console.error(`${LogPrefixes.STAGE_3_UPLOAD} Failed to process RxNorm file:`, error);
          reject(error);
        });
    });
  }

  /**
   * Create LOINC CodeSystem
   */
  private createLoincCodeSystem(concepts: any[]): any {
    return {
      resourceType: 'CodeSystem',
      id: 'loinc-current',
      url: LOINC_FHIR_URLS.SYSTEM,
      version: LOINC_FHIR_URLS.VERSION_CURRENT,
      name: 'LOINC',
      title: LOINC_RESOURCE_INFO.TITLE,
      status: 'active',
      date: new Date().toISOString().split('T')[0] + 'T00:00:00+00:00',
      publisher: LOINC_RESOURCE_INFO.PUBLISHER,
      description: LOINC_RESOURCE_INFO.DESCRIPTION,
      caseSensitive: true,
      compositional: false,
      versionNeeded: false,
      content: 'complete',
      count: concepts.length,
      concept: concepts,
      property: [
        {
          code: LOINC_PROPERTY_CODES.TTY,
          uri: `${LOINC_FHIR_URLS.SYSTEM}#${LOINC_PROPERTY_CODES.TTY}`,
          description: 'Term type',
          type: 'string'
        },
        {
          code: LOINC_PROPERTY_CODES.SAB,
          uri: `${LOINC_FHIR_URLS.SYSTEM}#${LOINC_PROPERTY_CODES.SAB}`,
          description: 'Source abbreviation',
          type: 'string'
        }
      ]
    };
  }

  /**
   * Create RxNorm CodeSystem
   */
  private createRxNormCodeSystem(concepts: any[]): any {
    return {
      resourceType: 'CodeSystem',
      id: 'rxnorm-current',
      url: RXNORM_FHIR_URLS.SYSTEM,
      version: RXNORM_FHIR_URLS.VERSION_CURRENT,
      name: 'RxNorm',
      title: RXNORM_RESOURCE_INFO.TITLE,
      status: 'active',
      date: new Date().toISOString().split('T')[0] + 'T00:00:00+00:00',
      publisher: RXNORM_RESOURCE_INFO.PUBLISHER,
      description: RXNORM_RESOURCE_INFO.DESCRIPTION,
      caseSensitive: true,
      compositional: false,
      versionNeeded: false,
      content: 'complete',
      count: concepts.length,
      concept: concepts,
      property: [
        {
          code: RXNORM_PROPERTY_CODES.TTY,
          uri: `${RXNORM_FHIR_URLS.SYSTEM}#${RXNORM_PROPERTY_CODES.TTY}`,
          description: 'Term type',
          type: 'string'
        },
        {
          code: RXNORM_PROPERTY_CODES.SAB,
          uri: `${RXNORM_FHIR_URLS.SYSTEM}#${RXNORM_PROPERTY_CODES.SAB}`,
          description: 'Source abbreviation',
          type: 'string'
        }
      ]
    };
  }

  /**
   * Build LOINC definition from data
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
}
