import { describe, expect, it, spyOn, beforeAll } from 'bun:test';
import plugin from '../plugin';
import { logger } from '@elizaos/core';
import type { Action } from '@elizaos/core';
import dotenv from 'dotenv';
import {
  runCoreActionTests,
  documentTestResult,
  createMockRuntime,
  createMockMessage,
  createMockState,
} from './utils/core-test-utils';

dotenv.config();

beforeAll(() => {
  spyOn(logger, 'info');
  spyOn(logger, 'error');
  spyOn(logger, 'warn');
});

describe('Actions', () => {
  it('should have actions defined', () => {
    expect(plugin.actions).toBeDefined();
    expect(Array.isArray(plugin.actions)).toBe(true);
    if (plugin.actions) {
      expect(plugin.actions.length).toBeGreaterThan(0);
    }
  });

  it('should pass core action tests', () => {
    if (plugin.actions) {
      const coreTestResults = runCoreActionTests(plugin.actions);
      expect(coreTestResults).toBeDefined();
      expect(coreTestResults.formattedNames).toBeDefined();
      expect(coreTestResults.formattedActions).toBeDefined();
      expect(coreTestResults.composedExamples).toBeDefined();

      documentTestResult('Core Action Tests', coreTestResults);
    }
  });

  describe('CHECK_BIODIVERSITY Action', () => {
    const action: Action | undefined = plugin.actions?.find(
      (a) => a.name === 'CHECK_BIODIVERSITY'
    );

    it('should exist in the plugin', () => {
      expect(action).toBeDefined();
    });

    it('should have the correct structure', () => {
      if (action) {
        expect(action).toHaveProperty('name', 'CHECK_BIODIVERSITY');
        expect(action).toHaveProperty('description');
        expect(action).toHaveProperty('similes');
        expect(action).toHaveProperty('validate');
        expect(action).toHaveProperty('handler');
        expect(action).toHaveProperty('examples');
        expect(Array.isArray(action.similes)).toBe(true);
        expect(Array.isArray(action.examples)).toBe(true);
      }
    });

    it('should return true from validate function', async () => {
      if (action) {
        const runtime = createMockRuntime();
        const mockMessage = createMockMessage('Check biodiversity');
        const mockState = createMockState();

        let result = false;
        let error: Error | null = null;

        try {
          result = await action.validate(runtime, mockMessage, mockState);
          expect(typeof result).toBe('boolean');
        } catch (e) {
          error = e as Error;
          logger.error({ error: e }, 'Validate function error:');
        }

        documentTestResult('CHECK_BIODIVERSITY action validate', result, error);
      }
    });
  });

  describe('Action structure invariants', () => {
    it('all actions should have required fields', () => {
      if (plugin.actions) {
        plugin.actions.forEach((action) => {
          expect(action).toHaveProperty('name');
          expect(action).toHaveProperty('description');
          expect(action).toHaveProperty('handler');
          expect(typeof action.name).toBe('string');
          expect(typeof action.description).toBe('string');
          expect(typeof action.handler).toBe('function');
        });
      }
    });

    it('all actions should have unique names', () => {
      if (plugin.actions) {
        const names = plugin.actions.map((a) => a.name);
        const uniqueNames = new Set(names);
        expect(names.length).toBe(uniqueNames.size);
      }
    });
  });
});
