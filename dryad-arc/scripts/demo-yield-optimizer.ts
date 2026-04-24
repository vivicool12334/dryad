/**
 * demo-yield-optimizer.ts
 *
 * Runs the YieldOptimizer through 8 cycles to generate Arc testnet
 * transactions for the hackathon submission video.
 *
 * Shows:
 *   - USYC vs Aave rate comparison each cycle
 *   - Rebalancing decisions with economic justification
 *   - Real USDC nano-transactions on Arc Block Explorer
 *   - Mainnet break-even comparison (why this only works on Arc)
 *
 * Run: bun run scripts/demo-yield-optimizer.ts
 */

import { config } from 'dotenv'
import { join } from 'path'
config({ path: join(import.meta.dir, '../../../.env') })

import { ethers } from 'ethers'
import { YieldOptimizer } from '../packages/agent/src/services/yieldOptimizer.js'

const ARC_RPC = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'
const BUYER_KEY = process.env.AGENT_BUYER_PRIVATE_KEY

const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`
const amber  = (s: string) => `\x1b[33m${s}\x1b[0m`
const blue   = (s: string) => `\x1b[34m${s}\x1b[0m`
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`

function hr() { console.log(dim('─'.repeat(70))) }

async function main() {
  console.log(bold('\n🌿  Dryad-Arc Yield Optimizer — Demo Run\n'))
  console.log(dim('Arc Testnet · USYC vs Aave V3 · USDC nano-transactions\n'))

  if (!BUYER_KEY) {
    console.error(red('✗ AGENT_BUYER_PRIVATE_KEY not set in .env'))
    console.error(dim('  Fund an address at https://faucet.circle.com then add its key.'))
    process.exit(1)
  }

  const provider = new ethers.JsonRpcProvider(ARC_RPC)
  const signer   = new ethers.Wallet(BUYER_KEY, provider)
  const address  = await signer.getAddress()

  console.log(dim(`Agent wallet:  ${address}`))
  console.log(dim(`Arc RPC:       ${ARC_RPC}`))
  console.log(dim(`Explorer:      https://testnet.arcscan.app/address/${address}`))
  hr()

  // ── Mainnet break-even analysis ──────────────────────────────────────────
  console.log(bold('\nWhy nano-transactions change everything:\n'))

  const scenarios = [
    { amount: 5000,  differential: 0.012, mainnetGas: 20,  arcGas: 0.0001 },
    { amount: 1000,  differential: 0.005, mainnetGas: 12,  arcGas: 0.0001 },
    { amount: 23625, differential: 0.018, mainnetGas: 40,  arcGas: 0.0001 },
  ]

  console.log(dim(`${'Amount'.padEnd(10)} ${'Diff'.padEnd(8)} ${'ETH Gas'.padEnd(12)} ${'Arc Gas'.padEnd(12)} ${'ETH Break-even'.padEnd(18)} ${'Arc Break-even'}`))
  console.log(dim('─'.repeat(80)))

  for (const s of scenarios) {
    const mainnet = YieldOptimizer.mainnetBreakEven(s.amount, s.differential, s.mainnetGas)
    const arc     = YieldOptimizer.mainnetBreakEven(s.amount, s.differential, s.arcGas)

    const ethDays = mainnet.breakEvenDays.toFixed(0).padEnd(18)
    const arcDays = arc.breakEvenDays < 0.01
      ? green('< 1 hour')
      : green(`${(arc.breakEvenDays * 24).toFixed(1)}h`)

    console.log(
      `$${s.amount.toString().padEnd(9)} ` +
      `${(s.differential * 100).toFixed(1)}%`.padEnd(8) +
      `$${s.mainnetGas}`.padEnd(12) +
      `$${s.arcGas}`.padEnd(12) +
      red(`${ethDays}days`).padEnd(22) +
      arcDays
    )
  }

  console.log(dim('\n  On Ethereum, a 1.2% rate differential on $5K takes 242 days to break even.'))
  console.log(dim('  On Arc, the agent rebalances immediately — and does it every cycle.\n'))
  hr()

  // ── Initialize optimizer ─────────────────────────────────────────────────
  const optimizer = new YieldOptimizer()
  await optimizer.init(signer, provider)

  // ── Run 8 cycles ─────────────────────────────────────────────────────────
  console.log(bold('\nRunning 8 optimization cycles...\n'))

  const txHashes: string[] = []
  let totalRebalanced = 0

  for (let i = 1; i <= 8; i++) {
    console.log(amber(`\nCycle ${i}/8`))
    hr()

    const decision = await optimizer.optimize()

    if (decision.shouldRebalance && decision.txHash) {
      txHashes.push(decision.txHash)
      totalRebalanced += decision.amountUsdc
      console.log(green(`  ✓ Rebalanced $${decision.amountUsdc.toFixed(2)} USDC`))
      console.log(green(`  ✓ Annual gain: $${decision.annualGainUsdc.toFixed(4)}`))
      console.log(blue(`  → https://testnet.arcscan.app/tx/${decision.txHash}`))
    } else {
      console.log(dim(`  · No action: ${decision.reason}`))
    }

    // Small delay between cycles
    if (i < 8) await new Promise(r => setTimeout(r, 3000))
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  hr()
  console.log(bold('\n📊  Session Summary\n'))
  const status = optimizer.getStatus()
  console.log(`  Cycles run:         ${status.cycleCount}`)
  console.log(`  Rebalances:         ${status.totalRebalances}`)
  console.log(`  Total rebalanced:   $${totalRebalanced.toFixed(2)} USDC`)
  console.log(`  Yield captured:     $${(status.totalYieldGained * 365).toFixed(4)}/yr incremental`)

  if (txHashes.length > 0) {
    console.log(bold('\n🔗  Transactions on Arc Block Explorer:\n'))
    txHashes.forEach((hash, i) => {
      console.log(blue(`  ${i + 1}. https://testnet.arcscan.app/tx/${hash}`))
    })
    console.log(bold('\n💰  Circle Developer Console:\n'))
    console.log(dim(`  https://console.circle.com — check USDC transfers for ${address}`))
  }

  console.log(dim('\n  Submission: https://lablab.ai/ai-hackathons/nano-payments-arc/dryad/submission\n'))
}

main().catch(err => {
  console.error(red(`\nFatal: ${err.message}`))
  process.exit(1)
})
