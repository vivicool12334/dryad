import type { Action, ActionResult, Content, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { createPublicClient, createWalletClient, http, parseAbi, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const USDC_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
]);

// Spending limits
const MAX_PER_TX_USD = 50;
const MAX_DAILY_USD = 200;

// Simple in-memory daily spend tracker (resets on restart)
let dailySpend = 0;
let lastResetDate = new Date().toDateString();

function resetDailySpendIfNeeded() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailySpend = 0;
    lastResetDate = today;
  }
}

function getClients(runtime: IAgentRuntime) {
  const privateKey = runtime.getSetting('EVM_PRIVATE_KEY') || process.env.EVM_PRIVATE_KEY;
  if (!privateKey) throw new Error('EVM_PRIVATE_KEY not configured');

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain: base, transport: http() });
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  return { account, publicClient, walletClient };
}

function parsePaymentFromMessage(text: string): { address: string | null; amount: number | null; reason: string } {
  // Extract Ethereum address
  const addressMatch = text.match(/0x[a-fA-F0-9]{40}/);
  const address = addressMatch ? addressMatch[0] : null;

  // Extract dollar amount
  const amountMatch = text.match(/\$?(\d+(?:\.\d{1,2})?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : null;

  return { address, amount, reason: text };
}

export const payContractorAction: Action = {
  name: 'PAY_CONTRACTOR',
  similes: ['SEND_PAYMENT', 'PAY_WORKER', 'USDC_TRANSFER', 'CONTRACTOR_PAYMENT'],
  description:
    'Send USDC payment to a contractor on Base L2. Enforces spending limits: $50 per transaction, $200 per day. For work like invasive removal, soil prep, native planting.',

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
      logger.info('Processing contractor payment');
      resetDailySpendIfNeeded();

      const { address, amount, reason } = parsePaymentFromMessage(message.content.text || '');

      if (!address) {
        const errorMsg = 'Please provide the contractor\'s Ethereum address (0x...).';
        await callback({ text: errorMsg, actions: ['PAY_CONTRACTOR'], source: message.content.source });
        return { text: errorMsg, values: { success: false }, data: {}, success: false };
      }

      if (!amount || amount <= 0) {
        const errorMsg = 'Please provide a valid payment amount (e.g., $25 or 25).';
        await callback({ text: errorMsg, actions: ['PAY_CONTRACTOR'], source: message.content.source });
        return { text: errorMsg, values: { success: false }, data: {}, success: false };
      }

      // Check per-transaction limit
      if (amount > MAX_PER_TX_USD) {
        const errorMsg = `Payment of $${amount} exceeds per-transaction limit of $${MAX_PER_TX_USD}. Break into smaller payments.`;
        await callback({ text: errorMsg, actions: ['PAY_CONTRACTOR'], source: message.content.source });
        return { text: errorMsg, values: { success: false }, data: {}, success: false };
      }

      // Check daily limit
      if (dailySpend + amount > MAX_DAILY_USD) {
        const remaining = MAX_DAILY_USD - dailySpend;
        const errorMsg = `Payment of $${amount} would exceed daily limit of $${MAX_DAILY_USD}. Already spent today: $${dailySpend}. Remaining: $${remaining}.`;
        await callback({ text: errorMsg, actions: ['PAY_CONTRACTOR'], source: message.content.source });
        return { text: errorMsg, values: { success: false }, data: {}, success: false };
      }

      const { account, publicClient, walletClient } = getClients(runtime);
      const usdcAddress = (process.env.USDC_BASE_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913') as `0x${string}`;

      // Check USDC balance
      const balance = await publicClient.readContract({
        address: usdcAddress,
        abi: USDC_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      }) as bigint;

      const usdcDecimals = 6;
      const formattedBalance = formatUnits(balance, usdcDecimals);
      const balanceNum = parseFloat(formattedBalance);

      if (balanceNum < amount) {
        const errorMsg = `Insufficient USDC balance. Have: $${formattedBalance}, Need: $${amount}.`;
        await callback({ text: errorMsg, actions: ['PAY_CONTRACTOR'], source: message.content.source });
        return { text: errorMsg, values: { success: false }, data: {}, success: false };
      }

      // Send USDC
      const amountWei = parseUnits(amount.toString(), usdcDecimals);
      const hash = await walletClient.writeContract({
        address: usdcAddress,
        abi: USDC_ABI,
        functionName: 'transfer',
        args: [address as `0x${string}`, amountWei],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      // Update daily spend tracker
      dailySpend += amount;

      const responseText = `## Contractor Payment Sent

**To:** \`${address}\`
**Amount:** $${amount.toFixed(2)} USDC
**Transaction:** \`${hash}\`
**Block:** ${receipt.blockNumber}
**Status:** ${receipt.status === 'success' ? '✅ Confirmed' : '❌ Failed'}

### Spending Limits
- **Today's spend:** $${dailySpend.toFixed(2)} / $${MAX_DAILY_USD}
- **Remaining daily budget:** $${(MAX_DAILY_USD - dailySpend).toFixed(2)}
- **USDC balance after:** $${(balanceNum - amount).toFixed(2)}

**Reason:** ${reason}`;

      await callback({
        text: responseText,
        actions: ['PAY_CONTRACTOR'],
        source: message.content.source,
      });

      return {
        text: `Payment of $${amount} USDC sent to ${address}. TX: ${hash}`,
        values: { success: true, amount, recipient: address, txHash: hash, dailySpend },
        data: { receipt },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in PAY_CONTRACTOR action');
      const errorMsg = `Failed to send payment: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: errorMsg, actions: ['PAY_CONTRACTOR'], source: message.content.source });
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
      { name: '{{name1}}', content: { text: 'Pay $45 to 0x1234567890abcdef1234567890abcdef12345678 for invasive removal' } },
      {
        name: 'Dryad',
        content: { text: 'Processing $45 USDC payment to contractor for invasive removal...', actions: ['PAY_CONTRACTOR'] },
      },
    ],
    [
      { name: '{{name1}}', content: { text: 'Send contractor payment' } },
      {
        name: 'Dryad',
        content: {
          text: 'I can process that. Please provide the contractor address and amount (max $50/tx, $200/day).',
          actions: ['PAY_CONTRACTOR'],
        },
      },
    ],
  ],
};
