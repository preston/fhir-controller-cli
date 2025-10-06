// Author: Preston Lee

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { CodeSystem, ValueSet, ConceptMap } from 'fhir/r4';
import { TerminologyProcessor } from './terminology-processor';
import { TerminologyConfig, TerminologyFileInfo } from '../types/terminology-config';

export class TerminologyUtilities {
  private dryRun: boolean = false;
  private verbose: boolean = false;
  private tempDir: string;
  private keepTemp: boolean = false;

  constructor(dryRun: boolean = false, verbose: boolean = false, tempDir: string, keepTemp: boolean = false) {
    this.dryRun = dryRun;
    this.verbose = verbose;
    this.tempDir = tempDir;
    this.keepTemp = keepTemp;
  }

  /**
   * Upload terminology files to FHIR server
   */
  async uploadTerminology(
    filePath: string,
    fhirUrl: string,
    terminologyType: 'snomed' | 'loinc' | 'rxnorm'
  ): Promise<void> {
    console.info(`Processing ${terminologyType} terminology from: ${filePath}`);
    
    const fileInfo = this.analyzeFile(filePath, terminologyType);
    
    switch (terminologyType) {
      case 'snomed':
        await this.uploadSnomedTerminology(fileInfo, fhirUrl);
        break;
      case 'loinc':
        await this.uploadLoincTerminology(fileInfo, fhirUrl);
        break;
      case 'rxnorm':
        await this.uploadRxNormTerminology(fileInfo, fhirUrl);
        break;
      default:
        throw new Error(`Unsupported terminology type: ${terminologyType}`);
    }
  }

  /**
   * Analyze file to determine type and format
   */
  private analyzeFile(filePath: string, terminologyType: 'snomed' | 'loinc' | 'rxnorm'): TerminologyFileInfo {
    const ext = path.extname(filePath).toLowerCase();
    let format: 'rf2' | 'csv' | 'txt';

    if (ext === '.txt' || ext === '.zip') {
      format = 'rf2';
    } else if (ext === '.csv') {
      format = 'csv';
    } else {
      format = 'txt';
    }

    return {
      filePath,
      fileType: terminologyType,
      format
    };
  }

  /**
   * Upload SNOMED CT terminology
   */
  private async uploadSnomedTerminology(fileInfo: TerminologyFileInfo, fhirUrl: string): Promise<void> {
    console.info('Processing SNOMED CT terminology...');

    // Check if CodeSystem already exists before processing files
    // Try common SNOMED CT ID patterns first
    const commonIds = [
      'sct-731000124108-20250926',
      'sct-731000124108-20250901', 
      'sct-731000124108-20250101',
      'sct-731000124108-current'
    ];
    
    let exists = false;
    let existingId = '';
    for (const id of commonIds) {
      if (await this.checkResourceExists(fhirUrl, 'CodeSystem', id)) {
        exists = true;
        existingId = id;
        break;
      }
    }
    
    if (exists) {
      console.info(`[SKIP] SNOMED CT CodeSystem ${existingId} already exists on server, skipping processing`);
      return;
    }

    // Use the terminology processor to handle complex RF2 files
    const processor = new TerminologyProcessor({
      dryRun: this.dryRun,
      verbose: this.verbose,
      batchSize: 1000
    });

    const codeSystem = await processor.processSnomedFile(fileInfo.filePath);
    await this.uploadResource(codeSystem, fhirUrl, 'CodeSystem');

    // Skip ValueSet creation to avoid memory issues
    console.info(`[VALUESET] Skipping ValueSet creation to avoid memory issues`);

    // Print resource summary
    await this.printResourceSummary(fhirUrl, 'SNOMED CT');
  }

