import type { CodeSystem } from 'fhir/r4';

export interface TerminologyFileReaderConfig {
  verbose: boolean;
  batchSize?: number;
}

export interface TerminologyFileInfo {
  filePath: string;
  fileType: 'snomed' | 'loinc' | 'rxnorm';
  format: 'rf2' | 'csv' | 'txt' | 'rrf';
  fileSize: number;
  estimatedConcepts: number;
}

export interface TerminologyReaderResult {
  codeSystem: CodeSystem;
  processedCount: number;
}

/**
 * Interface for reading different terminology file formats
 */
export interface ITerminologyFileReader {
  /**
   * Read and process terminology file
   */
  readFile(fileInfo: TerminologyFileInfo): Promise<TerminologyReaderResult>;

  /**
   * Check if this reader can handle the given file format
   */
  canHandle(fileInfo: TerminologyFileInfo): boolean;

  /**
   * Get the terminology type this reader handles
   */
  getTerminologyType(): 'snomed' | 'loinc' | 'rxnorm';
}
