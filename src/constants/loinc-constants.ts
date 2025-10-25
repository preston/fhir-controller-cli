// Author: Preston Lee
// LOINC Constants and Identifiers

import type { TerminologyInfo } from '../types/terminology-constants.js';


/**
 * LOINC Property Codes
 */
export const LOINC_PROPERTY_CODES = {
  TTY: 'tty',
  SAB: 'sab',
  COMPONENT: 'component',
  PROPERTY: 'property',
  TIME: 'time',
  SYSTEM: 'system',
  SCALE: 'scale',
  METHOD: 'method',
  CLASS: 'class',
  CLASSTYPE: 'classtype'
} as const;


/**
 * LOINC ValueSet Information
 */
export const LOINC_TERMINOLOGY_INFO: TerminologyInfo = {
  identity: {
    name: 'LOINC',
    displayName: 'LOINC',
    description: 'Logical Observation Identifiers Names and Codes',
    terminologyType: 'LOINC'
  },
  publisher: {
    name: 'Regenstrief Institute',
    website: 'https://loinc.org',
    licenseUrl: 'https://loinc.org/license/',
    copyright: 'This value set includes content from LOINC, which is copyright © 1995+ Regenstrief Institute, Inc. and the Logical Observation Identifiers Names and Codes (LOINC) Committee.'
  },
  fhirUrls: {
    system: 'http://loinc.org',
    fhirBase: 'http://loinc.org/fhir',
    versionCurrent: 'http://loinc.org/version/current'
  },
  valueSetMetadata: {
    titleSuffix: 'ValueSet - All Codes',
    descriptionPrefix: 'ValueSet containing all codes from the LOINC CodeSystem'
  }
} as const;

