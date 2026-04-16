/**
 * RiskCycleService - The core Dryad-Arc operating loop
 *
 * Runs every RISK_CYCLE_INTERVAL_SECONDS (default 60s).
 * Observe -> Assess -> Dispatch -> Verify -> Pay+Record
 *
 * Payment flows:
 * - Loop A: GatewayClient.pay() to ecology-api ($0.001/call)
 * - Loop B: GatewayClient.pay() to verification-api ($0.001/call)
 *           + ERC-8183 job protocol (on-chain, $0.10/event)
 *           + ERC-8004 reputation event after completion
 *
 * Buyer: GatewayClient from @circle-fin/x402-batching/client
 * Source: https://developers.circle.com/gateway/nanopayments/quickstarts/seller
 */

import { ethers } from 'ethers'
import { GatewayClient } from '@circle-fin/x402-batching/client'
import { JobProtocolService } from './jobProtocol.js'
import { ReputationRecorderService } from './reputationRecorder.js'
import { AgentIdentityService } from './agentIdentity.js'
import { TreasuryManager, type SpendingMode } from './treasuryManager.js'

// Agent acts as client, provider, AND evaluator for the demo.
// This lets the same wallet drive the full ERC-8183 state machine end-to-end.
// In production each role would be a separate registered agent.

// Simulated sensor coordinates for the demo (Yosemite Valley area)
const MONITORED_COORDINATES = [
  { lat: 37.7459, lng: -119.5332 },
  { lat: 37.8651, lng: -119.5383 },
  { lat: 37.7297, lng: -119.6327 },
]

export interface CycleResult {
  timestamp: string
  coordinates: { lat: number; lng: number }
  ecologyScore: number
  ecologyCost: number
  verificationScore?: number
  verificationCost?: number
  verifierAgreed?: boolean
  jobId?: string
  jobOutcome?: 'completed' | 'rejected' | 'expired'
  jobCost?: number
  reputationUpdated?: boolean
  totalCost: number
  spendingMode?: SpendingMode
  treasuryRebalance?: string
  error?: string
}

export class RiskCycleService {
  private jobProtocol: JobProtocolService | null = null
  private reputation: ReputationRecorderService | null = null
  private agentIdentity: AgentIdentityService | null = null
  private gatewayClient: GatewayClient | null = null
  private treasury: TreasuryManager | null = null
  private cycleCount = 0
  private results: CycleResult[] = []

  // Cached service URLs (populated from ERC-8004 discovery or env fallback)
  private ecologyApiUrl: string = process.env.ECOLOGY_API_URL ?? 'http://localhost:3001'
  private verificationApiUrl: string = process.env.VERIFICATION_API_URL ?? 'http://localhost:3002'

  private threshold = Number(process.env.RISK_ALERT_THRESHOLD ?? 40)

  private agentAddress: string = ''

  async init(signer: ethers.Signer, provider: ethers.Provider, treasuryManager?: TreasuryManager) {
    try {
      this.agentAddress = await signer.getAddress()
      this.jobProtocol = new JobProtocolService(signer)
      this.reputation = new ReputationRecorderService(signer)
      this.agentIdentity = new AgentIdentityService(provider, signer)
      if (treasuryManager) this.treasury = treasuryManager

      // GatewayClient for x402 micropayments (Loop A + B)
      const buyerPrivateKey = process.env.AGENT_BUYER_PRIVATE_KEY
      if (buyerPrivateKey) {
        this.gatewayClient = new GatewayClient({
          chain: 'arcTestnet',
          privateKey: buyerPrivateKey as `0x${string}`,
        })
        console.log('[RiskCycle] GatewayClient initialized for x402 payments')
      } else {
        console.warn('[RiskCycle] AGENT_BUYER_PRIVATE_KEY not set - x402 payments will fail')
      }

      // Attempt ERC-8004 service discovery (falls back to env vars on failure)
      const discoveredEcology = await this.agentIdentity.discoverService('risk-assessment')
      const discoveredVerification = await this.agentIdentity.discoverService('risk-verification')

      if (discoveredEcology) this.ecologyApiUrl = discoveredEcology
      if (discoveredVerification) this.verificationApiUrl = discoveredVerification

      console.log(`[RiskCycle] Ecology API: ${this.ecologyApiUrl}`)
      console.log(`[RiskCycle] Verification API: ${this.verificationApiUrl}`)
    } catch (err) {
      console.error('[RiskCycle] Init error:', err)
    }
  }