  /**
   * Upload LOINC terminology
   */
  private async uploadLoincTerminology(fileInfo: TerminologyFileInfo, fhirUrl: string): Promise<void> {
    console.info('Processing LOINC terminology...');

    // Check if CodeSystem already exists before processing files
    const expectedId = 'loinc-current';
    const exists = await this.checkResourceExists(fhirUrl, 'CodeSystem', expectedId);
    if (exists) {
      console.info(`[SKIP] LOINC CodeSystem ${expectedId} already exists on server, skipping processing`);
      return;
    }

    const processor = new TerminologyProcessor({
      dryRun: this.dryRun,
      verbose: this.verbose,
      batchSize: 1000
    });

    const codeSystem = await processor.processLoincFile(fileInfo.filePath);
    await this.uploadResource(codeSystem, fhirUrl, 'CodeSystem');

    // Also create and upload a ValueSet for LOINC codes
    if (codeSystem.concept && codeSystem.concept.length > 0) {
      // Create a comprehensive ValueSet with all LOINC concepts
      const valueSet = processor.createLoincValueSet(
        codeSystem.concept,
        'loinc-laboratory-tests',
        'LOINC Laboratory Tests',
        'Laboratory tests and clinical observations from LOINC'
      );
      await this.uploadResource(valueSet, fhirUrl, 'ValueSet');
      console.info(`[VALUESET] Created LOINC ValueSet with ${codeSystem.concept.length} concepts`);
    }

    // Print resource summary
    await this.printResourceSummary(fhirUrl, 'LOINC');
  }

  /**
   * Upload RxNorm terminology
   */
  private async uploadRxNormTerminology(fileInfo: TerminologyFileInfo, fhirUrl: string): Promise<void> {
    console.info('Processing RxNorm terminology...');

    // Check if CodeSystem already exists before processing files
    const expectedId = 'rxnorm-current';
    const exists = await this.checkResourceExists(fhirUrl, 'CodeSystem', expectedId);
    if (exists) {
      console.info(`[SKIP] RxNorm CodeSystem ${expectedId} already exists on server, skipping processing`);
      return;
    }

    const processor = new TerminologyProcessor({
      dryRun: this.dryRun,
      verbose: this.verbose,
      batchSize: 1000
    });

    const codeSystem = await processor.processRxNormFile(fileInfo.filePath);
    await this.uploadResource(codeSystem, fhirUrl, 'CodeSystem');

    // Also create and upload a ValueSet for RxNorm drugs
    if (codeSystem.concept && codeSystem.concept.length > 0) {
      // Create a comprehensive ValueSet with all RxNorm concepts
      const valueSet = processor.createRxNormValueSet(
        codeSystem.concept,
        'rxnorm-drugs',
        'RxNorm Drugs',
        'Drugs and medications from RxNorm'
      );
      await this.uploadResource(valueSet, fhirUrl, 'ValueSet');
      console.info(`[VALUESET] Created RxNorm ValueSet with ${codeSystem.concept.length} concepts`);
    }

    // Print resource summary
    await this.printResourceSummary(fhirUrl, 'RxNorm');
  }

  /**
   * Create SNOMED CT CodeSystem
   */
  private createSnomedCodeSystem(config: TerminologyConfig): CodeSystem {
    return {
      resourceType: 'CodeSystem',
      id: 'sct-731000124108-20250926',
      url: config.url,
      version: config.version,
      name: config.name,
      title: 'SNOMED CT US Edition',
      status: config.status,
      experimental: false,
      publisher: config.publisher,
      description: config.description,
      caseSensitive: true,
      compositional: false,
      versionNeeded: false,
      content: 'complete',
      count: 0, // Will be updated when concepts are added
      concept: [
        {
          code: '404684003',
          display: 'Clinical finding',
          definition: 'A clinical finding is a clinical observation, assessment, or diagnosis'
        },
        {
          code: '71388002',
          display: 'Procedure',
          definition: 'A procedure is a series of actions conducted in a certain order or manner'
        },
        {
          code: '243796009',
          display: 'Situation',
          definition: 'A situation is a circumstance or state of affairs'
        }
      ]
    };
  }

  /**
   * Create LOINC CodeSystem
   */
  private createLoincCodeSystem(config: TerminologyConfig): CodeSystem {
    return {
      resourceType: 'CodeSystem',
      id: 'loinc-current',
      url: config.url,
      version: config.version,
      name: config.name,
      title: 'LOINC',
      status: config.status,
      experimental: false,
      publisher: config.publisher,
      description: config.description,
      caseSensitive: true,
      compositional: false,
      versionNeeded: false,
      content: 'complete',
      count: 0,
      concept: [
        {
          code: '33747-0',
          display: 'Blood pressure panel',
          definition: 'A panel of blood pressure measurements'
        },
        {
          code: '33762-9',
          display: 'Blood pressure systolic',
          definition: 'Systolic blood pressure measurement'
        },
        {
          code: '33747-0',
          display: 'Blood pressure diastolic',
          definition: 'Diastolic blood pressure measurement'
        }
      ]
    };
  }

