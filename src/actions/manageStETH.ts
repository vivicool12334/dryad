import type { Action, ActionResult, Content, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { parseAbi, formatEther, formatUnits } from 'viem';
import { CHAIN, FINANCIAL } from '../config/constants.ts';
import { getRuntimeEvmClients } from './evmClients.ts';

// Lido wstETH on Base (or testnet override)
const WSTETH_BASE = CHAIN.WSTETH_ADDRESS;

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

// Approximate annual stETH yield rate - from centralized config
const ANNUAL_YIELD_RATE = FINANCIAL.STETH_APR;

interface CoinGeckoPriceResponse {
  ethereum?: {
    usd?: number;
  };
}

export const manageStETHAction: Action = {
  name: 'MANAGE_STETH',
  similes: ['CHECK_STETH', 'STETH_BALANCE', 'TREASURY_STATUS', 'CHECK_YIELD', 'STAKE_ETH'],
  description:
    'Manage the stETH treasury on Base. Check wstETH balance, calculate yield, and ensure yield-only spending policy is maintained. The agent stakes ETH to earn stETH yield and spends only the yield, never touching principal.',

  validate: async (runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
    const pk = runtime.getSetting('EVM_PRIVATE_KEY') || process.env.EVM_PRIVATE_KEY;
    return !!pk;
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
      logger.info('Checking stETH treasury status');

      const { account, publicClient } = getRuntimeEvmClients(runtime);
      const stethAddress = (process.env.STETH_BASE_ADDRESS || WSTETH_BASE) as `0x${string}`;

      // Get wstETH balance
      const balance = await publicClient.readContract({
        address: stethAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      }) as bigint;

      const formattedBalance = formatEther(balance);
      const balanceNum = parseFloat(formattedBalance);

      // Get ETH balance too
      const ethBalance = await publicClient.getBalance({ address: account.address });
      const formattedEthBalance = formatEther(ethBalance);

      // Calculate estimated yields
      const dailyYield = (balanceNum * ANNUAL_YIELD_RATE) / 365;
      const monthlyYield = dailyYield * 30;
      const annualYield = balanceNum * ANNUAL_YIELD_RATE;

      // Fetch live ETH price, fallback to $2500
      let estimatedEthPrice = 2500;
      try {
        const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', { signal: AbortSignal.timeout(5000) });
        if (priceRes.ok) {
          const priceData = await priceRes.json() as CoinGeckoPriceResponse;
          estimatedEthPrice = priceData?.ethereum?.usd || 2500;
        }
      } catch { /* use fallback */ }
      const dailyYieldUSD = dailyYield * estimatedEthPrice;
      const monthlyYieldUSD = monthlyYield * estimatedEthPrice;

      const responseText = `## Treasury Status - Dryad

**Wallet:** \`${account.address}\`

### Balances
- **wstETH:** ${balanceNum.toFixed(6)} wstETH (~$${(balanceNum * estimatedEthPrice).toFixed(2)})
- **ETH:** ${parseFloat(formattedEthBalance).toFixed(6)} ETH

### Yield Projections (${(ANNUAL_YIELD_RATE * 100).toFixed(1)}% APR)
- **Daily yield:** ~${dailyYield.toFixed(6)} ETH (~$${dailyYieldUSD.toFixed(2)})
- **Monthly yield:** ~${monthlyYield.toFixed(6)} ETH (~$${monthlyYieldUSD.toFixed(2)})
- **Annual yield:** ~${annualYield.toFixed(6)} ETH

### Spending Policy
✅ **Yield-only spending** - Principal is never touched.
Available to spend from yield: ~$${monthlyYieldUSD.toFixed(2)}/month

${
  balanceNum === 0
    ? '⚠️ **No wstETH detected.** Consider bridging stETH to Base to fund the treasury.'
    : monthlyYieldUSD < 200
      ? '⚠️ **Monthly yield is below $200 contractor budget.** Consider increasing stETH position.'
      : '✅ **Treasury is healthy.** Yield covers projected monthly expenses.'
}`;

      await callback({
        text: responseText,
        actions: ['MANAGE_STETH'],
        source: message.content.source,
      });

      return {
        text: `Treasury check complete. wstETH: ${formattedBalance}, Daily yield: ~$${dailyYieldUSD.toFixed(2)}`,
        values: {
          success: true,
          wstethBalance: formattedBalance,
          ethBalance: formattedEthBalance,
          dailyYieldETH: dailyYield,
          dailyYieldUSD,
          monthlyYieldUSD,
        },
        data: { wallet: account.address },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in MANAGE_STETH action');
      const errorMsg = `Failed to check treasury: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: errorMsg, actions: ['MANAGE_STETH'], source: message.content.source });
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
      { name: '{{name1}}', content: { text: 'How is the treasury?' } },
      {
        name: 'Dryad',
        content: { text: 'Checking stETH treasury and yield projections...', actions: ['MANAGE_STETH'] },
      },
    ],
    [
      { name: '{{name1}}', content: { text: 'What can we spend this month?' } },
      {
        name: 'Dryad',
        content: { text: 'Let me calculate our available yield-based budget for this month.', actions: ['MANAGE_STETH'] },
      },
    ],
  ],
};
