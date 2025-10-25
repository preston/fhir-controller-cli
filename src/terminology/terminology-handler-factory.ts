import { BaseTerminologyHandler, TerminologyHandlerConfig } from './base-terminology-handler.js';
import { SnomedHandler } from './snomed-handler.js';
import { LoincHandler } from './loinc-handler.js';
import { RxNormHandler } from './rxnorm-handler.js';

export class TerminologyHandlerFactory {
  static createHandler(terminologyType: 'snomed' | 'loinc' | 'rxnorm', config: TerminologyHandlerConfig): BaseTerminologyHandler {
    switch (terminologyType) {
      case 'snomed':
        return new SnomedHandler(config);
      case 'loinc':
        return new LoincHandler(config);
      case 'rxnorm':
        return new RxNormHandler(config);
      default:
        throw new Error(`Unsupported terminology type: ${terminologyType}`);
    }
  }
}
