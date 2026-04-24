/**
 * demo-yield-optimizer.ts
 *
 * Demonstrates agentic USDC yield routing on Arc Network.
 * Compares USYC (T-bill, stable ~4%) against Aave V3 (variable, live rate).
 * When Aave is higher by > 0.5%, executes a real USDC rebalancing transaction.
 *
 * Usage:
 *   bun run scripts/demo-yield-optimizer.ts            # use live Aave rate
 *   bun run scripts/demo-yield-optimizer.ts --simulate # force a rate divergence for demo
 *
 * The --simulate flag sets Aave to 5.8% (realistic peak for USDC utilization
 * during high-borrow periods). This produces real transactions on Arc testnet
 * while clearly labelling the rate as simulated for the video.
 */

import { config } from 'dotenv'
import { join } from 'path'
config({ path: join(import.meta.dir, '../../../.env') })

import { ethers } from 'ethers'
import { YieldOptimizer } from '../packages/agent/src/services/yieldOptimizer.js'

const ARC_RPC   = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'
const BUYER_KEY = process.env.AGENT_BUYER_PRIVATE_KEY
const SIMULATE  = process.argv.includes('--simulate')
// Realistic Aave USDC peak rate during high-utilization periods
const SIMULATED_AAVE_APY = 0.058

const dim   = (s: string) => `\x1b[2m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const amber = (s: string) => `\x1b[33m${s}\x1b[0m`
const blue  = (s: string) => `\x1b[34m${s}\x1b[0m`
const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`
const red   = (s: string) => `\x1b[31m${s}\x1b[0m`

function hr() { console.log(dim('─'.repeat(70))) }

async function main() {
  console.log(bold('\n🌿  Dryad-Arc Yield Optimizer — Demo Run\n'))

  if (SIMULATE) {
    console.log(amber(`  [SIMULATE MODE] Aave rate set to ${(SIMULATED_AAVE_APY * 100).toFixed(1)}% `) +
      dim('(realistic peak during high USDC utilization)\n'))
  } else {
    console.log(dim('  Fetching live Aave V3 USDC rate from Aave API...\n'))
  }

  if (!BUYER_KEY) {
    console.error(red('✗ AGENT_BUYER_PRIVATE_KEY not set in .env'))
    console.error(dim('  Fund an address at https://faucet.circle.com then add its key.'))
    process.exit(1)
  }

  const provider = new ethers.JsonRpcProvider(ARC_RPC)
  const signer   = new ethers.Wallet(BUYER_KEY, provider)
  const address  = await signer.getAddress()

  console.log(dim(`  Agent wallet:  ${address}`))
  console.log(dim(`  Arc RPC:       ${ARC_RPC}`))
  console.log(dim(`  Explorer:      https://testnet.arcscan.app/address/${address}\n`))
  hr()

  // ── Why nano-transactions matter ─────────────────────────────────────────
  console.log(bold('\nMainnet vs Arc — break-even analysis:\n'))
  console.log(dim(`${'Amount'.padEnd(10)} ${'Diff'.padEnd(8)} ${'ETH gas'.padEnd(12)} ${'Arc gas'.padEnd(12)} ${'ETH break-even'.padEnd(20)} Arc break-even`))
  console.log(dim('─'.repeat(80)))

  const scenarios = [
    { amount: 5000,  diff: 0.012, ethGas: 20,  arcGas: 0.0001 },
    { amount: 1000,  diff: 0.005, ethGas: 12,  arcGas: 0.0001 },
    { amount: 23625, diff: 0.018, ethGas: 40,  arcGas: 0.0001 },
  ]

  for (const s of scenarios) {
    const ethDays = (s.ethGas / ((s.amount * s.diff) / 365)).toFixed(0)
    const arcHrs  = (s.arcGas / ((s.amount * s.diff) / 365) * 24).toFixed(2)
    console.log(
      `$${s.amount.toString().padEnd(9)} ` +
      `${(s.diff * 100).toFixed(1)}%`.padEnd(8) +
      `$${s.ethGas}`.padEnd(12) +
      `$${s.arcGas}`.padEnd(12) +
      red(`${ethDays} days`.padEnd(20)) +
      green(`${arcHrs} hours`)
    )
  }

  console.log(dim('\n  On Ethereum, a 1.2% rate differential on $5K takes 122 days to recover gas.'))
  console.log(dim('  On Arc, the same rebalance costs fractions of a cent. Break-even: hours.\n'))
  hr()

  // ── Initialize ───────────────────────────────────────────────────────────
  const optimizer = new YieldOptimizer()
  await optimizer.init(signer, provider)

  // ── Run cycles ───────────────────────────────────────────────────────────
  const CYCLES = SIMULATE ? 4 : 8
  console.log(bold(`\nRunning ${CYCLES} optimization cycles...\n`))

  const txHashes: string[] = []
  let totalRebalanced = 0

  for (let i = 1; i <= CYCLES; i++) {
    console.log(amber(`\nCycle ${i}/${CYCLES}`))
    hr()

    const decision = await optimizer.optimize(
      SIMULATE ? { simulateAaveApy: SIMULATED_AAVE_APY } : undefined
    )

    if (decision.shouldRebalance) {
      if (decision.txHash) {
        txHashes.push(decision.txHash)
        totalRebalanced += decision.amountUsdc
        console.log(green(`  ✓ Rebalanced $${decision.amountUsdc.toFixed(2)} USDC`))
        console.log(green(`  ✓ Rate gain: +${(decision.apyGain * 100).toFixed(2)}% APY`))
        console.log(green(`  ✓ Annual benefit: $${decision.annualGainUsdc.toFixed(4)}`))
        console.log(blue(`  → https://testnet.arcscan.app/tx/${decision.txHash}`))
      } else {
        console.log(amber(`  ~ Would rebalance $${decision.amountUsdc.toFixed(2)} USDC (insufficient balance on testnet)`))
        console.log(dim(`    ${decision.reason}`))
      }
    } else {
      console.log(dim(`  · No action: ${decision.reason}`))
    }

    if (i < CYCLES) await new Promise(r => setTimeout(r, 2000))
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  hr()
  const status = optimizer.getStatus()
  console.log(bold('\n📊  Session Summary\n'))
  console.log(`  Cycles run:        ${status.cycleCount}`)
  console.log(`  Rebalances:        ${status.totalRebalances}`)
  console.log(`  Total rebalanced:  $${totalRebalanced.toFixed(2)} USDC`)
  console.log(`  Incremental yield: $${(status.totalYieldGained * 365).toFixed(6)}/yr`)

  if (SIMULATE) {
    console.log(amber('\n  [SIMULATE] Rate divergence was scripted for demo.'))
    console.log(dim('  Real rates checked from Aave API in live mode.'))
    console.log(dim('  Transactions above are real Arc testnet transactions.'))
  }

  if (txHashes.length > 0) {
    console.log(bold('\n🔗  Transactions on Arc Block Explorer:\n'))
    txHashes.forEach((h, i) => console.log(blue(`  ${i + 1}. https://testnet.arcscan.app/tx/${h}`)))
    console.log()
  } else {
    console.log(dim('\n  No transactions — fund the wallet at https://faucet.circle.com\n'))
    console.log(dim('  USDC address on Arc testnet: 0x3600000000000000000000000000000000000000'))
  }
}

main().catch(err => {
  console.error(red(`\n✗ ${err.message}`))
  process.exit(1)
})
