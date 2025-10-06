// Author: Preston Lee

export interface SnomedConcept {
  id: string;
  effectiveTime: string;
  active: string;
  moduleId: string;
  definitionStatusId: string;
}

export interface SnomedDescription {
  id: string;
  effectiveTime: string;
  active: string;
  moduleId: string;
  conceptId: string;
  languageCode: string;
  typeId: string;
  term: string;
  caseSignificanceId: string;
}

export interface SnomedRelationship {
  id: string;
  effectiveTime: string;
  active: string;
  moduleId: string;
  sourceId: string;
  destinationId: string;
  relationshipGroup: string;
  typeId: string;
  characteristicTypeId: string;
  modifierId: string;
}

export interface SnomedTextDefinition {
  id: string;
  effectiveTime: string;
  active: string;
  moduleId: string;
  conceptId: string;
  languageCode: string;
  typeId: string;
  term: string;
  caseSignificanceId: string;
}

export interface SnomedConceptData {
  concept: SnomedConcept;
  descriptions: SnomedDescription[];
  relationships: SnomedRelationship[];
  textDefinitions: SnomedTextDefinition[];
}

export interface SnomedHierarchyNode {
  code: string;
  display: string;
  definition?: string;
  parent?: string;
  relationshipType?: string;
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
  concept?: SnomedHierarchyNode[];
}
