import fs from 'fs';
import path from 'path';
import readline from 'readline';
import chain from 'stream-chain';
import streamJson from 'stream-json';
import pick from 'stream-json/filters/Pick';
import streamArray from 'stream-json/streamers/StreamArray';
import { FileHandler } from './base/file-handler.js';
import { TerminologyHandlerFactory } from './terminology/terminology-handler-factory.js';
import { TerminologyFileInfo } from '../types/terminology-config.js';
import { LogPrefixes } from '../constants/log-prefixes.js';

export class TerminologyUtilities {
  private fileHandler: FileHandler;
  private dryRun: boolean = false;
  private verbose: boolean = false;
  private tempDir: string;
  private keepTemp: boolean = false;
  private replace: boolean = false;
  private batchSize: number = 1000;

  constructor(dryRun: boolean = false, verbose: boolean = false, tempDir: string, keepTemp: boolean = false, replace: boolean = false, batchSize: number = 1000) {
    this.dryRun = dryRun;
    this.verbose = verbose;
    this.tempDir = tempDir;
    this.keepTemp = keepTemp;
    this.replace = replace;
    this.batchSize = batchSize;
    this.fileHandler = new FileHandler({ verbose });
  }

  async uploadTerminology(
    filePath: string,
    fhirUrl: string,
    terminologyType: 'snomed' | 'loinc' | 'rxnorm'
  ): Promise<void> {
    console.info(`Processing ${terminologyType} terminology from: ${filePath}`);
    
    let actualFilePath = filePath;
    
    if (terminologyType === 'snomed') {
      const validation = this.fileHandler.validateSnomedDirectory(filePath);
      if (!validation.valid) {
        throw new Error(`SNOMED CT directory validation failed: ${filePath}`);
      }
      actualFilePath = validation.conceptFile!;
    } else {
      if (!this.fileHandler.validateFile(filePath)) {
        throw new Error(`File validation failed: ${filePath}`);
      }
    }
    
    const fileInfo = this.fileHandler.analyzeFile(actualFilePath, terminologyType);
    
    const handler = TerminologyHandlerFactory.createHandler(terminologyType, {
      dryRun: this.dryRun,
      verbose: this.verbose,
      tempDir: this.tempDir,
      keepTemp: this.keepTemp,
      replace: this.replace,
      batchSize: this.batchSize
    });
    
    await handler.processAndUpload(fileInfo, fhirUrl);
  }

  validateFile(filePath: string, allowDirectory: boolean = false): boolean {
    return this.fileHandler.validateFile(filePath, allowDirectory);
  }

  getFileSize(filePath: string): number {
    return this.fileHandler.getFileSize(filePath);
  }

  async preprocessTerminology(
    filePath: string,
    terminologyType: 'snomed' | 'loinc' | 'rxnorm'
  ): Promise<void> {
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Starting preprocessing for ${terminologyType} terminology from: ${filePath}`);
    
    if (terminologyType === 'snomed') {
      const validation = this.fileHandler.validateSnomedDirectory(filePath);
      if (!validation.valid) {
        throw new Error(`SNOMED CT directory validation failed: ${filePath}`);
      }
      
      // Create staging directory for preprocessing
      const stagingDir = `${this.tempDir}/fhir-staging-${Date.now()}`;
      this.fileHandler.ensureDirectoryExists(stagingDir);
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Using staging directory: ${stagingDir}`);
      
