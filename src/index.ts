import { logger, type IAgentRuntime, type Project, type ProjectAgent } from '@elizaos/core';
import dryadPlugin from './plugin.ts';
import { character } from './character.ts';

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info('Initializing Dryad - Autonomous Land Management Agent');
  logger.info({ name: character.name }, 'Agent:');
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
