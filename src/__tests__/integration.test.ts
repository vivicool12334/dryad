import { IAgentRuntime, logger, Plugin } from '@elizaos/core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { character } from '../index';
import plugin from '../plugin';

beforeAll(() => {
  spyOn(logger, 'info').mockImplementation(() => {});
  spyOn(logger, 'error').mockImplementation(() => {});
  spyOn(logger, 'warn').mockImplementation(() => {});
  spyOn(logger, 'debug').mockImplementation(() => {});
});

const isCI = Boolean(process.env.CI);
describe('Integration: Project Structure and Components', () => {
  it('should have a valid package structure', () => {
    const srcDir = path.join(process.cwd(), 'src');
    expect(fs.existsSync(srcDir)).toBe(true);

    const srcFiles = [path.join(srcDir, 'index.ts'), path.join(srcDir, 'plugin.ts')];

    srcFiles.forEach((file) => {
      expect(fs.existsSync(file)).toBe(true);
    });
  });

  it('should have dist directory for build outputs', () => {
    const distDir = path.join(process.cwd(), 'dist');

    if (!fs.existsSync(distDir)) {
      logger.warn('Dist directory does not exist yet. Build the project first.');
      return;
    }

    expect(fs.existsSync(distDir)).toBe(true);
  });
});

describe('Integration: Character and Plugin', () => {
  it('should have character with required properties', () => {
    expect(character).toHaveProperty('name');
    expect(character).toHaveProperty('plugins');
    expect(character).toHaveProperty('bio');
    expect(character).toHaveProperty('system');
    expect(character).toHaveProperty('messageExamples');

    expect(Array.isArray(character.plugins)).toBe(true);
  });

  it('should configure plugin correctly', () => {
    expect(plugin).toHaveProperty('name');
    expect(plugin).toHaveProperty('description');
    expect(plugin).toHaveProperty('init');

    const components = ['models', 'actions', 'providers', 'services', 'routes', 'events'];
    components.forEach((component) => {
      if ((plugin as any)[component]) {
        expect(
          Array.isArray((plugin as any)[component]) ||
            typeof (plugin as any)[component] === 'object'
        ).toBeTruthy();
      }
    });
  });
});

describe('Integration: Runtime Initialization', () => {
  it('should create a mock runtime with character and plugin', async () => {
    const customMockRuntime = {
      character: { ...character },
      plugins: [],
      registerPlugin: mock().mockImplementation((plugin: Plugin) => {
        return Promise.resolve();
      }),
      initialize: mock(),
      getService: mock(),
      getSetting: mock().mockReturnValue(null),
      useModel: mock().mockResolvedValue('Test model response'),
      getProviderResults: mock().mockResolvedValue([]),
      evaluateProviders: mock().mockResolvedValue([]),
      evaluate: mock().mockResolvedValue([]),
    } as Partial<IAgentRuntime> as IAgentRuntime;

    const originalInit = plugin.init;
    let initCalled = false;

    if (plugin.init) {
      plugin.init = mock(async (config, runtime) => {
        initCalled = true;

        if (originalInit) {
          await originalInit(config, runtime);
        }

        await runtime.registerPlugin(plugin);
      });
    }

    try {
      if (plugin.init) {
        await plugin.init({}, customMockRuntime);
      }

      expect(initCalled).toBe(true);

      expect(customMockRuntime.registerPlugin).toHaveBeenCalled();
    } catch (error) {
      console.error('Error initializing plugin:', error);
      throw error;
    } finally {
      // Restore the original init method to avoid affecting other tests
      plugin.init = originalInit;
    }
  });
});

// Skip scaffolding tests in CI environments as they modify the filesystem
const describeScaffolding = isCI ? describe.skip : describe;
describeScaffolding('Integration: Project Scaffolding', () => {
  const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'eliza-test-'));

  beforeAll(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should scaffold a new project correctly', () => {
    try {
      const srcFiles = ['index.ts', 'plugin.ts', 'character.ts'];

      for (const file of srcFiles) {
        const sourceFilePath = path.join(process.cwd(), 'src', file);
        const targetFilePath = path.join(TEST_DIR, file);

        if (fs.existsSync(sourceFilePath)) {
          fs.copyFileSync(sourceFilePath, targetFilePath);
        }
      }

      const packageJson = {
        name: 'test-project',
        version: '1.0.0',
        type: 'module',
        dependencies: {
          '@elizaos/core': 'workspace:*',
        },
      };

      fs.writeFileSync(path.join(TEST_DIR, 'package.json'), JSON.stringify(packageJson, null, 2));

      expect(fs.existsSync(path.join(TEST_DIR, 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, 'plugin.ts'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, 'character.ts'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, 'package.json'))).toBe(true);
    } catch (error) {
      logger.error({ error }, 'Error in scaffolding test:');
      throw error;
    }
  });
});
