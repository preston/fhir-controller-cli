// Author: Preston Lee
// LOINC Constants and Identifiers

/**
 * LOINC FHIR URLs and Systems
 */
export const LOINC_FHIR_URLS = {
  SYSTEM: 'http://loinc.org',
  FHIR_BASE: 'http://loinc.org/fhir',
  VERSION_CURRENT: 'http://loinc.org/version/current'
} as const;

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
 * LOINC Organization Information
 */
export const LOINC_ORGANIZATION = {
  NAME: 'Regenstrief Institute',
  WEBSITE: 'https://loinc.org',
  LICENSE_URL: 'https://loinc.org/license/',
  COPYRIGHT: 'This value set includes content from LOINC, which is copyright © 1995+ Regenstrief Institute, Inc. and the LOINC Committee, and is available at no cost under the license at https://loinc.org/license/'
} as const;

/**
 * LOINC Resource Information
 */
export const LOINC_RESOURCE_INFO = {
  TITLE: 'Logical Observation Identifiers Names and Codes',
  DESCRIPTION: 'Logical Observation Identifiers Names and Codes (LOINC) is a universal code system for identifying health measurements, observations, and documents.',
  PUBLISHER: 'Regenstrief Institute'
} as const;

/**
 * TypeScript Enums for Type Safety
 */
export enum LoincPropertyCode {
  TTY = 'tty',
  SAB = 'sab',
  COMPONENT = 'component',
  PROPERTY = 'property',
  TIME = 'time',
  SYSTEM = 'system',
  SCALE = 'scale',
  METHOD = 'method',
  CLASS = 'class',
  CLASSTYPE = 'classtype'
}

export enum LoincResourceType {
  CODESYSTEM = 'CodeSystem',
  VALUESET = 'ValueSet'
}
