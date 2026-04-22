import type { Action, ActionResult, Content, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { parseAbi, encodeAbiParameters, keccak256, toHex } from 'viem';
import { CHAIN } from '../config/constants.ts';
import { getRuntimeEvmClients } from './evmClients.ts';
import { MILESTONE_TYPES, getMilestoneTypeIndex, type MilestoneType } from '../shared/milestones.ts';
import { PARCEL_ADDRESSES } from '../shared/parcels.ts';

// DryadMilestones.sol ABI
const MILESTONES_ABI = parseAbi([
  'function recordMilestone(uint8 milestoneType, string parcel, string description, bytes32 dataHash) returns (uint256)',
  'function getMilestone(uint256 id) view returns (uint8 milestoneType, string parcel, string description, bytes32 dataHash, uint256 timestamp, address recorder)',
  'function milestoneCount() view returns (uint256)',
  'event MilestoneRecorded(uint256 indexed id, uint8 milestoneType, string parcel, uint256 timestamp)',
]);

function parseMilestoneFromMessage(text: string): { type: MilestoneType | null; parcel: string | null; description: string } {
  const lowerText = text.toLowerCase();

  let milestoneType: MilestoneType | null = null;
  if (lowerText.includes('assessment') || lowerText.includes('assess') || lowerText.includes('survey')) {
    milestoneType = 'SiteAssessment';
  } else if (lowerText.includes('invasive') || lowerText.includes('removal') || lowerText.includes('remove')) {
    milestoneType = 'InvasiveRemoval';
  } else if (lowerText.includes('soil') || lowerText.includes('prep')) {
    milestoneType = 'SoilPrep';
  } else if (lowerText.includes('plant') || lowerText.includes('native')) {
    milestoneType = 'NativePlanting';
  } else if (lowerText.includes('monitor') || lowerText.includes('check')) {
    milestoneType = 'Monitoring';
  }

  let parcel: string | null = null;
  for (const parcelAddress of PARCEL_ADDRESSES) {
    const addr = parcelAddress.split(' ')[0]; // e.g., "4475"
    if (text.includes(addr)) {
      parcel = parcelAddress;
      break;
    }
  }

  return { type: milestoneType, parcel, description: text };
}

export const recordMilestoneAction: Action = {
  name: 'RECORD_MILESTONE',
  similes: ['LOG_MILESTONE', 'RECORD_PROGRESS', 'ONCHAIN_MILESTONE', 'TRACK_MILESTONE'],
  description:
    'Record a land management milestone onchain on Base L2. Milestone types: SiteAssessment, InvasiveRemoval, SoilPrep, NativePlanting, Monitoring. Each is permanently stored onchain.',

  validate: async (runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
    const pk = runtime.getSetting('EVM_PRIVATE_KEY') || process.env.EVM_PRIVATE_KEY;
    const contractAddr = process.env.MILESTONES_CONTRACT_ADDRESS;
    return !!pk && !!contractAddr;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      logger.info('Recording milestone onchain');

      const contractAddress = process.env.MILESTONES_CONTRACT_ADDRESS as `0x${string}`;
      if (!contractAddress) {
        const errorMsg = 'Milestones contract not deployed yet. Set MILESTONES_CONTRACT_ADDRESS in .env';
        await callback({ text: errorMsg, actions: ['RECORD_MILESTONE'], source: message.content.source });
        return { text: errorMsg, values: { success: false }, data: {}, success: false };
      }

      const { type, parcel, description } = parseMilestoneFromMessage(message.content.text || '');

      if (!type) {
        const errorMsg = `Could not determine milestone type. Please specify one of: ${MILESTONE_TYPES.join(', ')}`;
        await callback({ text: errorMsg, actions: ['RECORD_MILESTONE'], source: message.content.source });
        return { text: errorMsg, values: { success: false }, data: {}, success: false };
      }

      if (!parcel) {
        const errorMsg = `Could not determine parcel. Please include an address number: ${PARCEL_ADDRESSES.map((parcelAddress) => parcelAddress.split(' ')[0]).join(', ')}`;
        await callback({ text: errorMsg, actions: ['RECORD_MILESTONE'], source: message.content.source });
        return { text: errorMsg, values: { success: false }, data: {}, success: false };
      }

      const { publicClient, walletClient } = getRuntimeEvmClients(runtime);
      const typeIndex = getMilestoneTypeIndex(type);
      const dataHash = keccak256(toHex(description));

      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: MILESTONES_ABI,
        functionName: 'recordMilestone',
        args: [typeIndex, parcel, description, dataHash],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      const responseText = `## Milestone Recorded Onchain

**Type:** ${type}
**Parcel:** ${parcel}
**Description:** ${description}
**Transaction:** \`${hash}\`
**Block:** ${receipt.blockNumber}
**Status:** ${receipt.status === 'success' ? '✅ Confirmed' : '❌ Failed'}

This milestone is now permanently recorded on Base L2.`;

      await callback({
        text: responseText,
        actions: ['RECORD_MILESTONE'],
        source: message.content.source,
      });

      return {
        text: `Milestone recorded: ${type} at ${parcel}. TX: ${hash}`,
        values: { success: true, milestoneType: type, parcel, txHash: hash },
        data: { receipt },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in RECORD_MILESTONE action');
      const errorMsg = `Failed to record milestone: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: errorMsg, actions: ['RECORD_MILESTONE'], source: message.content.source });
      return {
        text: errorMsg,
        values: { success: false },
        data: {},
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'Record site assessment complete for 4475 25th St' } },
      {
        name: 'Dryad',
        content: { text: 'Recording SiteAssessment milestone for 4475 25th St onchain...', actions: ['RECORD_MILESTONE'] },
      },
    ],
    [
      { name: '{{name1}}', content: { text: 'Log invasive removal at 4501' } },
      {
        name: 'Dryad',
        content: { text: 'Recording InvasiveRemoval milestone for 4501 25th St on Base L2...', actions: ['RECORD_MILESTONE'] },
      },
    ],
  ],
};
