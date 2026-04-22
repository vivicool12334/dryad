import { describe, expect, it, spyOn, beforeAll } from 'bun:test';
import plugin from '../plugin';
import { logger } from '@elizaos/core';
import dotenv from 'dotenv';

dotenv.config();

beforeAll(() => {
  spyOn(logger, 'info');
  spyOn(logger, 'error');
  spyOn(logger, 'warn');
});

describe('Plugin Models', () => {
  it('should not define custom models (model handling is delegated to provider plugins)', () => {
    // The Dryad plugin intentionally does not register custom model handlers.
    // Model inference is provided by @elizaos/plugin-openai or @elizaos/plugin-anthropic.
    expect(plugin.models).toBeUndefined();
  });
});
