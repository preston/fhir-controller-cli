// Author: Preston Lee

export interface TerminologyProcessorConfig {
  dryRun: boolean;
  verbose: boolean;
  batchSize: number;
  maxConcepts?: number; // Maximum concepts to process to prevent memory issues
}

export interface TerminologyConfig {
  name: string;
  version: string;
  url: string;
  system: string;
  description: string;
  publisher: string;
  status: 'draft' | 'active' | 'retired' | 'unknown';
}

export interface TerminologyFileInfo {
  filePath: string;
  fileType: 'snomed' | 'loinc' | 'rxnorm';
  format: 'rf2' | 'csv' | 'txt';
  fileSize?: number;
  estimatedConcepts?: number;
}
