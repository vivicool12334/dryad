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
      if (filename === 'detroit' && /detroit|vacant|lot|dlba|land bank|neighborhood|chadsey|community|tax|conservancy|equity|mow|heat island|temperature|canopy/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'operations' && /treasury|wallet|contract|milestone|payment|decision|loop|how|work|steth|diem|uniswap|email|submit/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'contractors' && /contractor|hire|worker|removal|planting|mow|onboard|discovery/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'learned' && /learn|discover|new|recent|observe|found|spotted|species/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'greenspaces' && /green\s?space|health|mental|crime|property value|stormwater|carbon|air quality|heat|cool|pollinator|biodiversity|corridor|benefit|impact|why|matter|important|equity|justice/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'invasives-research' && /invasive|ailanthus|tree of heaven|lanternfly|slf|knotweed|cascade|cost|billion|management|edrr|early detection|agriculture|grape/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'the-human-cost' && /violence|gun|crime|safety|mental health|depression|anxiety|trauma|children|school|absentee|lead|broken windows|fear/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'economic-multiplier' && /cost|economic|tax|property value|blight|arson|roi|return on investment|tipping point|vacancy rate|dlba|budget|billion|million/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'ecological-crisis' && /lanternfly|slf|emerald ash|eab|seed bank|pollinator|bee|butterfly|monarch|agriculture|grape|orchard|cascade|extinction|endemic/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'heat-climate' && /heat|temperature|hot|cool|canopy|climate|mortality|death|heatwave|blackout|racial|disparity|urban heat island/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'health-pipeline' && /asthma|cardiovascular|heart|lung|life expectancy|hospitalization|ndvi|air quality|pollution|respiratory|health outcome|dose.response/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'structural-failure' && /fail|mortality|tree death|survival|maintenance|grant cycle|nonprofit|volunteer|burnout|greening of detroit|sustain|fund/.test(messageText)) {
        relevantKnowledge.push(content);
      }
      if (filename === 'civic-identity' && /civic|community|ownership|steward|collective|efficacy|garden|vote|voter|participation|neighborhood pride|identity|belong/.test(messageText)) {
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
