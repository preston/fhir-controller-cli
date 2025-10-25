/**
 * Log message prefixes for the FHIR Controller CLI
 * These constants ensure consistent logging across all stages of the import process
 */

export const LogPrefixes = {
  // Main import stages
  STAGE_1_PREPROCESS: '[STAGE 1: PREPROCESS]',
  STAGE_2_SPLIT: '[STAGE 2: SPLIT]',
  STAGE_3_UPLOAD: '[STAGE 3: UPLOAD]',
  
  // Import process overview
  IMPORT: '[IMPORT]',
  
  // Discovery and file operations
  DISCOVERY: '[DISCOVERY]',
  
  // Skip operations
  SKIP: '[SKIP]',
  
  // ValueSet operations
  VALUESET: '[VALUESET]',
  
  // Replace operations
  REPLACE: '[REPLACE]',
  
  // Summary operations
  SUMMARY: '[SUMMARY]',
  
  // Staging operations
  STAGING: '[STAGING]',
  
  // Streaming operations (for large files)
  STREAMING: '[STREAMING]'
} as const;

export type LogPrefix = typeof LogPrefixes[keyof typeof LogPrefixes];
