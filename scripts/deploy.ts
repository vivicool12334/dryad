/**
 * Deploy DryadMilestones to Base mainnet and register as ERC-8004 agent.
 * Run: bun run scripts/deploy.ts
 */
import { createPublicClient, createWalletClient, http, formatEther, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import * as fs from 'fs';
import * as path from 'path';

const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('EVM_PRIVATE_KEY not set in environment');
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: base, transport: http() });
const walletClient = createWalletClient({ account, chain: base, transport: http() });

// ERC-8004 IdentityRegistry on Base mainnet
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function register(string agentURI) returns (uint256)',
  'function register() returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
]);

async function main() {
  console.log(`Deployer: ${account.address}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error('No ETH balance. Fund the wallet first.');
    process.exit(1);
  }

  // --- Step 1: Deploy DryadMilestones ---
  console.log('\n--- Deploying DryadMilestones ---');

  const bytecode = fs.readFileSync(
    path.join(import.meta.dir, '../src/contracts/build/src_contracts_DryadMilestones_sol_DryadMilestones.bin'),
    'utf-8'
  ).trim();

  const deployHash = await walletClient.deployContract({
    abi: JSON.parse(
      fs.readFileSync(
        path.join(import.meta.dir, '../src/contracts/build/src_contracts_DryadMilestones_sol_DryadMilestones.abi'),
        'utf-8'
      )
    ),
    bytecode: `0x${bytecode}` as `0x${string}`,
  });

  console.log(`Deploy TX: ${deployHash}`);
  console.log('Waiting for confirmation...');

  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const milestonesAddress = deployReceipt.contractAddress;
  console.log(`DryadMilestones deployed at: ${milestonesAddress}`);
  console.log(`Block: ${deployReceipt.blockNumber}`);

  // --- Step 2: Register as ERC-8004 Agent ---
  console.log('\n--- Registering ERC-8004 Agent Identity ---');

  // Build a simple agent registration URI (we'll use a data URI for now)
  const agentRegistration = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Dryad',
    description:
      'Autonomous AI agent managing 9 vacant lots on 25th Street in Detroit, MI for native ecosystem restoration. Monitors biodiversity, coordinates invasive species removal, pays contractors, and records milestones onchain.',
    services: [],
    active: true,
    registrations: [
      {
        agentRegistry: `eip155:8453:${IDENTITY_REGISTRY}`,
        agentId: '', // Will fill after registration
      },
    ],
    supportedTrust: ['reputation'],
  };

  // Use a data URI for now (can be replaced with IPFS later)
  const agentURI = `data:application/json;base64,${Buffer.from(JSON.stringify(agentRegistration)).toString('base64')}`;

  const registerHash = await walletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [agentURI],
  });

  console.log(`Register TX: ${registerHash}`);
  console.log('Waiting for confirmation...');

  const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });
  console.log(`ERC-8004 registration confirmed at block: ${registerReceipt.blockNumber}`);

  // Get agent count to determine our agentId
  const agentBalance = await publicClient.readContract({
    address: IDENTITY_REGISTRY,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log(`Agent NFTs owned: ${agentBalance}`);

  // --- Step 3: Update .env ---
  console.log('\n--- Updating .env ---');

  const envPath = path.join(import.meta.dir, '../.env');
  let envContent = fs.readFileSync(envPath, 'utf-8');

  envContent = envContent.replace(
    /MILESTONES_CONTRACT_ADDRESS=.*/,
    `MILESTONES_CONTRACT_ADDRESS=${milestonesAddress}`
  );
  envContent = envContent.replace(
    /ERC8004_REGISTRY_ADDRESS=.*/,
    `ERC8004_REGISTRY_ADDRESS=${IDENTITY_REGISTRY}`
  );

  fs.writeFileSync(envPath, envContent);

  console.log('\n=== Deployment Summary ===');
  console.log(`Deployer:           ${account.address}`);
  console.log(`DryadMilestones:    ${milestonesAddress}`);
  console.log(`ERC-8004 Registry:  ${IDENTITY_REGISTRY}`);
  console.log(`Agent NFTs owned:   ${agentBalance}`);
  console.log('.env updated with contract addresses.');
}

main().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
