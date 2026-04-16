/**
 * Dryad-Arc Agent - Main Entry Point
 *
 * Starts the ElizaOS agent with the custom dryad-arc plugin, and runs
 * the risk cycle on a configurable timer alongside the ElizaOS runtime.
 */

// Load .env from repo root (works when launched via PM2 or directly)
import { config } from 'dotenv'
import { join } from 'path'
const __dir: string = (import.meta as any).dir ?? (import.meta as any).dirname ?? process.cwd()
config({ path: join(__dir, '../../../.env') })

import express from 'express'
import { ethers } from 'ethers'
import { RiskCycleService } from './services/riskCycle.js'
import { TreasuryManager } from './services/treasuryManager.js'

const CYCLE_INTERVAL_MS = Number(process.env.RISK_CYCLE_INTERVAL_SECONDS ?? 60) * 1000
const PORT = Number(process.env.AGENT_PORT ?? 3010)

const riskCycle = new RiskCycleService()
const treasury = new TreasuryManager()

// ---------------------------------------------------------------------------
// Status API (used by dashboard)
// ---------------------------------------------------------------------------

const statusApp = express()
statusApp.use(express.json())

statusApp.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'dryad-arc-agent', timestamp: new Date().toISOString() })
})

statusApp.get('/api/status', async (_req, res) => {
  const [cycleStatus, treasuryState] = await Promise.all([
    Promise.resolve(riskCycle.getStatus()),
    treasury.getState(),
  ])
  res.json({ ...cycleStatus, treasury: treasuryState })
})

// Manual cycle trigger (useful for demo)
statusApp.post('/api/trigger-cycle', async (_req, res) => {
  console.log('[Agent] Manual cycle triggered')
  const result = await riskCycle.runCycle()
  res.json(result)
})

statusApp.listen(PORT, () => {
  console.log(`[Agent] Status API running on port ${PORT}`)
  console.log(`[Agent] Dashboard data: http://localhost:${PORT}/api/status`)
})

// ---------------------------------------------------------------------------
// Risk cycle timer
// ---------------------------------------------------------------------------

async function startCycleTimer() {
  console.log('[Agent] Starting risk cycle timer...')
  console.log(`[Agent] Cycle interval: ${CYCLE_INTERVAL_MS / 1000}s`)

  // Build provider + signer for on-chain calls
  const arcRpc = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'
  const buyerKey = process.env.AGENT_BUYER_PRIVATE_KEY

  if (buyerKey) {
    try {
      const provider = new ethers.JsonRpcProvider(arcRpc)
      const signer = new ethers.Wallet(buyerKey, provider)
      await treasury.init(signer, provider)
      await riskCycle.init(signer, provider, treasury)
      await treasury.logState()
      console.log('[Agent] GatewayClient + on-chain services + treasury initialized')
    } catch (err) {
      console.error('[Agent] Failed to init on-chain services:', err)
    }
  } else {
    console.warn('[Agent] AGENT_BUYER_PRIVATE_KEY not set - x402 payments will not work')
  }

  // First cycle immediately
  await riskCycle.runCycle()

  // Then on interval
  setInterval(async () => {
    await riskCycle.runCycle()
  }, CYCLE_INTERVAL_MS)
}

startCycleTimer().catch(console.error)
