import { describe, expect, it, beforeEach, afterEach, spyOn } from 'bun:test';
import plugin from '../plugin';
import { createMockRuntime } from './utils/core-test-utils';
import { logger } from '@elizaos/core';

// Access the plugin's init function
const initPlugin = plugin.init;

describe('Plugin Initialization', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    spyOn(logger, 'info');
    spyOn(logger, 'error');
    spyOn(logger, 'warn');
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should accept empty configuration', async () => {
    if (initPlugin) {
      let error: Error | null = null;
      try {
        await initPlugin({}, createMockRuntime());
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeNull();
    }
  });

  it('should accept configuration with additional properties', async () => {
    if (initPlugin) {
      let error: Error | null = null;
      try {
        await initPlugin({ SOME_EXTRA_VAR: 'value' }, createMockRuntime());
      } catch (e) {
        error = e as Error;
      }
      expect(error).toBeNull();
    }
  });

  it('should log initialization messages', async () => {
    if (initPlugin) {
      await initPlugin({}, createMockRuntime());
      expect(logger.info).toHaveBeenCalled();
    }
  });
});