      // For SNOMED, create the CodeSystem JSON file in Stage 1
      await this.preprocessSnomedDirectory(filePath, stagingDir);
    } else {
      if (!this.fileHandler.validateFile(filePath)) {
        throw new Error(`File validation failed: ${filePath}`);
      }
      
      // For other terminology types, just validate the file
      const fileInfo = this.fileHandler.analyzeFile(filePath, terminologyType);
      console.info(`${LogPrefixes.STAGE_1_PREPROCESS} File analysis complete: ${fileInfo.fileSize?.toFixed(2) || 'unknown'} MB, ${fileInfo.estimatedConcepts || 'unknown'} estimated concepts`);
    }
    
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} ${terminologyType.toUpperCase()} preprocessing completed successfully`);
  }

  async splitTerminology(
    filePath: string,
    terminologyType: 'snomed' | 'loinc' | 'rxnorm'
  ): Promise<void> {
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Starting splitting for ${terminologyType} terminology from: ${filePath}`);
    
    // Check if there's already a staging directory from Stage 1
    let stagingDir = this.findStagingDirectory(this.tempDir);
    
    if (!stagingDir) {
      // Create new staging directory if none exists
      stagingDir = `${this.tempDir}/fhir-staging-${Date.now()}`;
      this.fileHandler.ensureDirectoryExists(stagingDir);
      console.info(`${LogPrefixes.STAGE_2_SPLIT} Created new staging directory: ${stagingDir}`);
    } else {
      console.info(`${LogPrefixes.STAGE_2_SPLIT} Reusing existing staging directory: ${stagingDir}`);
    }
    
    if (terminologyType === 'snomed') {
      let jsonFilePath: string | null = null;
      
      // If we're working with a staging directory that already contains a JSON file, use it directly
      if (this.isStagingDirectory(filePath)) {
        const jsonFiles = fs.readdirSync(filePath).filter(file => 
          file.endsWith('.json') && 
          !file.includes('-base') && 
          !file.includes('concepts-chunk')
        );
        if (jsonFiles.length > 0) {
          jsonFilePath = path.join(filePath, jsonFiles[0]);
          console.info(`${LogPrefixes.STAGE_2_SPLIT} Found existing JSON file in staging directory: ${jsonFilePath}`);
        }
      } else if (this.isStagingDirectory(stagingDir)) {
        // If we're reusing a staging directory, look for JSON files inside it
        const jsonFiles = fs.readdirSync(stagingDir).filter(file => 
          file.endsWith('.json') && 
          !file.includes('-base') && 
          !file.includes('concepts-chunk')
        );
        if (jsonFiles.length > 0) {
          jsonFilePath = path.join(stagingDir, jsonFiles[0]);
          console.info(`${LogPrefixes.STAGE_2_SPLIT} Found existing JSON file in reused staging directory: ${jsonFilePath}`);
        }
      } else {
        // For SNOMED, find the JSON file created in Stage 1
        jsonFilePath = this.findSnomedJsonFile(filePath);
      }
      
      if (!jsonFilePath) {
        throw new Error(`SNOMED JSON file not found. Please run Stage 1 first.`);
      }
      
      console.info(`${LogPrefixes.STAGE_2_SPLIT} Using SNOMED JSON file: ${jsonFilePath}`);
      
      // Split the JSON file directly without copying
      const splitResult = await this.splitCodeSystemFile(jsonFilePath, stagingDir);
      console.info(`${LogPrefixes.STAGE_2_SPLIT} Created ${splitResult.chunkFiles.length} concept chunks from ${jsonFilePath}`);
      console.info(`${LogPrefixes.STAGE_2_SPLIT} Base file: ${splitResult.baseFile}`);
    } else {
      // For other terminology types, use the existing logic
      const handler = TerminologyHandlerFactory.createHandler(terminologyType, {
        dryRun: this.dryRun,
        verbose: this.verbose,
        tempDir: this.tempDir,
        keepTemp: this.keepTemp,
        replace: this.replace,
        batchSize: this.batchSize
      });
      
      // Create file info for the handler
      const fileInfo = this.fileHandler.analyzeFile(filePath, terminologyType);
      
      // Process the terminology and create a staged file
      const stagedFilePath = await handler.processAndStage(fileInfo, stagingDir);
      
      // Now split the staged file using the existing chunking logic
      if (stagedFilePath && this.fileHandler.fileExists(stagedFilePath)) {
        const splitResult = await this.splitCodeSystemFile(stagedFilePath, stagingDir);
        console.info(`${LogPrefixes.STAGE_2_SPLIT} Created ${splitResult.chunkFiles.length} concept chunks from ${stagedFilePath}`);
        console.info(`${LogPrefixes.STAGE_2_SPLIT} Base file: ${splitResult.baseFile}`);
      } else {
        throw new Error(`Failed to create staged file for ${terminologyType} terminology`);
      }
    }
    
    console.info(`${LogPrefixes.STAGE_2_SPLIT} ${terminologyType.toUpperCase()} splitting completed successfully`);
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Split files saved to: ${stagingDir}`);
  }

  async uploadTerminologyFromStaging(
    tempDir: string,
    fhirUrl: string,
    terminologyType: 'snomed' | 'loinc' | 'rxnorm'
  ): Promise<void> {
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Starting upload for ${terminologyType} terminology from staging directory: ${tempDir}`);
    
    // Use the existing terminology processing logic but with staged files
    const handler = TerminologyHandlerFactory.createHandler(terminologyType, {
      dryRun: this.dryRun,
      verbose: this.verbose,
      tempDir: this.tempDir,
      keepTemp: this.keepTemp,
      replace: this.replace,
      batchSize: this.batchSize
    });
    
    // For SNOMED, use the JSON file created in Stage 1
    if (terminologyType === 'snomed') {
      await this.uploadSnomedFromJson(fhirUrl, handler);
    } else {
      // For other terminology types, use the existing logic
      const stagingDir = this.findStagingDirectory(this.tempDir);
      if (!stagingDir) {
        throw new Error('No staging files found for upload. Cannot skip upload stage.');
      }
      
      // Find the most recent files for this terminology type
      const filePath = this.findMostRecentFiles(this.tempDir, terminologyType);
      if (!filePath) {
        throw new Error(`No recent ${terminologyType.toUpperCase()} files found for upload.`);
      }
      
      const fileInfo = this.fileHandler.analyzeFile(filePath, terminologyType);
      await handler.processAndUpload(fileInfo, fhirUrl);
    }
    
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} ${terminologyType.toUpperCase()} upload completed successfully`);
  }

  /**
   * Preprocess SNOMED directory and create CodeSystem JSON file in Stage 1
   */
  private async preprocessSnomedDirectory(directoryPath: string, stagingDir: string): Promise<string> {
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Starting SNOMED CT terminology processing...`);
    
    const terminologyPath = this.findSnomedTerminologyPath(directoryPath);
    if (!terminologyPath) {
      throw new Error('Could not find terminology files in SNOMED CT directory');
    }

    const version = this.extractSnomedVersion(directoryPath);
    const namespace = this.extractSnomedNamespace(directoryPath);
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Using SNOMED CT version: ${version}`);
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Using SNOMED CT namespace: ${namespace}`);

    // Create the CodeSystem JSON file in staging directory
    const codeSystemId = `sct-${namespace}-${version.split('/').pop() || 'current'}`;
    const jsonFilePath = path.join(stagingDir, `${codeSystemId}.json`);
    
    // Create CodeSystem header
    const header = `{
  "resourceType": "CodeSystem",
  "id": "${codeSystemId}",
  "url": "http://snomed.info/sct",
  "version": "${version}",
  "name": "SNOMED_CT",
  "status": "active",
  "concept": [`;

    // Write header and process concepts
    const writeStream = fs.createWriteStream(jsonFilePath);
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

    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Created SNOMED CT CodeSystem: ${jsonFilePath}`);
    return jsonFilePath;
  }

  /**
   * Find terminology path in SNOMED directory
   */
  private findSnomedTerminologyPath(directoryPath: string): string | null {
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
   * Extract SNOMED version from directory path
   */
  private extractSnomedVersion(filePath: string): string {
    try {
      const pathParts = filePath.split('/');
      const dirName = pathParts[pathParts.length - 1];
      
      const dateMatch = dirName.match(/(\d{8})/);
      if (dateMatch) {
        const date = dateMatch[1];
        const namespace = this.extractSnomedNamespace(filePath);
        return `http://snomed.info/sct/${namespace}/version/${date}`;
      }
      
      throw new Error(`Could not extract SNOMED CT version from directory path: ${filePath}`);
    } catch (error) {
      console.error('Failed to extract SNOMED CT version from data:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`SNOMED CT version extraction failed: ${errorMessage}`);
    }
  }

  /**
   * Extract SNOMED namespace from directory path
   */
  private extractSnomedNamespace(filePath: string): string {
    try {
      const pathParts = filePath.split('/');
      const dirName = pathParts[pathParts.length - 1];
      
      const namespaceMatch = dirName.match(/(US|INT|AU|CA|NL|SE|DK|BE|ES|CH|IE|NZ|PL|PT|BR|MX|AR|CL|CO|PE|UY|VE|EC|BO|PY|GY|SR|TT|JM|BB|BS|BZ|CR|CU|DO|GT|HN|NI|PA|SV|HT|DM|AG|KN|LC|VC|GD)(\d{7})/);
      if (namespaceMatch) {
        const countryCode = namespaceMatch[1];
        const number = namespaceMatch[2];
        return `${countryCode}${number}`;
      }
      
      throw new Error(`Could not extract SNOMED CT namespace from directory path: ${filePath}`);
    } catch (error) {
      console.error('Failed to extract SNOMED CT namespace from data:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`SNOMED CT namespace extraction failed: ${errorMessage}`);
    }
  }

  /**
   * Process SNOMED concepts using streaming approach with descriptions and relationships
   */
  private async processSnomedConceptsStreaming(terminologyPath: string, writeStream: fs.WriteStream): Promise<void> {
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Starting comprehensive SNOMED CT processing...`);
    
    // First, load descriptions and relationships into memory for lookup
    const descriptions = await this.loadSnomedDescriptions(terminologyPath);
    const relationships = await this.loadSnomedRelationships(terminologyPath);
    
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loaded ${descriptions.size} descriptions and ${relationships.size} relationships`);
    
    // Find the concept file dynamically
    const conceptFiles = fs.readdirSync(terminologyPath).filter(file => 
      file.startsWith('sct2_Concept_Full_') && file.endsWith('.txt')
    );
    
    if (conceptFiles.length === 0) {
      throw new Error(`No concept file found in ${terminologyPath}`);
    }
    
    const conceptFile = path.join(terminologyPath, conceptFiles[0]);
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Using concept file: ${conceptFile}`);

    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Processing concepts from: ${conceptFile}`);
    
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
              console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Processed ${conceptCount} concepts (including both active and inactive)`);
            }
          } else if (conceptCount < 5 && line.trim() !== '') {
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
        console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Completed processing ${conceptCount} concepts`);
        resolve();
      });

      rl.on('error', (error) => {
        console.error(`${LogPrefixes.STAGE_1_PREPROCESS} Error reading concept file: ${error}`);
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
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Available files in ${terminologyPath}:`, allFiles);
    
    // Try multiple patterns for description files
    const descriptionFiles = fs.readdirSync(terminologyPath).filter(file => 
      (file.startsWith('sct2_Description_Full') || 
       file.startsWith('sct2_Description_') ||
       (file.includes('Description') && file.endsWith('.txt')))
    );
    
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Found description files:`, descriptionFiles);
    
    if (descriptionFiles.length === 0) {
      console.warn(`${LogPrefixes.STAGE_1_PREPROCESS} No description file found, using fallback display text`);
      return new Map();
    }
    
    const descriptionFile = path.join(terminologyPath, descriptionFiles[0]);
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loading descriptions from: ${descriptionFile}`);
    
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
        console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loaded ${processedCount} descriptions for ${descriptions.size} concepts`);
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
  private async loadSnomedRelationships(terminologyPath: string): Promise<Map<string, any[]>> {
    // Try multiple patterns for relationship files
    const relationshipFiles = fs.readdirSync(terminologyPath).filter(file => 
      (file.startsWith('sct2_Relationship_Full') || 
       file.startsWith('sct2_Relationship_') ||
       (file.includes('Relationship') && file.endsWith('.txt')))
    );
    
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Found relationship files:`, relationshipFiles);
    
    if (relationshipFiles.length === 0) {
      console.warn(`${LogPrefixes.STAGE_1_PREPROCESS} No relationship file found`);
      return new Map();
    }
    
    const relationshipFile = path.join(terminologyPath, relationshipFiles[0]);
    console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loading relationships from: ${relationshipFile}`);
    
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
        console.info(`${LogPrefixes.STAGE_1_PREPROCESS} Loaded ${processedCount} relationships for ${relationships.size} concepts`);
        resolve(relationships);
      });

      rl.on('error', (error) => {
        console.error(`${LogPrefixes.STAGE_1_PREPROCESS} Error reading relationship file: ${error}`);
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

    // Include all concepts regardless of active status

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
      ]
    };
  }

  /**
   * Check if the given path is a staging directory
   */
  private isStagingDirectory(filePath: string): boolean {
    return fs.statSync(filePath).isDirectory() && path.basename(filePath).startsWith('fhir-staging-');
  }

  /**
   * Find SNOMED JSON file created in Stage 1
   */
  private findSnomedJsonFile(originalFilePath: string): string | null {
    // Extract namespace and version from the original file path
    const version = this.extractSnomedVersion(originalFilePath);
    const namespace = this.extractSnomedNamespace(originalFilePath);
    const versionId = version.split('/').pop() || 'current';
    const codeSystemId = `sct-${namespace}-${versionId}`;
    const jsonFilePath = path.join(this.tempDir, `${codeSystemId}.json`);
    
    if (this.fileHandler.fileExists(jsonFilePath)) {
      return jsonFilePath;
    }
    
    return null;
  }

  /**
   * Upload SNOMED terminology from base file and chunk files created in Stage 2
   */
  private async uploadSnomedFromJson(
    fhirUrl: string,
    handler: any
  ): Promise<void> {
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Starting SNOMED CT terminology processing...`);
    
    // Find the staging directory created in Stage 1/2
    const stagingDir = this.findStagingDirectory(this.tempDir);
    if (!stagingDir) {
      throw new Error(`No staging directory found in temp directory. Please run Stage 1 and Stage 2 first.`);
    }
    
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Using staging directory: ${stagingDir}`);
    
    // Find the base file and chunk files created in Stage 2
    const baseFiles = this.fileHandler.listFiles(stagingDir).filter(file => 
      file.endsWith('-base.json')
    );
    
    const chunkFiles = this.fileHandler.listFiles(stagingDir).filter(file => 
      file.includes('concepts-chunk-') && file.endsWith('.json')
    ).sort(); // Sort to ensure proper order
    
    if (baseFiles.length === 0) {
      throw new Error(`No base CodeSystem file found in staging directory. Please run Stage 2 first.`);
    }
    
    if (chunkFiles.length === 0) {
      throw new Error(`No concept chunk files found in staging directory. Please run Stage 2 first.`);
    }
    
    const baseFilePath = path.join(stagingDir, baseFiles[0]);
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Using base CodeSystem file: ${baseFilePath}`);
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Found ${chunkFiles.length} concept chunk files`);
    
    // Use StagedUploadStrategy to handle the upload process
    const { StagedUploadStrategy } = await import('./strategies/staged-upload-strategy.js');
    const stagedStrategy = new StagedUploadStrategy({
      dryRun: this.dryRun,
      verbose: this.verbose,
      tempDir: this.tempDir,
      keepTemp: this.keepTemp
    });
    
    // Upload base CodeSystem (metadata only)
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Uploading base CodeSystem...`);
    const baseContent = this.fileHandler.readFile(baseFilePath);
    const baseCodeSystem = JSON.parse(baseContent);
    await handler.uploadCodeSystem(baseCodeSystem, fhirUrl);
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Successfully uploaded base CodeSystem ${baseCodeSystem.id}`);
    
    // Upload concept chunks using delta operations via StagedUploadStrategy
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Uploading ${chunkFiles.length} concept chunks...`);
    for (let i = 0; i < chunkFiles.length; i++) {
      const chunkFile = path.join(stagingDir, chunkFiles[i]);
      console.info(`${LogPrefixes.STAGE_3_UPLOAD} Uploading chunk ${i + 1}/${chunkFiles.length}: ${chunkFiles[i]}`);
      
      // Use the existing method from StagedUploadStrategy
      await stagedStrategy.applyCodeSystemDeltaAdd(baseCodeSystem.id, fhirUrl, chunkFile);
      
      // Log progress every 10 chunks
      if ((i + 1) % 10 === 0) {
        console.info(`${LogPrefixes.STAGE_3_UPLOAD} Progress: ${i + 1}/${chunkFiles.length} chunks uploaded`);
      }
    }
    
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Successfully uploaded CodeSystem ${baseCodeSystem.id} with ${chunkFiles.length} concept chunks`);
    console.info(`${LogPrefixes.VALUESET} Skipping ValueSet creation to avoid memory issues with large SNOMED CT datasets`);
    
    await handler.printResourceSummary(fhirUrl, 'SNOMED CT');
  }

  /**
   * Find the most recent files in temp directory for a given terminology type
   */
  findMostRecentFiles(tempDir: string, terminologyType: 'snomed' | 'loinc' | 'rxnorm'): string | null {
    console.info(`${LogPrefixes.DISCOVERY} Looking for most recent ${terminologyType.toUpperCase()} files in: ${tempDir}`);
    
    // Look for staging directories first (these are what we need for upload)
    const stagingDirs = this.fileHandler.listFiles(tempDir).filter(dir => 
      dir.startsWith('fhir-staging-') && this.fileHandler.isDirectory(`${tempDir}/${dir}`)
    );
    
    if (stagingDirs.length > 0) {
      // Sort by timestamp (newest first)
      stagingDirs.sort((a, b) => {
        const timestampA = parseInt(a.replace('fhir-staging-', ''));
        const timestampB = parseInt(b.replace('fhir-staging-', ''));
        return timestampB - timestampA;
      });
      
      const mostRecentStaging = stagingDirs[0];
      const stagingPath = `${tempDir}/${mostRecentStaging}`;
      console.info(`${LogPrefixes.DISCOVERY} Found most recent staging directory: ${stagingPath}`);
      return stagingPath;
    }
    
    // Fallback to preprocessing metadata for other stages
    const metadataFile = `${tempDir}/preprocess-metadata.json`;
    if (this.fileHandler.fileExists(metadataFile)) {
      try {
        const metadata = JSON.parse(this.fileHandler.readFile(metadataFile));
        if (metadata.terminologyType === terminologyType && metadata.processedPath) {
          console.info(`${LogPrefixes.DISCOVERY} Found preprocessing metadata for ${terminologyType.toUpperCase()}`);
          return metadata.processedPath;
        }
      } catch (error) {
        console.warn(`${LogPrefixes.DISCOVERY} Could not read preprocessing metadata: ${error}`);
      }
    }
    
    console.warn(`${LogPrefixes.DISCOVERY} No recent ${terminologyType.toUpperCase()} files found in temp directory`);
    return null;
  }

  /**
   * Find the most recent staging directory for upload
   */
  findStagingDirectory(tempDir: string): string | null {
    console.info(`${LogPrefixes.DISCOVERY} Looking for staging directories in: ${tempDir}`);
    
    // Look for staging directories
    const stagingDirs = this.fileHandler.listFiles(tempDir).filter(dir => 
      dir.startsWith('fhir-staging-') && this.fileHandler.isDirectory(`${tempDir}/${dir}`)
    );
    
    if (stagingDirs.length > 0) {
      // Sort by timestamp (newest first)
      stagingDirs.sort((a, b) => {
        const timestampA = parseInt(a.replace('fhir-staging-', ''));
        const timestampB = parseInt(b.replace('fhir-staging-', ''));
        return timestampB - timestampA;
      });
      
      const mostRecentStaging = stagingDirs[0];
      const stagingPath = `${tempDir}/${mostRecentStaging}`;
      console.info(`${LogPrefixes.DISCOVERY} Found most recent staging directory: ${stagingPath}`);
      return stagingPath;
    }
    
    console.warn(`${LogPrefixes.DISCOVERY} No staging directories found in temp directory`);
    return null;
  }

  /**
   * Import terminology with skip options
   */
  async importTerminologyWithSkips(
    filePath: string,
    fhirUrl: string,
    terminologyType: 'snomed' | 'loinc' | 'rxnorm',
    skipOptions: {
      skipPreprocess: boolean;
      skipSplit: boolean;
      skipUpload: boolean;
    }
  ): Promise<void> {
    console.info(`${LogPrefixes.IMPORT} Starting ${terminologyType.toUpperCase()} terminology import with skip options`);
    
    let currentFilePath = filePath;
    
    // Stage 1: Preprocessing (unless skipped)
    if (!skipOptions.skipPreprocess) {
      console.info(`${LogPrefixes.IMPORT} Stage 1: Preprocessing ${terminologyType.toUpperCase()} terminology`);
      await this.preprocessTerminology(currentFilePath, terminologyType);
    } else {
      console.info(`${LogPrefixes.IMPORT} Stage 1: Skipping preprocessing`);
    }
    
    // Stage 2: Splitting (unless skipped)
    if (!skipOptions.skipSplit) {
      console.info(`${LogPrefixes.IMPORT} Stage 2: Splitting ${terminologyType.toUpperCase()} terminology`);
      await this.splitTerminology(currentFilePath, terminologyType);
    } else {
      console.info(`${LogPrefixes.IMPORT} Stage 2: Skipping splitting`);
    }
    
    // Stage 3: Upload (unless skipped)
    if (!skipOptions.skipUpload) {
      console.info(`${LogPrefixes.IMPORT} Stage 3: Uploading ${terminologyType.toUpperCase()} terminology`);
      
      // Find staging directory for upload - look specifically for staging directories
      const stagingDir = this.findStagingDirectory(this.tempDir);
      if (!stagingDir) {
        throw new Error('No staging files found for upload. Cannot skip upload stage.');
      }
      
      await this.uploadTerminologyFromStaging(stagingDir, fhirUrl, terminologyType);
    } else {
      console.info(`${LogPrefixes.IMPORT} Stage 3: Skipping upload`);
    }
    
    console.info(`${LogPrefixes.IMPORT} ${terminologyType.toUpperCase()} terminology import completed successfully`);
  }

  /**
   * Split large CodeSystem file into base metadata and concept chunks using streaming JSON parser
   */
  private async splitCodeSystemFile(sourceFilePath: string, stagingDir: string): Promise<{ baseFile: string; chunkFiles: string[] }> {
    console.info(`${LogPrefixes.STAGE_2_SPLIT} Splitting large CodeSystem file: ${sourceFilePath}`);
    
    const baseFileName = path.basename(sourceFilePath).replace('.json', '-base.json');
    const baseFile = path.join(stagingDir, baseFileName);
    const chunkFiles: string[] = [];
    
    let conceptCount = 0;
    let chunkIndex = 0;
    const chunkSize = 1000;
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
            console.info(`${LogPrefixes.STAGE_2_SPLIT} Extracted CodeSystem metadata`);
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
              console.info(`${LogPrefixes.STAGE_2_SPLIT} Created chunk ${chunkIndex} with ${currentChunk.length} concepts (total: ${conceptCount})`);
              currentChunk = [];
              chunkIndex++;
            }
            
            // Provide status updates every 5 seconds
            const now = Date.now();
            if (now - lastStatusUpdate > 5000) {
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
              console.info(`${LogPrefixes.STAGE_2_SPLIT} Created final chunk ${chunkIndex} with ${currentChunk.length} concepts`);
            }
            
            // Write base CodeSystem file with metadata but no concepts
            if (codeSystemMetadata) {
              fs.writeFileSync(baseFile, JSON.stringify(codeSystemMetadata, null, 2));
              console.info(`${LogPrefixes.STAGE_2_SPLIT} Created base CodeSystem with ${chunkFiles.length} concept chunks (${conceptCount} total concepts)`);
            }
            
            console.info(`${LogPrefixes.STAGE_2_SPLIT} Successfully processed ${conceptCount} concepts`);
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
