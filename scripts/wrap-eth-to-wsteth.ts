/**
 * Swap ETH → wstETH on Base via Uniswap V3.
 * Keeps 0.002 ETH for gas, swaps the rest.
 * Run: bun run scripts/wrap-eth-to-wsteth.ts
 */
import { createPublicClient, createWalletClient, http, formatEther, parseEther, parseAbi, encodeFunctionData } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('EVM_PRIVATE_KEY not set');
  process.exit(1);
}

const WETH = '0x4200000000000000000000000000000000000006' as const;
const WSTETH = '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452' as const;
const UNISWAP_ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481' as const;
const GAS_RESERVE = parseEther('0.002');

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const publicClient = createPublicClient({ chain: base, transport: http() });
const walletClient = createWalletClient({ account, chain: base, transport: http() });

const SWAP_ROUTER_ABI = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
]);

async function main() {
  console.log(`Wallet: ${account.address}`);

  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log(`ETH balance: ${formatEther(ethBalance)} ETH`);

  if (ethBalance <= GAS_RESERVE) {
    console.error(`Not enough ETH. Have ${formatEther(ethBalance)}, need > ${formatEther(GAS_RESERVE)} (gas reserve)`);
    process.exit(1);
  }

  const swapAmount = ethBalance - GAS_RESERVE;
  console.log(`Swapping: ${formatEther(swapAmount)} ETH → wstETH`);
  console.log(`Keeping: ${formatEther(GAS_RESERVE)} ETH for gas`);

  // Check current wstETH balance
  const wstethBefore = await publicClient.readContract({
    address: WSTETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint;
  console.log(`wstETH before: ${formatEther(wstethBefore)}`);

  // Swap via Uniswap V3 exactInputSingle
  // ETH → WETH → wstETH (fee tier: 100 = 0.01% for correlated assets)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600); // 10 min

  const hash = await walletClient.writeContract({
    address: UNISWAP_ROUTER,
    abi: SWAP_ROUTER_ABI,
    functionName: 'exactInputSingle',
    args: [{
      tokenIn: WETH,
      tokenOut: WSTETH,
      fee: 100, // 0.01% fee tier
      recipient: account.address,
      amountIn: swapAmount,
      amountOutMinimum: 0n, // Accept any amount (small swap, low slippage)
      sqrtPriceLimitX96: 0n,
    }],
    value: swapAmount,
  });

  console.log(`Swap TX: ${hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`Status: ${receipt.status}`);
  console.log(`Block: ${receipt.blockNumber}`);

  // Check new balances
  const ethAfter = await publicClient.getBalance({ address: account.address });
  const wstethAfter = await publicClient.readContract({
    address: WSTETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  }) as bigint;

  console.log(`\n=== Result ===`);
  console.log(`ETH: ${formatEther(ethBalance)} → ${formatEther(ethAfter)}`);
  console.log(`wstETH: ${formatEther(wstethBefore)} → ${formatEther(wstethAfter)}`);
  console.log(`wstETH gained: ${formatEther(wstethAfter - wstethBefore)}`);
}

main().catch((err) => {
  console.error('Swap failed:', err.shortMessage || err.message);
  process.exit(1);
});