  /**
   * Create RxNorm CodeSystem
   */
  private createRxNormCodeSystem(config: TerminologyConfig): CodeSystem {
    return {
      resourceType: 'CodeSystem',
      id: 'rxnorm-current',
      url: config.url,
      version: config.version,
      name: config.name,
      title: 'RxNorm',
      status: config.status,
      experimental: false,
      publisher: config.publisher,
      description: config.description,
      caseSensitive: true,
      compositional: false,
      versionNeeded: false,
      content: 'complete',
      count: 0,
      concept: [
        {
          code: '7980',
          display: 'Acetaminophen',
          definition: 'Acetaminophen (Tylenol) - analgesic and antipyretic'
        },
        {
          code: '7980',
          display: 'Ibuprofen',
          definition: 'Ibuprofen - nonsteroidal anti-inflammatory drug'
        }
      ]
    };
  }

  /**
   * Check if a FHIR resource already exists on the server
   */
  async checkResourceExists(fhirUrl: string, resourceType: string, resourceId: string): Promise<boolean> {
    try {
      const response = await axios.get(
        `${fhirUrl}/${resourceType}/${resourceId}`,
        {
          headers: {
            'Accept': 'application/fhir+json',
          },
        }
      );
      return response.status === 200;
    } catch (error: any) {
      if (error?.response?.status === 404) {
        return false; // Resource doesn't exist
      }
      // For other errors, log but don't fail
      console.warn(`Warning: Could not check if ${resourceType} ${resourceId} exists: ${error?.response?.status}`);
      return false;
    }
  }

  /**
   * Upload a FHIR resource to the server
   */
  async uploadResource(resource: any, fhirUrl: string, resourceType: string): Promise<void> {
    if (this.dryRun) {
      console.log(`[DRY RUN] Would upload ${resourceType} to ${fhirUrl}/${resourceType}`);
      if (this.verbose) {
        console.log(JSON.stringify(resource, null, 2));
      }
      return;
    }

    // Check if resource already exists
    const exists = await this.checkResourceExists(fhirUrl, resourceType, resource.id);
    if (exists) {
      console.info(`[SKIP] ${resourceType} ${resource.id} already exists on server, skipping upload`);
      return;
    }

    // Handle large CodeSystems with memory-efficient approach
    if (resourceType === 'CodeSystem' && resource.concept && resource.concept.length > 1000) {
      return this.uploadLargeCodeSystemWithMemoryOptimization(resource, fhirUrl);
    }

    try {
      // Add debugging information
      console.info(`[DEBUG] Uploading ${resourceType} ${resource.id} with ${resource.concept?.length || 0} concepts`);
      
      // Validate resource structure
      if (!resource.id || !resource.resourceType) {
        throw new Error('Invalid resource: missing id or resourceType');
      }
      
      // Check for circular references using safe stringify
      try {
        this.safeStringify(resource);
      } catch (circularError) {
        throw new Error('Resource contains circular references');
      }
      
      // Check resource size
      const resourceSize = this.safeStringify(resource).length;
      console.info(`[DEBUG] Resource size: ${(resourceSize / 1024 / 1024).toFixed(2)} MB`);
      
      if (resourceSize > 50 * 1024 * 1024) { // 50MB limit
        console.warn(`[WARNING] Resource is very large (${(resourceSize / 1024 / 1024).toFixed(2)} MB), this may cause issues`);
      }
      
      const response = await axios.put(
        `${fhirUrl}/${resourceType}/${resource.id}`,
        resource,
        {
          headers: {
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json',
          },
          timeout: 300000, // 5 minute timeout for large resources
        }
      );
      console.info(`[SUCCESS] Uploaded ${resourceType} ${resource.id}: ${response.status} ${response.statusText}`);
    } catch (error: any) {
      console.error(`[FAILURE] Uploading ${resourceType} ${resource.id}:`, error?.response?.status, error?.response?.statusText);
      if (error?.response?.data) {
        console.error(JSON.stringify(error.response.data, null, 2));
      }
      if (error?.code === 'ECONNABORTED') {
        console.error('[ERROR] Request timed out - resource may be too large');
      }
      if (error?.message?.includes('JSON.stringify')) {
        console.error('[ERROR] Resource contains circular references or invalid data');
      }
      throw error;
    }
  }

