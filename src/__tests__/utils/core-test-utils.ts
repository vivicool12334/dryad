import { mock } from 'bun:test';
import { composeActionExamples, formatActionNames, formatActions } from '@elizaos/core';
import type { Action, Content, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { v4 as uuidv4 } from 'uuid';

/** Shared helpers for the starter-style test suite. */
export const runCoreActionTests = (actions: Action[]) => {
  for (const action of actions) {
    if (!action.name) {
      throw new Error('Action missing name property');
    }
    if (!action.description) {
      throw new Error(`Action ${action.name} missing description property`);
    }
    if (!action.examples || !Array.isArray(action.examples)) {
      throw new Error(`Action ${action.name} missing examples array`);
    }
    if (!action.similes || !Array.isArray(action.similes)) {
      throw new Error(`Action ${action.name} missing similes array`);
    }
    if (typeof action.handler !== 'function') {
      throw new Error(`Action ${action.name} missing handler function`);
    }
    if (typeof action.validate !== 'function') {
      throw new Error(`Action ${action.name} missing validate function`);
    }
  }

  for (const action of actions) {
    for (const example of action.examples ?? []) {
      for (const message of example) {
        if (!message.name) {
          throw new Error(`Example message in action ${action.name} missing name property`);
        }
        if (!message.content) {
          throw new Error(`Example message in action ${action.name} missing content property`);
        }
        if (!message.content.text) {
          throw new Error(`Example message in action ${action.name} missing content.text property`);
        }
      }
    }
  }

  const names = actions.map((action) => action.name);
  const uniqueNames = new Set(names);
  if (names.length !== uniqueNames.size) {
    throw new Error('Duplicate action names found');
  }

  const formattedNames = formatActionNames(actions);
  if (!formattedNames && actions.length > 0) {
    throw new Error('formatActionNames failed to produce output');
  }

  const formattedActions = formatActions(actions);
  if (!formattedActions && actions.length > 0) {
    throw new Error('formatActions failed to produce output');
  }

  const composedExamples = composeActionExamples(actions, 1);
  if (!composedExamples && actions.length > 0) {
    throw new Error('composeActionExamples failed to produce output');
  }

  return {
    formattedNames,
    formattedActions,
    composedExamples,
  };
};

export const createMockRuntime = (): IAgentRuntime => {
  return {
    initPromise: Promise.resolve(),
    character: {
      name: 'Test Character',
      system: 'You are a helpful assistant for testing.',
    },
    getSetting: (key: string) => null,
    models: {},
    db: {
      get: async () => null,
      set: async () => true,
      delete: async () => true,
      getKeys: async () => [],
    },
    memory: {
      add: async () => {},
      get: async () => null,
      getByEntityId: async () => [],
      getLatest: async () => null,
      getRecentMessages: async () => [],
      search: async () => [],
    },
    actions: [],
    providers: [],
    getService: mock(),
    processActions: mock(),
    hasElizaOS: mock(() => false),
  } as any as IAgentRuntime;
};

export const documentTestResult = (testName: string, result: any, error: Error | null = null) => {
  logger.info(`✓ Testing: ${testName}`);

  if (error) {
    logger.error(`✗ Error: ${error.message}`);
    if (error.stack) {
      logger.error(`Stack: ${error.stack}`);
    }
    return;
  }

  if (result) {
    if (typeof result === 'string') {
      if (result.trim() && result.length > 0) {
        const preview = result.length > 60 ? `${result.substring(0, 60)}...` : result;
        logger.info(`  → ${preview}`);
      }
    } else if (typeof result === 'object') {
      try {
        const keys = Object.keys(result);
        if (keys.length > 0) {
          const preview = keys.slice(0, 3).join(', ');
          const more = keys.length > 3 ? ` +${keys.length - 3} more` : '';
          logger.info(`  → {${preview}${more}}`);
        }
      } catch (e) {
        logger.info(`  → [Complex object]`);
      }
    }
  }
};

export const createMockMessage = (text: string): Memory => {
  return {
    entityId: uuidv4(),
    roomId: uuidv4(),
    content: {
      text,
      source: 'test',
    },
  } as Memory;
};

export const createMockState = (): State => {
  return {
    values: {},
    data: {},
    text: '',
  };
};
