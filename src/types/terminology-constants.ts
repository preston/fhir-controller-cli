// Author: Preston Lee
// Common interface for terminology constants

/**
 * FHIR system URLs and endpoints
 */
export interface TerminologyFhirUrls {
  readonly system: string;
  readonly fhirBase: string;
  readonly versionCurrent: string;
  readonly designationUseContextExtension?: string;
}

/**
 * Basic terminology identification and display
 */
export interface TerminologyIdentity {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly terminologyType: string;
}

/**
 * Organization and publisher information
 */
export interface TerminologyPublisher {
  readonly name: string;
  readonly website: string;
  readonly licenseUrl: string;
  readonly copyright: string;
}

/**
 * ValueSet-specific metadata
 */
export interface TerminologyValueSetMetadata {
  readonly titleSuffix: string;
  readonly descriptionPrefix: string;
}

/**
 * Contact information for terminology support
 */
export interface TerminologyContact {
  readonly name: string;
  readonly url: string;
}

/**
 * Comprehensive terminology information interface
 */
export interface TerminologyInfo {
  readonly identity: TerminologyIdentity;
  readonly publisher: TerminologyPublisher;
  readonly fhirUrls: TerminologyFhirUrls;
  readonly valueSetMetadata: TerminologyValueSetMetadata;
  readonly contact?: TerminologyContact;
}

/**
 * Extended interface for SNOMED CT with contact information
 */
export interface SnomedTerminologyInfo extends TerminologyInfo {
  readonly contact: TerminologyContact;
}

/**
 * Type guard to check if terminology info has contact information
 */
export function hasContactInfo(info: TerminologyInfo): info is SnomedTerminologyInfo {
  return 'contact' in info && info.contact !== undefined;
}
