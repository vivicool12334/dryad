import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import {
  getAllContractors, addContractor, getBestContractorForService,
  type ServiceType, type ContractorRecord,
} from '../providers/contractorReputation.ts';
import { getCurrentSeason } from '../utils/seasonalAwareness.ts';
const SERVICE_LABELS: Record<ServiceType, string> = {
  invasive_removal: 'Invasive Species Removal',
  planting: 'Native Planting',
  soil_prep: 'Soil Preparation & Testing',
  mowing: 'Prairie Establishment Mowing',
  site_assessment: 'Site Assessment & Survey',
  tree_work: 'Tree Work (Hazard Removal, Pruning)',
};

const DISCOVERY_SOURCES = [
  { name: 'Greening of Detroit', url: 'https://www.greeningofdetroit.com/', focus: 'tree planting, stewardship' },
  { name: 'Keep Growing Detroit', url: 'https://www.keepgrowingdetroit.org/', focus: 'community land stewardship' },
  { name: 'ISA Certified Arborists', url: 'https://www.treesaregood.org/findanarborist', focus: 'tree work, hazard removal' },
  { name: 'USDA NRCS', url: 'https://www.nrcs.usda.gov/contact/find-a-service-center', focus: 'conservation contractors' },
  { name: 'Michigan EGLE', url: 'https://www.michigan.gov/egle', focus: 'licensed environmental contractors' },
];

function parseServiceType(text: string): ServiceType | null {
  const lower = text.toLowerCase();
  if (/invasive|removal|knotweed|buckthorn|honeysuckle/.test(lower)) return 'invasive_removal';
  if (/plant|seed|sapling|oak|native/.test(lower)) return 'planting';
  if (/soil|test|amend|compost/.test(lower)) return 'soil_prep';
  if (/mow|cut|prairie/.test(lower)) return 'mowing';
  if (/assess|survey|walk|inspect/.test(lower)) return 'site_assessment';
  if (/tree|hazard|prune|arborist/.test(lower)) return 'tree_work';
  return null;
}

function scoreCandidate(info: { certifications?: string[]; location?: string; experience?: string; cryptoReady?: boolean }): number {
  let score = 0;
  if (info.certifications?.length) score += Math.min(info.certifications.length * 10, 30);
  if (info.location && /detroit|wayne|dearborn|highland park/i.test(info.location)) score += 25;
  if (info.experience && /invasive|native|restoration|conservation/i.test(info.experience)) score += 20;
  if (info.cryptoReady) score += 10;
  return Math.min(score, 100);
}

function draftOutreachEmail(name: string, serviceType: ServiceType, source: string): string {
  const season = getCurrentSeason();
  const label = SERVICE_LABELS[serviceType];
  const seasonNote = season.season === 'EARLY_SPRING'
    ? 'Spring invasive removal window closes mid-April. Timely scheduling is important.'
    : season.season === 'SPRING'
    ? 'We are in the prime planting window (May-June).'
    : '';

  return `Subject: Native Habitat Restoration Work - ${label} at 25th St, Detroit

Hi ${name},

I'm Dryad, an autonomous land management agent stewarding 9 vacant lots at 4475–4523 25th Street in Detroit's Chadsey-Condon neighborhood. We're restoring these lots to native lakeplain oak opening habitat - the ecosystem that existed here before European settlement.

I found your contact through ${source}. We're looking for help with ${label.toLowerCase()}:

Location: 4475–4523 25th St, Detroit MI 48216 (GPS: 42.3417°N, 83.1001°W)
Budget: Up to $100 for this initial job
${seasonNote ? `Note: ${seasonNote}` : ''}

Payment is in USDC on Base (Ethereum L2). If you don't have a crypto wallet, services like Holyheld (holyheld.com) or Gnosis Pay (gnosispay.com) let you spend USDC directly with a debit card.

After completing work, please submit GPS-tagged before/after photos at:
${process.env.SERVER_URL || 'http://5.75.225.23:3000'}/Dryad/submit

This is a small initial project. If the work goes well, we have ongoing seasonal maintenance needs across all 9 lots.

For questions, contact Nick George (project steward) at powahgen@gmail.com.

Best,
Dryad
dryadforest.eth | ERC-8004 #35293
dryad@agentmail.to`;
}

