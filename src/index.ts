import { logger, type IAgentRuntime, type Project, type ProjectAgent } from '@elizaos/core';
import dryadPlugin from './plugin.ts';
import { character } from './character.ts';
import { DEMO_MODE } from './config/constants.ts';

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info('Initializing Dryad - Autonomous Land Management Agent');
  logger.info({ name: character.name }, 'Agent:');

  // Initialize demo mode if enabled
  if (DEMO_MODE) {
    logger.info('[Dryad] DEMO_MODE is active');
    import('./demo/runner.ts').then(({ initDemo }) => initDemo()).catch(() => {
      logger.warn('[Dryad] Demo runner not available — skipping');
    });
  }
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
  plugins: [dryadPlugin],
};

const project: Project = {
  agents: [projectAgent],
};

export { character } from './character.ts';

export default project;