  async runCycle(): Promise<CycleResult> {
    this.cycleCount++
    const coords = MONITORED_COORDINATES[this.cycleCount % MONITORED_COORDINATES.length]
    const timestamp = new Date().toISOString()

    console.log(`\n[RiskCycle] Cycle ${this.cycleCount} - (${coords.lat}, ${coords.lng})`)

    const result: CycleResult = {
      timestamp,
      coordinates: coords,
      ecologyScore: 0,
      ecologyCost: 0,
      totalCost: 0,
    }

    try {
      // ----------------------------------------------------------------
      // STEP 0: Treasury rebalance - redeem USYC yield if float is low
      // T-bill yield in USYC funds all downstream operations
      // ----------------------------------------------------------------
      if (this.treasury) {
        const rebalance = await this.treasury.rebalance()
        if (rebalance.action !== 'none') {
          result.treasuryRebalance = `${rebalance.action} $${rebalance.amountUsdc} USDC (${rebalance.reason})`
          console.log(`[RiskCycle] Treasury rebalance: ${result.treasuryRebalance}`)
        }
        const treasuryState = await this.treasury.getState()
        result.spendingMode = treasuryState.spendingMode
        if (treasuryState.spendingMode === 'CRITICAL') {
          console.warn('[RiskCycle] CRITICAL treasury mode - suspending all non-essential spending')
          this.results.push(result)
          return result
        }
      }

      // ----------------------------------------------------------------
      // STEP 1: Buy risk score from ecology-api via x402 GatewayClient (Loop A)
      // GatewayClient automatically handles the EIP-3009 auth + Circle settlement
      // ----------------------------------------------------------------
      console.log('[RiskCycle] Fetching risk score via x402 GatewayClient (Loop A)...')

      if (!this.gatewayClient) throw new Error('GatewayClient not initialized - set AGENT_BUYER_PRIVATE_KEY')

      const ecologyUrl = `${this.ecologyApiUrl}/api/ecology/risk-score?lat=${coords.lat}&lng=${coords.lng}`
      let ecologyResponse: Awaited<ReturnType<GatewayClient['pay']>>
      try {
        ecologyResponse = await this.gatewayClient.pay(ecologyUrl)
      } catch (payErr: any) {
        // Surface the full error message including Circle's settlement reason
        console.error('[RiskCycle] x402 pay() threw:', payErr?.message ?? payErr)
        throw payErr
      }
      const { data: ecologyData, status: ecologyStatus } = ecologyResponse

      if (ecologyStatus !== 200) throw new Error(`Ecology API x402 error: ${ecologyStatus}`)

      const ecologyJson = ecologyData as {
        score: number
        level: string
        factors: string[]
        sensors: object
      }

      result.ecologyScore = ecologyJson.score
      result.ecologyCost = 0.001
      result.totalCost += 0.001

      console.log(`[RiskCycle] Risk score: ${ecologyJson.score} (${ecologyJson.level})`)

      // ----------------------------------------------------------------
      // STEP 2: If score >= threshold, get verification via x402 (Loop B)
      // ----------------------------------------------------------------
      if (ecologyJson.score < this.threshold) {
        console.log(`[RiskCycle] Score ${ecologyJson.score} < threshold ${this.threshold} - no action`)
        this.results.push(result)
        return result
      }

      console.log(`[RiskCycle] Score ${ecologyJson.score} >= threshold - requesting verification via x402 (Loop B)...`)

      const { data: verifyData, status: verifyStatus } = await this.gatewayClient.pay(
        `${this.verificationApiUrl}/api/verify/risk`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ecologyJson),
        }
      )