export const findContractorAction: Action = {
  name: 'FIND_CONTRACTOR',
  similes: ['SEARCH_CONTRACTOR', 'HIRE_HELP', 'FIND_WORKER', 'GET_CONTRACTOR'],
  description: 'Search for and evaluate contractors for land management work. Checks the registry first, then suggests discovery sources.',

  validate: async () => true,

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      const msgText = message.content.text || '';
      const serviceType = parseServiceType(msgText);

      // Check existing contractors
      const allContractors = getAllContractors();
      const active = allContractors.filter(c => c.status === 'active');

      let responseText = '## Contractor Search\n\n';

      if (serviceType) {
        responseText += `**Service needed:** ${SERVICE_LABELS[serviceType]}\n\n`;

        // Check for existing contractor
        const best = getBestContractorForService(serviceType);
        if (best) {
          responseText += `### Recommended Contractor\n`;
          responseText += `**${best.name}** - ${best.email}\n`;
          responseText += `Reliability: ${best.reliabilityScore}/100 | Jobs: ${best.jobsCompleted} | Total paid: $${best.totalPaidUsd}\n\n`;
          responseText += `I can draft a work order email for this contractor.\n`;
        } else {
          responseText += `### No Active Contractor Found\n`;
          responseText += `No registered contractor offers ${SERVICE_LABELS[serviceType]}.\n\n`;
        }
      }

      // Check if user is providing a new contractor
      const emailMatch = msgText.match(/[\w.+-]+@[\w.-]+\.\w+/);
      const nameMatch = msgText.match(/(?:named?|called?|contact)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);

      if (emailMatch && nameMatch) {
        const name = nameMatch[1];
        const email = emailMatch[0];
        const svc = serviceType || 'site_assessment';

        // Score the candidate
        const score = scoreCandidate({
          location: 'Detroit area',
          experience: msgText.includes('experience') ? msgText : undefined,
        });

        // Add to registry as prospect
        const record = addContractor({
          name,
          email,
          services: [svc],
          status: 'prospect',
          notes: [`Sourced from conversation on ${new Date().toISOString().split('T')[0]}`],
        });

        const outreachEmail = draftOutreachEmail(name, svc, 'a referral');

        responseText += `### New Contractor Added\n`;
        responseText += `**${name}** (${email}) added as prospect.\n`;
        responseText += `Evaluation score: ${score}/100\n`;
        responseText += `Status: prospect → will move to onboarding after first contact\n\n`;
        responseText += `### Draft Outreach Email\n\`\`\`\n${outreachEmail}\n\`\`\`\n\n`;
        responseText += `**Safety:** First job capped at $100. GPS-tagged photos required. Wallet address gets 24hr cooling-off.\n`;
        responseText += `Nick will be notified of this onboarding.\n`;
      } else if (!emailMatch && !serviceType) {
        // General contractor search
        responseText += `### Current Registry\n`;
        if (active.length > 0) {
          for (const c of active) {
            responseText += `- **${c.name}** (${c.services.join(', ')}): reliability ${c.reliabilityScore}/100\n`;
          }
        } else {
          responseText += `No active contractors registered.\n`;
        }
        responseText += `\n### Where to Find Contractors\n`;
        for (const src of DISCOVERY_SOURCES) {
          responseText += `- [${src.name}](${src.url}) - ${src.focus}\n`;
        }
        responseText += `\nTo add a contractor, tell me their name and email. I'll score them and draft an outreach email.\n`;
      }

      await callback({ text: responseText, actions: ['FIND_CONTRACTOR'], source: message.content.source });

      return {
        text: `Contractor search completed. ${active.length} active contractors in registry.`,
        values: { success: true, activeContractors: active.length },
        data: {},
        success: true,
      };
    } catch (error) {
      const msg = `Contractor search failed: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: msg, actions: ['FIND_CONTRACTOR'], source: message.content.source });
      return { text: msg, values: { success: false }, data: {}, success: false };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'Can you find a contractor for invasive removal?' } },
      { name: 'Dryad', content: { text: "Let me check the registry and discovery sources for invasive removal contractors in the Detroit area...", actions: ['FIND_CONTRACTOR'] } },
    ],
    [
      { name: '{{name1}}', content: { text: 'I found a contractor named John Smith at greenworks@email.com' } },
      { name: 'Dryad', content: { text: "I'll evaluate them and draft an outreach email. First job will be capped at $100 as a test.", actions: ['FIND_CONTRACTOR'] } },
    ],
  ],
};
