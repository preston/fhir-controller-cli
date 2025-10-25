import fs from 'fs';
import path from 'path';
import { FileHandler } from './base/file-handler.js';
import { TerminologyHandlerFactory } from './terminology/terminology-handler-factory.js';
import { TerminologyFileInfo } from './types/terminology-config.js';
import { SnomedFileReader } from './terminology/snomed-file-reader.js';
import { SnomedMetadataExtractor } from './terminology/snomed-metadata-extractor.js';
import { CodeSystemChunker } from './utilities/codesystem-chunker.js';
import { LogPrefixes } from './constants/log-prefixes.js';

export class TerminologyUtilities {
  public fileHandler: FileHandler;
  private snomedFileReader: SnomedFileReader;
  private codeSystemChunker: CodeSystemChunker;
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
    this.snomedFileReader = new SnomedFileReader({ verbose });
    this.codeSystemChunker = new CodeSystemChunker({ verbose, chunkSize: batchSize });
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
    let stagingDir = this.fileHandler.findStagingDirectory(this.tempDir);
    
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
      if (this.fileHandler.isStagingDirectory(filePath)) {
        const jsonFiles = fs.readdirSync(filePath).filter(file => 
          file.endsWith('.json') && 
          !file.includes('-base') && 
          !file.includes('concepts-chunk')
        );
        if (jsonFiles.length > 0) {
          jsonFilePath = path.join(filePath, jsonFiles[0]);
          console.info(`${LogPrefixes.STAGE_2_SPLIT} Found existing JSON file in staging directory: ${jsonFilePath}`);
        }
      } else if (this.fileHandler.isStagingDirectory(stagingDir)) {
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
        jsonFilePath = this.fileHandler.findSnomedJsonFile(filePath, this.tempDir);
      }
      
      if (!jsonFilePath) {
        throw new Error(`SNOMED JSON file not found. Please run Stage 1 first.`);
      }
      
      console.info(`${LogPrefixes.STAGE_2_SPLIT} Using SNOMED JSON file: ${jsonFilePath}`);
      
      // Split the JSON file directly without copying
      const splitResult = await this.codeSystemChunker.splitCodeSystemFile(jsonFilePath, stagingDir);
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
        const splitResult = await this.codeSystemChunker.splitCodeSystemFile(stagedFilePath, stagingDir);
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
      const stagingDir = this.fileHandler.findStagingDirectory(this.tempDir);
      if (!stagingDir) {
        throw new Error('No staging files found for upload. Cannot skip upload stage.');
      }
      
      // Find the most recent files for this terminology type
      const filePath = this.fileHandler.findMostRecentFiles(this.tempDir, terminologyType);
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
    
    const terminologyPath = this.snomedFileReader.findTerminologyPath(directoryPath);
    if (!terminologyPath) {
      throw new Error('Could not find terminology files in SNOMED CT directory');
    }

    const version = SnomedMetadataExtractor.extractSnomedVersion(directoryPath);
    const namespace = SnomedMetadataExtractor.extractSnomedNamespace(directoryPath);
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

    // Load descriptions and relationships first
    const descriptions = await this.snomedFileReader.loadSnomedDescriptions(terminologyPath);
    const relationships = await this.snomedFileReader.loadSnomedRelationships(terminologyPath);

    // Process concepts in streaming fashion
    await this.snomedFileReader.processSnomedConceptsStreaming(terminologyPath, writeStream, descriptions, relationships);

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
   * Upload SNOMED terminology from base file and chunk files created in Stage 2
   */
  private async uploadSnomedFromJson(
    fhirUrl: string,
    handler: any
  ): Promise<void> {
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Starting SNOMED CT terminology processing...`);
    
    // Find the staging directory created in Stage 1/2
    const stagingDir = this.fileHandler.findStagingDirectory(this.tempDir);
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
    
    // Read the base CodeSystem to get the ID for potential deletion
    const baseContent = this.fileHandler.readFile(baseFilePath);
    const baseCodeSystem = JSON.parse(baseContent);
    
    // Delete existing CodeSystems if replace option is enabled
    if (this.replace) {
      console.info(`${LogPrefixes.REPLACE} Checking for existing CodeSystems to delete...`);
      const exists = await handler.fhirClient.checkResourceExists(fhirUrl, 'CodeSystem', baseCodeSystem.id);
      if (exists) {
        console.info(`${LogPrefixes.REPLACE} Deleting existing CodeSystem: ${baseCodeSystem.id}`);
        await handler.fhirClient.deleteResource(fhirUrl, 'CodeSystem', baseCodeSystem.id);
      }
    }
    
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
    await handler.uploadCodeSystem(baseCodeSystem, fhirUrl);
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Successfully uploaded base CodeSystem ${baseCodeSystem.id}`);
    
    // Upload concept chunks using delta operations via StagedUploadStrategy
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Uploading ${chunkFiles.length} concept chunks...`);
    for (let i = 0; i < chunkFiles.length; i++) {
      const chunkFile = path.join(stagingDir, chunkFiles[i]);
      
      // Use the existing method from StagedUploadStrategy with chunk info
      await stagedStrategy.applyCodeSystemDeltaAdd(baseCodeSystem.id, fhirUrl, chunkFile, { current: i + 1, total: chunkFiles.length });
      
      // Log progress every 10 chunks
      if ((i + 1) % 10 === 0) {
        console.info(`${LogPrefixes.STAGE_3_UPLOAD} Progress: ${i + 1}/${chunkFiles.length} chunks uploaded`);
      }
    }
    
    console.info(`${LogPrefixes.STAGE_3_UPLOAD} Successfully uploaded CodeSystem ${baseCodeSystem.id} with ${chunkFiles.length} concept chunks`);
    
    // Create and upload ValueSet using the StagedUploadStrategy
    console.info(`${LogPrefixes.VALUESET} Creating ValueSet for all codes in CodeSystem ${baseCodeSystem.id}...`);
    await stagedStrategy.createAndUploadValueSet(baseCodeSystem, fhirUrl);
    
    await handler.printResourceSummary(fhirUrl, 'SNOMED CT');
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
      console.info(`${LogPrefixes.STAGE_2_SPLIT} Stage 2: Splitting ${terminologyType.toUpperCase()} terminology`);
      await this.splitTerminology(currentFilePath, terminologyType);
    } else {
      console.info(`${LogPrefixes.STAGE_2_SPLIT} Stage 2: Skipping splitting`);
    }
    
    // Stage 3: Upload (unless skipped)
    if (!skipOptions.skipUpload) {
      console.info(`${LogPrefixes.STAGE_3_UPLOAD} Stage 3: Uploading ${terminologyType.toUpperCase()} terminology`);
      
      // Find staging directory for upload - look specifically for staging directories
      const stagingDir = this.fileHandler.findStagingDirectory(this.tempDir);
      if (!stagingDir) {
        throw new Error('No staging files found for upload. Cannot skip upload stage.');
      }
      
      await this.uploadTerminologyFromStaging(stagingDir, fhirUrl, terminologyType);
    } else {
      console.info(`${LogPrefixes.STAGE_3_UPLOAD} Stage 3: Skipping upload`);
    }
    
    console.info(`${LogPrefixes.IMPORT} ${terminologyType.toUpperCase()} terminology import completed successfully`);
  }



}
