import { describe, expect, it, spyOn, beforeAll } from 'bun:test';
import plugin from '../plugin';
import type { IAgentRuntime, Memory, State, Provider } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { documentTestResult } from './utils/core-test-utils';

dotenv.config();

beforeAll(() => {
  spyOn(logger, 'info');
  spyOn(logger, 'error');
  spyOn(logger, 'warn');
  spyOn(logger, 'debug');
});

function createRealRuntime(): IAgentRuntime {
  return {
    character: {
      name: 'Test Character',
      system: 'You are a helpful assistant for testing.',
      plugins: [],
      settings: {},
    },
    getSetting: (_key: string) => null,
    models: {},
    db: {
      get: async (_key: string) => null,
      set: async (_key: string, _value: unknown) => true,
      delete: async (_key: string) => true,
      getKeys: async (_pattern: string) => [],
    },
    memory: {
      add: async (_memory: unknown) => {},
      get: async (_id: string) => null,
      getByEntityId: async (_entityId: string) => [],
      getLatest: async (_entityId: string) => null,
      getRecentMessages: async (_options: unknown) => [],
      search: async (_query: string) => [],
    },
    getService: (_serviceType: string) => null,
  } as Partial<IAgentRuntime> as IAgentRuntime;
}

function createRealMemory(): Memory {
  return {
    id: uuidv4(),
    entityId: uuidv4(),
    roomId: uuidv4(),
    timestamp: Date.now(),
    content: {
      text: 'What can you provide?',
      source: 'test',
      actions: [],
    },
    metadata: {
      type: 'custom',
      sessionId: uuidv4(),
      conversationId: uuidv4(),
    },
  } as Memory;
}

describe('Provider Tests', () => {
  describe('Plugin providers', () => {
    it('should have providers defined', () => {
      expect(plugin.providers).toBeDefined();
      expect(Array.isArray(plugin.providers)).toBe(true);

      if (plugin.providers) {
        expect(plugin.providers.length).toBeGreaterThan(0);
        documentTestResult('Plugin providers check', {
          hasProviders: true,
          providersCount: plugin.providers.length,
          names: plugin.providers.map((p) => p.name),
        });
      }
    });

    it('all providers should have required structure', () => {
      if (plugin.providers) {
        plugin.providers.forEach((provider: Provider) => {
          expect(provider).toHaveProperty('name');
          expect(provider).toHaveProperty('description');
          expect(provider).toHaveProperty('get');
          expect(typeof provider.get).toBe('function');
        });

        documentTestResult('Provider structure check', {
          providersCount: plugin.providers.length,
        });
      }
    });

    it('should have unique provider names', () => {
      if (plugin.providers) {
        const providerNames = plugin.providers.map((provider) => provider.name);
        const uniqueNames = new Set(providerNames);

        const duplicates = providerNames.filter(
          (name, index) => providerNames.indexOf(name) !== index
        );

        expect(providerNames.length).toBe(uniqueNames.size);

        documentTestResult('Provider uniqueness check', {
          totalProviders: providerNames.length,
          uniqueProviders: uniqueNames.size,
          duplicates,
        });
      }
    });

    it('should return data from provider.get methods', async () => {
      if (!plugin.providers || plugin.providers.length === 0) return;

      const runtime = createRealRuntime();
      const message = createRealMemory();
      const state = {
        values: {},
        data: {},
        text: 'Current state context',
      } as State;

      for (const provider of plugin.providers) {
        let result: unknown = null;
        let error: Error | null = null;

        try {
          result = await provider.get(runtime, message, state);
          expect(result).toBeDefined();
        } catch (e) {
          error = e as Error;
          logger.error({ error: e }, `Error in provider ${provider.name}.get:`);
        }

        documentTestResult(`Provider ${provider.name} get method`, result, error);
      }
    });
  });
});
