import { describe, expect, it, spyOn, beforeAll } from 'bun:test';
import plugin from '../plugin';
import { logger } from '@elizaos/core';
import { DecisionLoopService } from '../services/decisionLoop';
import dotenv from 'dotenv';
import { documentTestResult } from './utils/core-test-utils';

dotenv.config();

beforeAll(() => {
  spyOn(logger, 'info');
  spyOn(logger, 'error');
  spyOn(logger, 'warn');
  spyOn(logger, 'debug');
});

describe('Plugin Configuration', () => {
  it('should have correct plugin metadata', () => {
    expect(plugin.name).toBe('dryad');
    expect(typeof plugin.description).toBe('string');
    expect(plugin.description.length).toBeGreaterThan(0);

    documentTestResult('Plugin metadata check', {
      name: plugin.name,
      description: plugin.description,
    });
  });

  it('should have an init function', () => {
    expect(typeof plugin.init).toBe('function');
  });

  it('should initialize without throwing', async () => {
    let error: Error | null = null;
    try {
      await plugin.init?.({});
    } catch (e) {
      error = e as Error;
      logger.error({ error: e }, 'Plugin initialization error:');
    }
    expect(error).toBeNull();

    documentTestResult('Plugin initialization', { success: !error }, error);
  });

  it('should have actions defined', () => {
    expect(Array.isArray(plugin.actions)).toBe(true);
    if (plugin.actions) {
      expect(plugin.actions.length).toBeGreaterThan(0);
    }
  });

  it('should have providers defined', () => {
    expect(Array.isArray(plugin.providers)).toBe(true);
    if (plugin.providers) {
      expect(plugin.providers.length).toBeGreaterThan(0);
    }
  });

  it('should have routes defined', () => {
    expect(Array.isArray(plugin.routes)).toBe(true);
    if (plugin.routes) {
      expect(plugin.routes.length).toBeGreaterThan(0);
    }
  });

  it('should have services defined', () => {
    expect(Array.isArray(plugin.services)).toBe(true);
    if (plugin.services) {
      expect(plugin.services.length).toBeGreaterThan(0);
    }
  });
});

describe('DecisionLoopService', () => {
  it('should have a serviceType defined', () => {
    expect(DecisionLoopService.serviceType).toBeDefined();
    expect(typeof DecisionLoopService.serviceType).toBe('string');
    expect(DecisionLoopService.serviceType.length).toBeGreaterThan(0);
  });

  it('should be included in the plugin services', () => {
    if (plugin.services) {
      const found = plugin.services.some(
        (svc) => (svc as typeof DecisionLoopService).serviceType === DecisionLoopService.serviceType
      );
      expect(found).toBe(true);
    }
  });
});
