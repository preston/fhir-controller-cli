// Author: Preston Lee

import fs from 'fs';
import path from 'path';
import { TerminologyFileInfo } from '../../types/terminology-config.js';

export interface FileHandlerConfig {
  verbose: boolean;
}

export class FileHandler {
  protected config: FileHandlerConfig;

  constructor(config: FileHandlerConfig) {
    this.config = config;
  }

  /**
   * Analyze file to determine type and format
   */
  analyzeFile(filePath: string, terminologyType: 'snomed' | 'loinc' | 'rxnorm'): TerminologyFileInfo {
    const ext = path.extname(filePath).toLowerCase();
    let format: 'rf2' | 'csv' | 'txt';

    if (ext === '.txt' || ext === '.zip') {
      format = 'rf2';
    } else if (ext === '.csv') {
      format = 'csv';
    } else {
      format = 'txt';
    }

    const fileSize = this.getFileSize(filePath);
    
    // Estimate concepts based on file size and terminology type
    let estimatedConcepts = 0;
    if (terminologyType === 'snomed') {
      estimatedConcepts = Math.floor(fileSize * 1000); // Rough estimate for SNOMED CT
    } else if (terminologyType === 'loinc') {
      estimatedConcepts = Math.floor(fileSize * 500); // Rough estimate for LOINC
    } else if (terminologyType === 'rxnorm') {
      estimatedConcepts = Math.floor(fileSize * 300); // Rough estimate for RxNorm
    }

    return {
      filePath,
      fileType: terminologyType,
      format,
      fileSize,
      estimatedConcepts
    };
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
   * Validate SNOMED CT directory and find concept file
   */
  validateSnomedDirectory(dirPath: string): { valid: boolean; conceptFile?: string } {
    try {
      if (!fs.existsSync(dirPath)) {
        console.error(`Directory does not exist: ${dirPath}`);
        return { valid: false };
      }

      const stats = fs.statSync(dirPath);
      if (!stats.isDirectory()) {
        console.error(`Path is not a directory: ${dirPath}`);
        return { valid: false };
      }

      // Look for concept file in common SNOMED CT directory structures
      const possiblePaths = [
        // Direct in directory
        path.join(dirPath, 'sct2_Concept_Full_*.txt'),
        // In Full/Terminology subdirectory
        path.join(dirPath, 'Full', 'Terminology', 'sct2_Concept_Full_*.txt'),
        // In Snapshot/Terminology subdirectory
        path.join(dirPath, 'Snapshot', 'Terminology', 'sct2_Concept_Full_*.txt'),
        // In Terminology subdirectory
        path.join(dirPath, 'Terminology', 'sct2_Concept_Full_*.txt')
      ];

      // Try to find concept file
      for (const pattern of possiblePaths) {
        const dir = path.dirname(pattern);
        const basePattern = path.basename(pattern);
        
        if (fs.existsSync(dir)) {
          const files = fs.readdirSync(dir);
          const conceptFile = files.find(file => 
            file.startsWith('sct2_Concept_Full_') && file.endsWith('.txt')
          );
          
          if (conceptFile) {
            const fullPath = path.join(dir, conceptFile);
            console.info(`Found SNOMED CT concept file: ${fullPath}`);
            return { valid: true, conceptFile: fullPath };
          }
        }
      }

      console.error(`No SNOMED CT concept file found in directory: ${dirPath}`);
      return { valid: false };
    } catch (error) {
      console.error(`Error validating SNOMED CT directory ${dirPath}:`, error);
      return { valid: false };
    }
  }

  /**
   * Get file size in MB
   */
  getFileSize(filePath: string): number {
    const stats = fs.statSync(filePath);
    return stats.size / (1024 * 1024);
  }

  /**
   * Create directory if it doesn't exist
   */
  ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Clean up directory and all contents
   */
  async cleanupDirectory(dirPath: string): Promise<void> {
    try {
      if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        if (this.config.verbose) {
          console.info(`[CLEANUP] Cleaned up directory: ${dirPath}`);
        }
      }
    } catch (error: any) {
      console.warn(`[CLEANUP] Warning: Could not clean up directory ${dirPath}:`, error.message);
    }
  }

  /**
   * Check if file exists
   */
  fileExists(filePath: string): boolean {
    return fs.existsSync(filePath);
  }

  /**
   * Read file content as string
   */
  readFile(filePath: string, encoding: BufferEncoding = 'utf8'): string {
    return fs.readFileSync(filePath, encoding);
  }

  /**
   * Write content to file
   */
  writeFile(filePath: string, content: string, encoding: BufferEncoding = 'utf8'): void {
    fs.writeFileSync(filePath, content, encoding);
  }

  /**
   * Write JSON object to file
   */
  async writeJsonFile(filePath: string, data: any): Promise<void> {
    // Ensure the directory exists before writing the file
    const dirPath = path.dirname(filePath);
    this.ensureDirectoryExists(dirPath);
    
    const jsonContent = JSON.stringify(data, null, 2);
    this.writeFile(filePath, jsonContent);
  }

  /**
   * Read JSON file
   */
  async readJsonFile(filePath: string): Promise<any> {
    const content = this.readFile(filePath);
    return JSON.parse(content);
  }

  /**
   * List files in directory with optional extension filter
   */
  listFiles(dirPath: string, extension?: string): string[] {
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    const files = fs.readdirSync(dirPath);
    
    if (extension) {
      return files.filter(file => file.endsWith(extension));
    }
    
    return files;
  }

  /**
   * Check if a path exists and is a directory
   */
  isDirectory(dirPath: string): boolean {
    if (!fs.existsSync(dirPath)) {
      return false;
    }
    
    const stats = fs.statSync(dirPath);
    return stats.isDirectory();
  }
}
