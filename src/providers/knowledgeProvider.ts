import type { Provider, IAgentRuntime, Memory, State, ProviderResult } from '@elizaos/core';
import * as fs from 'fs';
import * as path from 'path';

const knowledgeProvider: Provider = {
  name: 'dryad-knowledge',
  description: 'Local knowledge base for ecology, Detroit context, and operations',

  async get(_runtime: IAgentRuntime, message: Memory, _state?: State): Promise<ProviderResult> {
    const knowledgeDir = path.join(__dirname, '../knowledge');

    let files: string[];
    try {
      files = fs.readdirSync(knowledgeDir).filter(f => f.endsWith('.md'));
    } catch {
      return { text: '', values: {}, data: {} };
    }

    const messageText = (message.content?.text || '').toLowerCase();
    const relevantKnowledge: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(knowledgeDir, file), 'utf-8');
      const filename = file.replace('.md', '');

      if (filename === 'ecology' && /invasive|native|species|plant|tree|oak|prairie|restoration|ecosystem|canopy|seed|sapling|knotweed|buckthorn|ailanthus|phragmites|milkweed/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'detroit' && /detroit|vacant|lot|dlba|land bank|neighborhood|chadsey|community|tax|conservancy|equity|mow/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'operations' && /treasury|wallet|contract|milestone|payment|decision|loop|how|work|steth|diem|uniswap|email|submit/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'contractors' && /contractor|hire|worker|removal|planting|mow|onboard|discovery/.test(messageText)) {
        relevantKnowledge.push(content);
      }
    }

    if (relevantKnowledge.length === 0) return { text: '', values: {}, data: {} };

    return {
      text: '--- DRYAD KNOWLEDGE BASE ---\n' + relevantKnowledge.join('\n---\n') + '\n--- END KNOWLEDGE ---',
      values: {},
      data: {},
    };
  },
};

export default knowledgeProvider;
