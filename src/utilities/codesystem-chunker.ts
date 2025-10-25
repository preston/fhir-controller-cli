import fs from 'fs';
import path from 'path';
import chain from 'stream-chain';
import streamJson from 'stream-json';
import pick from 'stream-json/filters/Pick';
import streamArray from 'stream-json/streamers/StreamArray';
import { LogPrefixes } from '../constants/log-prefixes.js';

export interface CodeSystemChunkerConfig {
  verbose: boolean;
  chunkSize?: number;
}

export interface ChunkResult {
  baseFile: string;
  chunkFiles: string[];
}

export class CodeSystemChunker {
  private config: CodeSystemChunkerConfig;

  constructor(config: CodeSystemChunkerConfig) {
    this.config = config;
  }

  /**
   * Split large CodeSystem file into base metadata and concept chunks using streaming JSON parser
   */
  async splitCodeSystemFile(sourceFilePath: string, stagingDir: string): Promise<ChunkResult> {
    if (this.config.verbose) {
      console.info(`${LogPrefixes.STAGE_2_SPLIT} Splitting large CodeSystem file: ${sourceFilePath}`);
    }
    
    const baseFileName = path.basename(sourceFilePath).replace('.json', '-base.json');
    const baseFile = path.join(stagingDir, baseFileName);
    const chunkFiles: string[] = [];
    
    let conceptCount = 0;
    let chunkIndex = 0;
    const chunkSize = this.config.chunkSize || 1000;
    let currentChunk: any[] = [];
    let lastStatusUpdate = Date.now();
    let codeSystemMetadata: any = null;
    
    // Helper function to write a chunk file
    const writeChunk = (concepts: any[], chunkIndex: number): string => {
      const chunkFile = path.join(stagingDir, `concepts-chunk-${chunkIndex.toString().padStart(4, '0')}.json`);
      fs.writeFileSync(chunkFile, JSON.stringify(concepts, null, 2));
      return chunkFile;
    };
    
    return new Promise((resolve, reject) => {
      // First, extract metadata by reading the beginning of the file
      const metadataStream = fs.createReadStream(sourceFilePath, { encoding: 'utf8', start: 0, end: 10000 });
      let metadataContent = '';
      
      metadataStream.on('data', (chunk) => {
        metadataContent += chunk;
      });
      
      metadataStream.on('end', () => {
        try {
          // Extract metadata before concept array
          const conceptStart = metadataContent.indexOf('"concept": [');
          if (conceptStart > 0) {
            const metadataJson = metadataContent.substring(0, conceptStart) + '"concept": []\n}';
            codeSystemMetadata = JSON.parse(metadataJson);
            if (this.config.verbose) {
              console.info(`${LogPrefixes.STAGE_2_SPLIT} Extracted CodeSystem metadata`);
            }
          } else {
            throw new Error('Could not find concept array in CodeSystem file');
          }
        } catch (parseError) {
          reject(new Error(`Failed to parse CodeSystem metadata: ${parseError}`));
          return;
        }
        
        // Now process the concepts using streaming JSON parser
        const pipeline = new chain([
          fs.createReadStream(sourceFilePath),
          streamJson.parser(),
          new pick({ filter: 'concept' }),
          new streamArray()
        ]);
        
        pipeline.on('data', (data: any) => {
          try {
            const concept = data.value;
            currentChunk.push(concept);
            conceptCount++;
            
            // Write chunk when we reach chunk size
            if (currentChunk.length >= chunkSize) {
              const chunkFile = writeChunk(currentChunk, chunkIndex);
              chunkFiles.push(chunkFile);
              if (this.config.verbose) {
                console.info(`${LogPrefixes.STAGE_2_SPLIT} Created chunk ${chunkIndex} with ${currentChunk.length} concepts (total: ${conceptCount})`);
              }
              currentChunk = [];
              chunkIndex++;
            }
            
            // Provide status updates every 5 seconds
            const now = Date.now();
            if (now - lastStatusUpdate > 5000 && this.config.verbose) {
              console.info(`${LogPrefixes.STAGE_2_SPLIT} Processed ${conceptCount} concepts so far...`);
              lastStatusUpdate = now;
            }
          } catch (error) {
            console.warn(`${LogPrefixes.STAGE_2_SPLIT} Skipping malformed concept: ${error}`);
          }
        });
        
        pipeline.on('end', () => {
          try {
            // Write final chunk if we have remaining concepts
            if (currentChunk.length > 0) {
              const chunkFile = writeChunk(currentChunk, chunkIndex);
              chunkFiles.push(chunkFile);
              if (this.config.verbose) {
                console.info(`${LogPrefixes.STAGE_2_SPLIT} Created final chunk ${chunkIndex} with ${currentChunk.length} concepts`);
              }
            }
            
            // Write base CodeSystem file with metadata but no concepts
            if (codeSystemMetadata) {
              fs.writeFileSync(baseFile, JSON.stringify(codeSystemMetadata, null, 2));
              if (this.config.verbose) {
                console.info(`${LogPrefixes.STAGE_2_SPLIT} Created base CodeSystem with ${chunkFiles.length} concept chunks (${conceptCount} total concepts)`);
              }
            }
            
            if (this.config.verbose) {
              console.info(`${LogPrefixes.STAGE_2_SPLIT} Successfully processed ${conceptCount} concepts`);
            }
            resolve({ baseFile, chunkFiles });
          } catch (error) {
            reject(new Error(`Failed to create base CodeSystem file: ${error}`));
          }
        });
        
        pipeline.on('error', (error: any) => {
          console.error(`${LogPrefixes.STAGE_2_SPLIT} Pipeline error:`, error);
          reject(error);
        });
      });
      
      metadataStream.on('error', (error) => {
        reject(new Error(`Failed to read CodeSystem file for metadata: ${error}`));
      });
    });
  }
}
