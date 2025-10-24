// Author: Preston Lee
// RxNorm Constants and Identifiers

/**
 * RxNorm FHIR URLs and Systems
 */
export const RXNORM_FHIR_URLS = {
  SYSTEM: 'http://www.nlm.nih.gov/research/umls/rxnorm',
  FHIR_BASE: 'http://www.nlm.nih.gov/research/umls/rxnorm/fhir',
  VERSION_CURRENT: 'http://www.nlm.nih.gov/research/umls/rxnorm/version/current'
} as const;

/**
 * RxNorm Property Codes
 */
export const RXNORM_PROPERTY_CODES = {
  TTY: 'tty',
  SAB: 'sab',
  ISPREF: 'ispref'
} as const;

/**
 * RxNorm Organization Information
 */
export const RXNORM_ORGANIZATION = {
  NAME: 'National Library of Medicine',
  WEBSITE: 'https://www.nlm.nih.gov/research/umls/rxnorm/',
  LICENSE_URL: 'https://www.nlm.nih.gov/research/umls/rxnorm/docs/termsofservice.html',
  COPYRIGHT: 'This value set includes content from RxNorm, which is copyright © 2001+ National Library of Medicine (NLM), and is available at no cost under the license at https://www.nlm.nih.gov/research/umls/rxnorm/docs/termsofservice.html'
} as const;

/**
 * RxNorm Resource Information
 */
export const RXNORM_RESOURCE_INFO = {
  TITLE: 'RxNorm',
  DESCRIPTION: 'RxNorm - Normalized Names for Clinical Drugs',
  PUBLISHER: 'National Library of Medicine'
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

/**
 * TypeScript Enums for Type Safety
 */
export enum RxNormPropertyCode {
  TTY = 'tty',
  SAB = 'sab',
  ISPREF = 'ispref'
}

export enum RxNormResourceType {
  CODESYSTEM = 'CodeSystem',
  VALUESET = 'ValueSet'
}

export enum RxNormRrfField {
  RXCUI = 0,
  LAT = 1,
  TS = 2,
  STT = 3,
  SUI = 4,
  ISPREF = 5,
  AUI = 6,
  SAUI = 7,
  SCUI = 8,
  SDUI = 9,
  SAB = 10,
  TTY = 11,
  CODE = 12,
  STR = 13,
  SBR = 14,
  VER = 15,
  RELEASE = 16,
  SRL = 17,
  SUPPRESS = 18,
  CVF = 19
}
