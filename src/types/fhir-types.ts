// Author: Preston Lee

// Re-export FHIR types for convenience
export { CodeSystem, ValueSet, ConceptMap, Coding, CodeableConcept } from 'fhir/r4';

// Additional FHIR-related interfaces
export interface FhirResource {
  resourceType: string;
  id?: string;
  url?: string;
  version?: string;
  name?: string;
  title?: string;
  status?: string;
  date?: string;
  publisher?: string;
  description?: string;
}

export interface FhirConcept {
  code: string;
  display: string;
  definition?: string;
  designation?: Array<{
    language?: string;
    use?: {
      system?: string;
      code?: string;
      display?: string;
    };
    value: string;
  }>;
  property?: Array<{
    code: string;
    valueCode?: string;
    valueString?: string;
    valueBoolean?: boolean;
    valueInteger?: number;
    valueDecimal?: number;
    valueUri?: string;
  }>;
  concept?: FhirConcept[];
}

export interface FhirValueSetCompose {
  include?: Array<{
    system?: string;
    version?: string;
    concept?: Array<{
      code: string;
      display: string;
    }>;
    filter?: Array<{
      property: string;
      op: string;
      value: string;
    }>;
  }>;
  exclude?: Array<{
    system?: string;
    version?: string;
    concept?: Array<{
      code: string;
      display: string;
    }>;
  }>;
}