      if (verifyStatus !== 200) throw new Error(`Verification API x402 error: ${verifyStatus}`)

      const verifyJson = verifyData as {
        score: number
        confidence: number
        agree: boolean
        level: string
        reasoning: string
      }

      result.verificationScore = verifyJson.score
      result.verificationCost = 0.001
      result.verifierAgreed = verifyJson.agree
      result.totalCost += 0.001

      console.log(`[RiskCycle] Verification: score=${verifyJson.score}, agree=${verifyJson.agree}`)

      if (!verifyJson.agree) {
        console.log('[RiskCycle] Models diverge - no job opened')
        this.results.push(result)
        return result
      }

      // ----------------------------------------------------------------
      // STEP 3: Open ERC-8183 job (on-chain) - gated by spending mode
      // CONSERVATION mode: skip jobs to preserve treasury
      // NORMAL mode: proceed with full escrow cycle
      // ----------------------------------------------------------------
      if (result.spendingMode === 'CONSERVATION') {
        console.warn('[RiskCycle] CONSERVATION mode - skipping ERC-8183 job to preserve treasury')
        this.results.push(result)
        return result
      }

      if (!this.jobProtocol) {
        console.warn('[RiskCycle] JobProtocol not initialized - skipping on-chain job')
        this.results.push(result)
        return result
      }

      console.log('[RiskCycle] Opening ERC-8183 job...')

      // Agent acts as client + provider + evaluator for the demo.
      // All 6 ERC-8183 state transitions (create, setBudget, fund, submit, complete)
      // are driven by the same wallet so no external parties are needed.
      const agentAddr = this.agentAddress || process.env.AGENT_BUYER_ADDRESS!
      const { jobId, deliverableHash } = await this.jobProtocol.openJob({
        providerAddress: agentAddr,
        evaluatorAddress: agentAddr,
        amountUsdc: '0.10',
        ttlSeconds: 600,
        metadata: {
          eventType: 'WILDFIRE_RISK_HIGH',
          coordinates: coords,
          ecologyScore: ecologyJson.score,
          verificationScore: verifyJson.score,
          timestamp,
        },
      })

      result.jobId = jobId.toString()
      result.jobCost = 0.10
      result.jobOutcome = 'completed'   // openJob() runs through complete()
      result.totalCost += 0.10

      console.log(`[RiskCycle] Job ${jobId} completed on-chain - full escrow cycle done`)

      // ----------------------------------------------------------------
      // STEP 4: Record ERC-8004 reputation event
      // ----------------------------------------------------------------
      if (this.reputation && process.env.VERIFIER_TOKEN_ID) {
        try {
          await this.reputation.recordPositiveFeedback({
            verifierTokenId: process.env.VERIFIER_TOKEN_ID,
            jobId: jobId.toString(),
            score: verifyJson.score,
          })
          result.reputationUpdated = true
          console.log('[RiskCycle] ERC-8004 reputation updated')
        } catch (err) {
          console.error('[RiskCycle] Reputation update failed (non-fatal):', err)
        }
      }

    } catch (err: any) {
      result.error = err.message
      console.error('[RiskCycle] Cycle error:', err.message)
    }

    this.results.push(result)
    if (this.results.length > 100) this.results.shift()  // keep last 100

    return result
  }

  getStatus() {
    return {
      cycleCount: this.cycleCount,
      ecologyApiUrl: this.ecologyApiUrl,
      verificationApiUrl: this.verificationApiUrl,
      threshold: this.threshold,
      recentCycles: this.results.slice(-10),
    }
  }
}
