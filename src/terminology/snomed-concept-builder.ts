import { SnomedMetadataExtractor } from './snomed-metadata-extractor.js';

export interface SnomedConceptBuilderConfig {
  verbose: boolean;
}

export class SnomedConceptBuilder {
  private config: SnomedConceptBuilderConfig;

  constructor(config: SnomedConceptBuilderConfig) {
    this.config = config;
  }

  /**
   * Build SNOMED concept hierarchy with descriptions and relationships
   */
  buildSnomedConceptHierarchy(
    concepts: any[], 
    descriptions: any[], 
    relationships: any[], 
    textDefinitions: any[]
  ): any[] {
    const descriptionMap = new Map();
    const textDefMap = new Map();
    const relationshipMap = new Map();
    
    descriptions.forEach(desc => {
      if (!descriptionMap.has(desc.conceptId) || desc.typeId === '900000000000013009') {
        descriptionMap.set(desc.conceptId, desc.term);
      }
    });
    
    textDefinitions.forEach(def => {
      if (!textDefMap.has(def.conceptId)) {
        textDefMap.set(def.conceptId, def.term);
      }
    });
    
    relationships.forEach(rel => {
      if (!relationshipMap.has(rel.sourceId)) {
        relationshipMap.set(rel.sourceId, []);
      }
      relationshipMap.get(rel.sourceId).push(rel);
    });
    
    const uniqueConcepts = new Map();
    concepts.forEach(concept => {
      if (!uniqueConcepts.has(concept.id)) {
        uniqueConcepts.set(concept.id, concept);
      }
    });
    
    if (this.config.verbose) {
      console.info(`Deduplicated SNOMED CT concepts: ${concepts.length} → ${uniqueConcepts.size} unique concepts`);
    }
    
    const allConcepts = Array.from(uniqueConcepts.values());
    
    if (this.config.verbose) {
      console.info(`Building concept hierarchy for ${allConcepts.length} SNOMED CT concepts`);
    }
    
    return allConcepts.map(concept => {
      const conceptRelationships = relationshipMap.get(concept.id) || [];
      const isA = conceptRelationships.filter((rel: any) => rel.typeId === '116680003');
      const parentConcepts = isA.map((rel: any) => rel.destinationId);
      
      const conceptDisplay = descriptionMap.get(concept.id) || `SNOMED CT Concept ${concept.id}`;
      const conceptDefinition = textDefMap.get(concept.id) || `SNOMED CT concept ${concept.id}`;
      
      return {
        code: concept.id,
        display: conceptDisplay,
        definition: conceptDefinition,
        designation: [
          {
            extension: [
              {
                url: 'http://snomed.info/fhir/StructureDefinition/designation-use-context',
                extension: [
                  {
                    url: 'context',
                    valueCoding: {
                      system: 'http://snomed.info/sct',
                      code: '900000000000509007'
                    }
                  },
                  {
                    url: 'role',
                    valueCoding: {
                      system: 'http://snomed.info/sct',
                      code: '900000000000548007',
                      display: 'PREFERRED'
                    }
                  },
                  {
                    url: 'type',
                    valueCoding: {
                      system: 'http://snomed.info/sct',
                      code: '900000000000003001',
                      display: 'Fully specified name'
                    }
                  }
                ]
              }
            ],
            language: 'en',
            use: {
              system: 'http://snomed.info/sct',
              code: '900000000000003001',
              display: 'Fully specified name'
            },
            value: conceptDisplay
          },
          {
            extension: [
              {
                url: 'http://snomed.info/fhir/StructureDefinition/designation-use-context',
                extension: [
                  {
                    url: 'context',
                    valueCoding: {
                      system: 'http://snomed.info/sct',
                      code: '900000000000509007'
                    }
                  },
                  {
                    url: 'role',
                    valueCoding: {
                      system: 'http://snomed.info/sct',
                      code: '900000000000548007',
                      display: 'PREFERRED'
                    }
                  },
                  {
                    url: 'type',
                    valueCoding: {
                      system: 'http://snomed.info/sct',
                      code: '900000000000013009',
                      display: 'Synonym'
                    }
                  }
                ]
              }
            ],
            language: 'en', 
            use: {
              system: 'http://snomed.info/sct',
              code: '900000000000013009',
              display: 'Synonym'
            },
            value: conceptDisplay
          }
        ],
        property: [
          {
            code: 'effectiveTime',
            valueString: concept.effectiveTime
          },
          {
            code: 'moduleId',
            valueCode: concept.moduleId
          },
          {
            code: 'definitionStatusId',
            valueCode: concept.definitionStatusId
          },
          ...parentConcepts.slice(0, 10).map((parentId: any) => ({
            code: 'parent',
            valueCode: parentId
          })),
          ...conceptRelationships.slice(0, 10).map((rel: any) => ({
            code: 'relationship',
            valueCode: rel.destinationId,
            valueString: this.getRelationshipTypeDisplay(rel.typeId)
          }))
        ]
      };
    });
  }

  /**
   * Get relationship type display name
   */
  private getRelationshipTypeDisplay(typeId: string): string {
    // This could be expanded with a proper mapping
    const relationshipTypes: { [key: string]: string } = {
      '116680003': 'IS_A',
      '363698007': 'Finding site',
      '272741003': 'Laterality',
      '408729009': 'Finding context',
      '408731000': 'Temporal context',
      '408732007': 'Subject relationship context',
      '408730004': 'Subject relationship context'
    };
    
    return relationshipTypes[typeId] || `Relationship Type ${typeId}`;
  }
}
