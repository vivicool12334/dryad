/**
 * Register Dryad as an ERC-8004 agent on Base mainnet.
 * Run: bun run scripts/register-erc8004.ts
 */
import { createPublicClient, createWalletClient, http, formatEther, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('EVM_PRIVATE_KEY not set');
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: base, transport: http() });
const walletClient = createWalletClient({ account, chain: base, transport: http() });

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function register(string agentURI) returns (uint256)',
  'function register() returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
]);

async function main() {
  console.log(`Registering ERC-8004 agent for: ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${formatEther(balance)} ETH`);

  // Use a short URI — we can update later with setAgentURI
  const agentURI = 'https://dryad.land/agent.json';

  console.log(`Agent URI: ${agentURI}`);

  const hash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [agentURI],
  });

  console.log(`TX: ${hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Confirmed at block: ${receipt.blockNumber}`);
  console.log(`Status: ${receipt.status}`);

  // Check how many agent NFTs we own
  const agentBalance = await publicClient.readContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log(`Agent NFTs owned: ${agentBalance}`);

  // Parse logs to find our agentId
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase()) {
      // The Registered event topic
      console.log(`Log topics: ${log.topics}`);
      if (log.topics[1]) {
        const agentId = BigInt(log.topics[1]);
        console.log(`Agent ID: ${agentId}`);
      }
    }
  }
}

main().catch((err) => {
  console.error('Registration failed:', err.shortMessage || err.message);
  process.exit(1);
});