  /**
   * Upload large CodeSystem with memory-efficient streaming approach
   * Works for all terminology types: SNOMED CT, LOINC, RxNorm
   */
  private async uploadLargeCodeSystem(codeSystem: any, fhirUrl: string): Promise<void> {
    const concepts = codeSystem.concept || [];
    const terminologyType = this.identifyTerminologyType(codeSystem);
    
    console.info(`[STREAM] ${terminologyType}: ${concepts.length} concepts - using streaming upload`);
    
    // Validate resource structure
    if (!codeSystem.id || !codeSystem.resourceType) {
      throw new Error('Invalid resource: missing id or resourceType');
    }
    
    // Estimate resource size without full serialization
    const avgConceptSize = 500; // Estimated bytes per concept
    const estimatedSize = concepts.length * avgConceptSize + 10000; // Base size + concepts
    console.info(`[STREAM] Estimated resource size: ${(estimatedSize / 1024 / 1024).toFixed(2)} MB`);
    
    if (estimatedSize > 50 * 1024 * 1024) { // 50MB limit for streaming
      console.warn(`[STREAM] Resource is very large (${(estimatedSize / 1024 / 1024).toFixed(2)} MB), using streaming approach`);
    }
    
    try {
      // Use memory optimization approach
      await this.uploadLargeCodeSystemWithMemoryOptimization(codeSystem, fhirUrl);
      console.info(`[MEMORY] ✓ ${terminologyType} uploaded successfully with memory optimization`);
    } catch (error: any) {
      console.error(`[STREAM] ✗ ${terminologyType} upload failed:`, error?.response?.status, error?.response?.statusText);
      if (error?.response?.data) {
        console.error(JSON.stringify(error.response.data, null, 2));
      }
      if (error?.code === 'ECONNABORTED') {
        console.error('[ERROR] Request timed out - resource may be too large');
      }
      if (error?.message?.includes('out of memory')) {
        console.error('[ERROR] Memory limit exceeded - consider using a smaller batch size');
      }
      throw error;
    }
  }

  /**
   * Upload large CodeSystem using temporary file staging approach
   * Streams concepts to temporary files, then uploads without memory limitations
   */
  private async uploadLargeCodeSystemWithMemoryOptimization(codeSystem: any, fhirUrl: string): Promise<void> {
    const concepts = codeSystem.concept || [];
    const terminologyType = this.identifyTerminologyType(codeSystem);
    
    console.info(`[STAGING] ${terminologyType}: Processing ${concepts.length} concepts with file staging approach`);
    
    // Use the required temp directory
    const stagingDir = `${this.tempDir}/fhir-staging-${Date.now()}`;
    
    try {
      // Create staging directory
      const fs = require('fs');
      const path = require('path');
      
      if (!fs.existsSync(stagingDir)) {
        fs.mkdirSync(stagingDir, { recursive: true });
      }
      
      console.info(`[STAGING] Using staging directory: ${stagingDir}`);
      
      // Stage the complete CodeSystem to temporary file
      const codeSystemFile = path.join(stagingDir, `${codeSystem.id}.json`);
      await this.stageCodeSystemToFile(codeSystem, codeSystemFile);
      
      // Upload the staged CodeSystem file
      await this.uploadStagedCodeSystemFile(codeSystemFile, fhirUrl, codeSystem.id);
      
      console.info(`[STAGING] ✓ ${terminologyType} uploaded successfully with ${concepts.length} concepts`);
      
    } finally {
      // Clean up staging directory unless keepTemp is enabled
      if (!this.keepTemp) {
        await this.cleanupStagingDirectory(stagingDir);
      } else {
        console.info(`[STAGING] Keeping temporary files in: ${stagingDir}`);
      }
    }
  }

  /**
   * Stage CodeSystem to temporary file using streaming approach
   */
  private async stageCodeSystemToFile(codeSystem: any, outputFile: string): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    
    console.info(`[STAGING] Writing CodeSystem to file: ${outputFile}`);
    
    // Create write stream for the output file
    const writeStream = fs.createWriteStream(outputFile);
    
