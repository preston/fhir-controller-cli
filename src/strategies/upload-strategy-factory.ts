// Author: Preston Lee

import { UploadStrategy, UploadStrategyConfig } from './upload-strategy.js';
import { DirectUploadStrategy } from './direct-upload-strategy.js';
import { StagedUploadStrategy } from './staged-upload-strategy.js';

export class UploadStrategyFactory {
  /**
   * Create the appropriate upload strategy for a resource
   */
  static createStrategy(resource: any, config: UploadStrategyConfig): UploadStrategy {
    const strategies = [
      new DirectUploadStrategy(config),
      new StagedUploadStrategy(config)
    ];

    // Find the first strategy that should be used for this resource
    for (const strategy of strategies) {
      if (strategy.shouldUseStrategy(resource)) {
        return strategy;
      }
    }

    // Default to direct upload if no strategy matches
    return new DirectUploadStrategy(config);
  }
}
