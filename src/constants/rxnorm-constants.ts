// Author: Preston Lee
// RxNorm Constants and Identifiers

import type { TerminologyInfo } from '../types/terminology-constants.js';


/**
 * RxNorm Property Codes
 */
export const RXNORM_PROPERTY_CODES = {
  TTY: 'tty',
  SAB: 'sab',
  ISPREF: 'ispref'
} as const;


/**
 * RxNorm ValueSet Information
 */
export const RXNORM_TERMINOLOGY_INFO: TerminologyInfo = {
  identity: {
    name: 'RxNorm',
    displayName: 'RxNorm',
    description: 'Normalized Names for Clinical Drugs',
    terminologyType: 'RxNorm'
  },
  publisher: {
    name: 'National Library of Medicine',
    website: 'https://www.nlm.nih.gov/research/umls/rxnorm/',
    licenseUrl: 'https://www.nlm.nih.gov/research/umls/rxnorm/docs/termsofservice.html',
    copyright: 'This value set includes content from RxNorm, which is copyright © 2001+ National Library of Medicine.'
  },
  fhirUrls: {
    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
    fhirBase: 'http://www.nlm.nih.gov/research/umls/rxnorm/fhir',
    versionCurrent: 'http://www.nlm.nih.gov/research/umls/rxnorm/version/current'
  },
  valueSetMetadata: {
    titleSuffix: 'ValueSet - All Codes',
    descriptionPrefix: 'ValueSet containing all codes from the RxNorm CodeSystem'
  }
} as const;

/**
 * RxNorm RRF Data Fields
 * Based on RXNCONSO.RRF format: RXCUI|LAT|TS|STT|SUI|ISPREF|AUI|SAUI|SCUI|SDUI|SAB|TTY|CODE|STR|SBR|VER|RELEASE|SRL|SUPPRESS|CVF
 */
export const RXNORM_RRF_FIELDS = {
  RXCUI: 0,
  LAT: 1,
  TS: 2,
  STT: 3,
  SUI: 4,
  ISPREF: 5,
  AUI: 6,
  SAUI: 7,
  SCUI: 8,
  SDUI: 9,
  SAB: 10,
  TTY: 11,
  CODE: 12,
  STR: 13,
  SBR: 14,
  VER: 15,
  RELEASE: 16,
  SRL: 17,
  SUPPRESS: 18,
  CVF: 19
} as const;