    return new Promise((resolve, reject) => {
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
      
      // Write the CodeSystem header without concepts array
      const header = {
        resourceType: 'CodeSystem',
        id: codeSystem.id,
        url: codeSystem.url,
        version: codeSystem.version,
        name: codeSystem.name,
        status: codeSystem.status,
        concept: []
      };
      
      // Write header and start concept array
      writeStream.write(JSON.stringify(header, null, 2).replace('"concept": []', '"concept": ['));
      
      // Stream concepts in batches to avoid memory issues
      const concepts = codeSystem.concept || [];
      const batchSize = 1000;
      
      for (let i = 0; i < concepts.length; i += batchSize) {
        const batch = concepts.slice(i, i + batchSize);
        
        // Write batch of concepts with proper JSON formatting
        batch.forEach((concept: any, index: number) => {
          const isLast = (i + index === concepts.length - 1);
          const comma = isLast ? '' : ',';
          const conceptJson = JSON.stringify(concept);
          writeStream.write(`\n    ${conceptJson}${comma}`);
        });
        
        // Log progress
        if (i % 10000 === 0) {
          console.info(`[STAGING] Processed ${Math.min(i + batchSize, concepts.length)}/${concepts.length} concepts`);
        }
        
        // Force garbage collection for very large datasets
        if (i % 50000 === 0 && global.gc) {
          global.gc();
        }
      }
      
      // Close the concept array and CodeSystem
      writeStream.write('\n  ]\n}');
      writeStream.end();
    });
  }
  
  /**
   * Upload staged CodeSystem file to FHIR server
   */
  private async uploadStagedCodeSystemFile(filePath: string, fhirUrl: string, codeSystemId: string): Promise<void> {
    const fs = require('fs');
    
    console.info(`[STAGING] Uploading staged CodeSystem file: ${filePath}`);
    
    try {
      // Read the staged file and upload
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const codeSystem = JSON.parse(fileContent);
      
      await this.uploadSingleResource(codeSystem, fhirUrl, 'CodeSystem');
      console.info(`[STAGING] Successfully uploaded CodeSystem ${codeSystemId}`);
      
    } catch (error: any) {
      console.error(`[STAGING] Failed to upload staged CodeSystem:`, error?.response?.status);
      throw error;
    }
  }
  
  /**
   * Clean up staging directory
   */
  private async cleanupStagingDirectory(stagingDir: string): Promise<void> {
    const fs = require('fs');
    const path = require('path');
    
    try {
      if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        console.info(`[STAGING] Cleaned up staging directory: ${stagingDir}`);
      }
    } catch (error: any) {
      console.warn(`[STAGING] Warning: Could not clean up staging directory ${stagingDir}:`, error.message);
    }
  }

  /**
   * Stream stringify to prevent memory issues with large objects
   */
  private streamStringify(obj: any): string {
    const seen = new WeakSet();
    const chunks: string[] = [];
    
    const replacer = (key: string, value: any) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular Reference]';
        }
        seen.add(value);
      }
      return value;
    };
    
    // Use JSON.stringify with replacer to handle circular refs
    return JSON.stringify(obj, replacer);
  }

  /**
   * Upload a single FHIR resource without batch processing
   */
  private async uploadSingleResource(resource: any, fhirUrl: string, resourceType: string): Promise<void> {
    try {
      // Validate resource structure
      if (!resource.id || !resource.resourceType) {
        throw new Error('Invalid resource: missing id or resourceType');
      }
      
      // Check for circular references using safe stringify
      try {
        this.safeStringify(resource);
      } catch (circularError) {
        throw new Error('Resource contains circular references');
      }
      
      const response = await axios.put(
        `${fhirUrl}/${resourceType}/${resource.id}`,
        resource,
        {
          headers: {
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json',
          },
          timeout: 300000, // 5 minute timeout for large resources
        }
      );
      console.info(`[SUCCESS] Uploaded ${resourceType} ${resource.id}: ${response.status} ${response.statusText}`);
    } catch (error: any) {
      console.error(`[FAILURE] Uploading ${resourceType} ${resource.id}:`, error?.response?.status, error?.response?.statusText);
      if (error?.response?.data) {
        console.error(JSON.stringify(error.response.data, null, 2));
      }
      if (error?.code === 'ECONNABORTED') {
        console.error('[ERROR] Request timed out - resource may be too large');
      }
      if (error?.message?.includes('JSON.stringify')) {
        console.error('[ERROR] Resource contains circular references or invalid data');
      }
      throw error;
    }
  }

  /**
   * Safe JSON stringify that handles circular references
   */
  private safeStringify(obj: any): string {
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular Reference]';
        }
        seen.add(value);
      }
      return value;
    });
  }

  /**
   * Query server for resource counts and print summary
   */
  private async printResourceSummary(fhirUrl: string, terminologyType: string): Promise<void> {
    try {
      console.info(`\n[SUMMARY] Querying ${terminologyType} resource counts...`);
      
      // Query CodeSystem count
      const codeSystemResponse = await axios.get(`${fhirUrl}/CodeSystem?_summary=count`);
      const codeSystemCount = codeSystemResponse.data.total || 0;
      
      // Query ValueSet count
      const valueSetResponse = await axios.get(`${fhirUrl}/ValueSet?_summary=count`);
      const valueSetCount = valueSetResponse.data.total || 0;
      
      // Query specific terminology resources
      const terminologyCodeSystems = await this.queryTerminologyResources(fhirUrl, terminologyType);
      
      console.info(`\n${terminologyType} Import Summary:`);
      console.info(`   CodeSystems: ${terminologyCodeSystems.length}`);
      console.info(`   ValueSets: ${terminologyCodeSystems.length}`);
      
      // Show concept counts for each CodeSystem
      for (const cs of terminologyCodeSystems) {
        const conceptCount = cs.concept?.length || 0;
        console.info(`   ${cs.id}: ${conceptCount} concepts`);
      }
      
      console.info(`\nTotal Server Resources:`);
      console.info(`   CodeSystems: ${codeSystemCount}`);
      console.info(`   ValueSets: ${valueSetCount}`);
      
    } catch (error: any) {
      console.warn(`[SUMMARY] Could not query resource counts: ${error?.response?.status || error.message}`);
    }
  }

  /**
   * Query specific terminology resources from server
   */
  private async queryTerminologyResources(fhirUrl: string, terminologyType: string): Promise<any[]> {
    try {
      let searchParams = '';
      
      switch (terminologyType) {
        case 'SNOMED CT':
          searchParams = 'url=http://snomed.info/sct';
          break;
        case 'LOINC':
          searchParams = 'url=http://loinc.org';
          break;
        case 'RxNorm':
          searchParams = 'url=http://www.nlm.nih.gov/research/umls/rxnorm';
          break;
        default:
          return [];
      }
      
      const response = await axios.get(`${fhirUrl}/CodeSystem?${searchParams}`);
      return response.data.entry?.map((entry: any) => entry.resource) || [];
      
    } catch (error: any) {
      console.warn(`[SUMMARY] Could not query ${terminologyType} resources: ${error?.response?.status || error.message}`);
      return [];
    }
  }

  /**
   * Identify terminology type from CodeSystem for better logging
   */
  private identifyTerminologyType(codeSystem: any): string {
    if (codeSystem.id?.startsWith('sct-') || codeSystem.url === 'http://snomed.info/sct') {
      return 'SNOMED CT';
    } else if (codeSystem.id?.startsWith('loinc-') || codeSystem.url === 'http://loinc.org') {
      return 'LOINC';
    } else if (codeSystem.id?.startsWith('rxnorm-') || codeSystem.url?.includes('rxnorm')) {
      return 'RxNorm';
    } else {
      return 'Unknown';
    }
  }

  /**
   * Validate terminology file exists and is readable
   */
  validateFile(filePath: string, allowDirectory: boolean = false): boolean {
    try {
      if (!fs.existsSync(filePath)) {
        console.error(`File does not exist: ${filePath}`);
        return false;
      }

      const stats = fs.statSync(filePath);
      if (!stats.isFile() && !allowDirectory) {
        console.error(`Path is not a file: ${filePath}`);
        return false;
      }

      if (stats.isDirectory() && !allowDirectory) {
        console.error(`Path is a directory but file expected: ${filePath}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Error validating file ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Get file size in MB
   */
  getFileSize(filePath: string): number {
    const stats = fs.statSync(filePath);
    return stats.size / (1024 * 1024);
  }
}
