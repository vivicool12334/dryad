import type { Action, ActionResult, Content, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const DIEM_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function stake(uint256 amount) returns (bool)',
  'function stakedBalance(address owner) view returns (uint256)',
]);

function getClients(runtime: IAgentRuntime) {
  const privateKey = runtime.getSetting('EVM_PRIVATE_KEY') || process.env.EVM_PRIVATE_KEY;
  if (!privateKey) throw new Error('EVM_PRIVATE_KEY not configured');

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  return { account, publicClient, walletClient };
}

function getDiemAddress(): `0x${string}` {
  return (process.env.DIEM_TOKEN_ADDRESS || '0xf4d97f2da56e8c3098f3a8d538db630a2606a024') as `0x${string}`;
}

export const manageDIEMAction: Action = {
  name: 'MANAGE_DIEM',
  similes: ['CHECK_DIEM', 'DIEM_BALANCE', 'BUY_DIEM', 'STAKE_DIEM', 'VENICE_CREDITS'],
  description:
    'Manage DIEM tokens on Base L2. Check balance, buy DIEM, or stake DIEM to generate daily Venice API credits. 1 DIEM = $1/day in API credits.',

  validate: async (runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
    const pk = runtime.getSetting('EVM_PRIVATE_KEY') || process.env.EVM_PRIVATE_KEY;
    return !!pk;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      logger.info('Managing DIEM tokens');

      const { account, publicClient } = getClients(runtime);
      const diemAddress = getDiemAddress();

      // Get DIEM balance
      let decimals: number;
      try {
        decimals = await publicClient.readContract({
          address: diemAddress,
          abi: DIEM_ABI,
          functionName: 'decimals',
        }) as number;
      } catch {
        decimals = 18;
      }

      const balance = await publicClient.readContract({
        address: diemAddress,
        abi: DIEM_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      }) as bigint;

      const formattedBalance = formatUnits(balance, decimals);

      // Try to get staked balance (may not exist on all contracts)
      let stakedBalance = '0';
      try {
        const staked = await publicClient.readContract({
          address: diemAddress,
          abi: DIEM_ABI,
          functionName: 'stakedBalance',
          args: [account.address],
        }) as bigint;
        stakedBalance = formatUnits(staked, decimals);
      } catch {
        // stakedBalance function may not exist
      }

      const dailyCredits = parseFloat(stakedBalance);

      const responseText = `## DIEM Token Status

**Wallet:** \`${account.address}\`
**DIEM Balance:** ${formattedBalance} DIEM
**Staked DIEM:** ${stakedBalance} DIEM
**Estimated Daily Venice Credits:** ~$${dailyCredits.toFixed(2)}/day

${
  dailyCredits < 1
    ? '⚠️ **Warning:** Staked DIEM is low. Consider staking more to ensure sufficient Venice API credits for continued inference.'
    : '✅ **Status:** Sufficient DIEM staked for daily inference costs.'
}

*1 DIEM staked = $1/day in Venice API credits*`;

      await callback({
        text: responseText,
        actions: ['MANAGE_DIEM'],
        source: message.content.source,
      });

      return {
        text: `DIEM status checked. Balance: ${formattedBalance}, Staked: ${stakedBalance}`,
        values: {
          success: true,
          balance: formattedBalance,
          stakedBalance,
          dailyCredits,
        },
        data: { wallet: account.address },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in MANAGE_DIEM action');
      const errorMsg = `Failed to manage DIEM: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: errorMsg, actions: ['MANAGE_DIEM'], source: message.content.source });
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
      { name: '{{name1}}', content: { text: 'Check our DIEM balance' } },
      {
        name: 'Dryad',
        content: { text: 'Checking DIEM token balance and staking status on Base...', actions: ['MANAGE_DIEM'] },
      },
    ],
    [
      { name: '{{name1}}', content: { text: 'How many Venice credits do we have?' } },
      {
        name: 'Dryad',
        content: { text: 'Let me check our staked DIEM to calculate daily Venice API credits.', actions: ['MANAGE_DIEM'] },
      },
    ],
  ],
};
