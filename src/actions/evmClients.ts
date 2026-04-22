import type { IAgentRuntime } from '@elizaos/core';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { CHAIN } from '../config/constants.ts';

export function getRuntimeEvmClients(runtime: IAgentRuntime) {
  const privateKey = runtime.getSetting('EVM_PRIVATE_KEY') || process.env.EVM_PRIVATE_KEY;
  if (!privateKey) throw new Error('EVM_PRIVATE_KEY not configured');

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const chain = CHAIN.USE_TESTNET ? baseSepolia : base;
  const transport = CHAIN.RPC_URL ? http(CHAIN.RPC_URL) : http();

  return {
    account,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ account, chain, transport }),
  };
}
