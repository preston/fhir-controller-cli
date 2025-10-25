// Author: Preston Lee
// Terminology Registry for intelligent constant lookup

import type { TerminologyInfo, SnomedTerminologyInfo } from '../types/terminology-constants.js';
import { SNOMED_TERMINOLOGY_INFO } from './snomed-constants.js';
import { LOINC_TERMINOLOGY_INFO } from './loinc-constants.js';
import { RXNORM_TERMINOLOGY_INFO } from './rxnorm-constants.js';

/**
 * Registry entry for terminology constants
 */
export interface TerminologyRegistryEntry {
  readonly terminologyInfo: TerminologyInfo;
}

/**
 * Registry of all terminology constants
 */
export const TERMINOLOGY_REGISTRY: Record<string, TerminologyRegistryEntry> = {
  [SNOMED_TERMINOLOGY_INFO.identity.terminologyType]: {
    terminologyInfo: SNOMED_TERMINOLOGY_INFO
  },
  [LOINC_TERMINOLOGY_INFO.identity.terminologyType]: {
    terminologyInfo: LOINC_TERMINOLOGY_INFO
  },
  [RXNORM_TERMINOLOGY_INFO.identity.terminologyType]: {
    terminologyInfo: RXNORM_TERMINOLOGY_INFO
  }
} as const;

/**
 * Get terminology registry entry by terminology type
 */
export function getTerminologyEntry(terminologyType: string): TerminologyRegistryEntry | null {
  return TERMINOLOGY_REGISTRY[terminologyType] || null;
}

/**
 * Get terminology registry entry by CodeSystem ID or URL
 */
export function getTerminologyEntryByCodeSystem(codeSystem: any): TerminologyRegistryEntry | null {
  // Check by ID patterns
  if (codeSystem.id?.startsWith('sct-') || codeSystem.url === SNOMED_TERMINOLOGY_INFO.fhirUrls.system) {
    return TERMINOLOGY_REGISTRY[SNOMED_TERMINOLOGY_INFO.identity.terminologyType];
  }
  if (codeSystem.id?.startsWith('loinc-') || codeSystem.url === LOINC_TERMINOLOGY_INFO.fhirUrls.system) {
    return TERMINOLOGY_REGISTRY[LOINC_TERMINOLOGY_INFO.identity.terminologyType];
  }
  if (codeSystem.id?.startsWith('rxnorm-') || codeSystem.url === RXNORM_TERMINOLOGY_INFO.fhirUrls.system) {
    return TERMINOLOGY_REGISTRY[RXNORM_TERMINOLOGY_INFO.identity.terminologyType];
  }
  
  return null;
}

/**
 * Get all terminology types
 */
export function getAllTerminologyTypes(): string[] {
  return Object.keys(TERMINOLOGY_REGISTRY);
}
