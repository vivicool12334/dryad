import type { Action, ActionResult, Content, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { parseAbi, formatUnits, parseUnits, parseEther } from 'viem';
import { CHAIN, FINANCIAL } from '../config/constants.ts';
import { getRuntimeEvmClients } from './evmClients.ts';

const DIEM_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function stake(uint256 amount) returns (bool)',
  'function stakedBalance(address owner) view returns (uint256)',
]);

function getDiemAddress(): `0x${string}` {
  return CHAIN.DIEM_ADDRESS;
}

// Uniswap V3 SwapRouter02 on Base
const UNISWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481' as const;
const WETH_BASE = '0x4200000000000000000000000000000000000006' as const;

const SWAP_ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
]);

type QuoteExactInputSingleResult = readonly [bigint, bigint, number, bigint];

/**
 * Buy DIEM with ETH via Uniswap V3 on Base.
 * Returns real transaction hash - no mocks.
 */
async function buyDIEMWithETH(runtime: IAgentRuntime, ethAmount: bigint): Promise<{ hash: string; amountOut: string }> {
  const { account, publicClient, walletClient } = getRuntimeEvmClients(runtime);
  const diemAddress = getDiemAddress();

  // SECURITY: Cap swap amount to prevent accidental wallet drain
  const MAX_SWAP_ETH = parseEther(FINANCIAL.MAX_SWAP_ETH);
  if (ethAmount > MAX_SWAP_ETH) {
    throw new Error(`Swap amount ${formatUnits(ethAmount, 18)} ETH exceeds safety cap of ${formatUnits(MAX_SWAP_ETH, 18)} ETH`);
  }

  // SECURITY: Get a quote first for slippage protection
  // Use Uniswap V3 Quoter to determine expected output, then set 10% slippage tolerance
  const UNISWAP_QUOTER = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a' as const;
  const QUOTER_ABI = parseAbi([
    'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  ]);

  let amountOutMinimum = 0n;
  try {
    const quoteResult = await publicClient.simulateContract({
      address: UNISWAP_QUOTER,
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{
        tokenIn: WETH_BASE,
        tokenOut: diemAddress,
        amountIn: ethAmount,
        fee: 3000,
        sqrtPriceLimitX96: 0n,
      }],
    });
    const expectedOut = (quoteResult.result as QuoteExactInputSingleResult)[0];
    amountOutMinimum = (expectedOut * 90n) / 100n; // 10% slippage tolerance
    logger.info(`[DIEM] Quote: expected ${expectedOut}, min accepted ${amountOutMinimum}`);
  } catch (quoteErr) {
    // If quote fails, reject the swap rather than proceeding with 0 slippage
    logger.error(`[DIEM] Quote failed, rejecting swap for safety: ${quoteErr}`);
    throw new Error('Could not get price quote - swap rejected for slippage safety');
  }

  const hash = await walletClient.writeContract({
    address: UNISWAP_ROUTER,
    abi: SWAP_ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [{
      tokenIn: WETH_BASE,
      tokenOut: diemAddress,
      fee: 3000, // 0.3% fee tier
      recipient: account.address,
      amountIn: ethAmount,
      amountOutMinimum,
      sqrtPriceLimitX96: 0n,
    }],
    value: ethAmount,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`Swap transaction reverted (tx: ${hash})`);
  }
  logger.info(`[DIEM] Swap TX: ${hash} | Block: ${receipt.blockNumber} | Status: ${receipt.status}`);

  // Read new balance
  const newBalance = await publicClient.readContract({
    address: diemAddress, abi: DIEM_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint;

  return { hash, amountOut: formatUnits(newBalance, 18) };
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
    _options,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      logger.info('Managing DIEM tokens');

      const { account, publicClient } = getRuntimeEvmClients(runtime);
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

      // Check if user wants to buy DIEM
      const msgText = (message.content.text || '').toLowerCase();
      const wantsToBuy = msgText.includes('buy') || msgText.includes('swap') || msgText.includes('purchase');

      let buyResult = '';
      if (wantsToBuy) {
        // Extract amount or default to 0.001 ETH. Capped at 0.01 ETH for safety.
        const amountMatch = msgText.match(/(\d+\.?\d*)\s*eth/i);
        const requestedAmount = amountMatch ? parseFloat(amountMatch[1]) : 0.001;
        const cappedAmount = Math.min(requestedAmount, 0.01); // SECURITY: hard cap
        const ethToBuy = parseEther(cappedAmount.toString());

        try {
          const { hash, amountOut } = await buyDIEMWithETH(runtime, ethToBuy);
          buyResult = `\n\n### DIEM Purchase (Uniswap V3)\n**Swapped:** ${formatUnits(ethToBuy, 18)} ETH → DIEM\n**TX:** [\`${hash}\`](https://basescan.org/tx/${hash})\n**New Balance:** ${amountOut} DIEM\n**Router:** Uniswap V3 SwapRouter02 (\`${UNISWAP_ROUTER}\`)`;
        } catch (swapErr) {
          buyResult = `\n\n### DIEM Purchase Failed\n${swapErr instanceof Error ? swapErr.message : String(swapErr)}`;
        }
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

*1 DIEM staked = $1/day in Venice API credits*${buyResult}`;

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
