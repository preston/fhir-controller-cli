import fs from 'fs';
import path from 'path';
import { SNOMED_TERMINOLOGY_INFO } from '../constants/snomed-constants.js';

export class SnomedMetadataExtractor {
  /**
   * Find terminology path in SNOMED directory
   */
  static findTerminologyPath(directoryPath: string): string | null {
    const possiblePaths = [
      path.join(directoryPath, 'Full', 'Terminology'),
      path.join(directoryPath, 'Snapshot', 'Terminology'),
      path.join(directoryPath, 'Terminology')
    ];
    
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath;
      }
    }
    
    return null;
  }

  /**
   * Extract SNOMED version from directory path
   */
  static extractSnomedVersion(filePath: string): string {
    try {
      const pathParts = filePath.split('/');
      const dirName = pathParts[pathParts.length - 1];
      
      const dateMatch = dirName.match(/(\d{8})/);
      if (dateMatch) {
        const date = dateMatch[1];
        const namespace = this.extractSnomedNamespace(filePath);
        return `http://snomed.info/sct/${namespace}/version/${date}`;
      }
      
      const version = this.extractVersionFromRf2Files(filePath);
      if (version) {
        return version;
      }
      
      throw new Error(`Could not extract SNOMED CT version from directory path or RF2 files: ${filePath}`);
    } catch (error) {
      console.error('Failed to extract SNOMED CT version from data:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`SNOMED CT version extraction failed: ${errorMessage}`);
    }
  }

  /**
   * Extract SNOMED namespace from directory path
   */
  static extractSnomedNamespace(filePath: string): string {
    try {
      const pathParts = filePath.split('/');
      const dirName = pathParts[pathParts.length - 1];
      
      const namespaceMatch = dirName.match(/(US|INT|AU|CA|NL|SE|DK|BE|ES|CH|IE|NZ|PL|PT|BR|MX|AR|CL|CO|PE|UY|VE|EC|BO|PY|GY|SR|TT|JM|BB|BS|BZ|CR|CU|DO|GT|HN|NI|PA|SV|HT|DM|AG|KN|LC|VC|GD)(\d{7})/);
      if (namespaceMatch) {
        const countryCode = namespaceMatch[1];
        const number = namespaceMatch[2];
        return `${countryCode}${number}`;
      }
      
      const namespace = this.extractNamespaceFromRf2Files(filePath);
      if (namespace) {
        return namespace;
      }
      
      throw new Error(`Could not extract SNOMED CT namespace from directory path or RF2 files: ${filePath}`);
    } catch (error) {
      console.error('Failed to extract SNOMED CT namespace from data:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`SNOMED CT namespace extraction failed: ${errorMessage}`);
    }
  }

  /**
   * Extract namespace from RF2 files
   */
  private static extractNamespaceFromRf2Files(directoryPath: string): string | null {
    try {
      const terminologyPath = this.findTerminologyPath(directoryPath);
      if (!terminologyPath) {
        return null;
      }

      const files = fs.readdirSync(terminologyPath);
      const conceptFileName = files.find(file => 
        file.startsWith('sct2_Concept_Full_') && file.endsWith('.txt')
      );
      
      if (conceptFileName) {
        const conceptFilePath = path.join(terminologyPath, conceptFileName);
        
        const buffer = fs.readFileSync(conceptFilePath, { encoding: 'utf8', flag: 'r' });
        const headerContent = buffer.substring(0, 2000);
        
        const lines = headerContent.split('\n');
        for (const line of lines) {
          const namespaceMatch = line.match(/(US|INT|AU|CA|NL|SE|DK|BE|ES|CH|IE|NZ|PL|PT|BR|MX|AR|CL|CO|PE|UY|VE|EC|BO|PY|GY|SR|TT|JM|BB|BS|BZ|CR|CU|DO|GT|HN|NI|PA|SV|HT|DM|AG|KN|LC|VC|GD)(\d{7})/);
          if (namespaceMatch) {
            const countryCode = namespaceMatch[1];
            const number = namespaceMatch[2];
            return `${countryCode}${number}`;
          }
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Failed to read RF2 file headers for namespace extraction:', error);
      return null;
    }
  }

  /**
   * Extract version from RF2 files
   */
  private static extractVersionFromRf2Files(directoryPath: string): string | null {
    try {
      const terminologyPath = this.findTerminologyPath(directoryPath);
      if (!terminologyPath) {
        return null;
      }

      const files = fs.readdirSync(terminologyPath);
      const conceptFileName = files.find(file => 
        file.startsWith('sct2_Concept_Full_') && file.endsWith('.txt')
      );
      
      if (conceptFileName) {
        const conceptFilePath = path.join(terminologyPath, conceptFileName);
        
        const buffer = fs.readFileSync(conceptFilePath, { encoding: 'utf8', flag: 'r' });
        const headerContent = buffer.substring(0, 1000);
        
        const lines = headerContent.split('\n');
        for (const line of lines) {
          const versionMatch = line.match(/(\d{8})/);
          if (versionMatch) {
            const date = versionMatch[1];
            const namespace = this.extractSnomedNamespace(directoryPath);
            return `${SNOMED_TERMINOLOGY_INFO.fhirUrls.system}/${namespace}/version/${date}`;
          }
        }
      }
      
      return null;
    } catch (error) {
      console.warn('Failed to read RF2 file headers for version extraction:', error);
      return null;
    }
  }

  /**
   * Get SNOMED edition from namespace
   */
  static getSnomedEditionFromNamespace(namespace: string): string {
    // Handle special case for International Edition (INT)
    if (namespace.startsWith('INT')) {
      return 'International Edition';
    }
    
    const countryCode = namespace.substring(0, 2);
    
    const editionMap: { [key: string]: string } = {
      'US': 'United States Edition',
      'INT': 'International Edition',
      'AU': 'Australian Edition',
      'CA': 'Canadian Edition',
      'NL': 'Netherlands Edition',
      'SE': 'Swedish Edition',
      'DK': 'Danish Edition',
      'BE': 'Belgian Edition',
      'ES': 'Spanish Edition',
      'CH': 'Swiss Edition',
      'IE': 'Irish Edition',
      'NZ': 'New Zealand Edition',
      'PL': 'Polish Edition',
      'PT': 'Portuguese Edition',
      'BR': 'Brazilian Edition',
      'MX': 'Mexican Edition',
      'AR': 'Argentine Edition',
      'CL': 'Chilean Edition',
      'CO': 'Colombian Edition',
      'PE': 'Peruvian Edition',
      'UY': 'Uruguayan Edition',
      'VE': 'Venezuelan Edition',
      'EC': 'Ecuadorian Edition',
      'BO': 'Bolivian Edition',
      'PY': 'Paraguayan Edition',
      'GY': 'Guyanese Edition',
      'SR': 'Surinamese Edition',
      'TT': 'Trinidad and Tobago Edition',
      'JM': 'Jamaican Edition',
      'BB': 'Barbadian Edition',
      'BS': 'Bahamian Edition',
      'BZ': 'Belizean Edition',
      'CR': 'Costa Rican Edition',
      'CU': 'Cuban Edition',
      'DO': 'Dominican Edition',
      'GT': 'Guatemalan Edition',
      'HN': 'Honduran Edition',
      'NI': 'Nicaraguan Edition',
      'PA': 'Panamanian Edition',
      'SV': 'Salvadoran Edition',
      'HT': 'Haitian Edition',
      'DM': 'Dominican Edition',
      'AG': 'Antiguan Edition',
      'KN': 'Saint Kitts and Nevis Edition',
      'LC': 'Saint Lucian Edition',
      'VC': 'Saint Vincent and the Grenadines Edition',
      'GD': 'Grenadian Edition'
    };
    
    return editionMap[countryCode] || `${countryCode} Edition`;
  }
}
