/**
 * TreasuryManager - Dryad-Arc Treasury Yield Service
 *
 * Manages the agent's USDC treasury on Arc Network by parking idle capital
 * in USYC (US Yield Coin by Hashnote) - a T-bill-backed yield token.
 *
 * USYC on Arc Testnet: 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C
 * ERC-4626 vault: deposit USDC -> earn ~4% APY -> redeem USDC when needed
 *
 * The yield loop:
 *   $23,600 USDC deposited into USYC at launch
 *   → ~$944/yr yield at 4% APY (covers full Year 3+ maintenance budget)
 *   → Agent redeems USYC when operational float < MIN_FLOAT_USDC
 *   → Surplus USDC after each cycle is re-deposited
 *
 * Spending modes (based on treasury health):
 *   NORMAL      - full operations, jobs + x402 payments
 *   CONSERVATION - essential only, no ERC-8183 jobs
 *   CRITICAL    - suspend all non-tax spending, alert governance
 *
 * Arc DeFi context:
 *   - USYC: ~4% APY via Hashnote Short Duration Fund (T-bills)
 *   - Aave V3 on Arc: ~3-6% APY (lending to borrowers)
 *   - Morpho on Arc: ~4-7% APY (optimized lending)
 *   - Superform: yield aggregator routing to best rate
 *
 * For this demo, USYC is the primary yield source (simplest interface,
 * directly Circle-integrated, most Arc-native).
 *
 * Sources:
 *   https://www.arc.network/blog/circle-launches-arc-public-testnet
 *   https://www.xylonet.xyz/docs/network (USYC address)
 *   https://coininterestrate.com/guides/circle-launched-usyc-regulated-yield-money-markets-on-chain
 */

import { ethers } from 'ethers'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ERC20_ABI = require('../abis/erc20.json')

// USYC (ERC-4626 vault): US Yield Coin by Hashnote
// Backed by short-duration US Treasuries, ~4% APY
// Circle is integrating USYC as the native yield layer on Arc
const USYC_ADDRESS = process.env.USYC_ADDRESS ?? '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C'
const USDC_ADDRESS = process.env.USDC_ADDRESS ?? '0x3600000000000000000000000000000000000000'

// ERC-4626 vault ABI (USYC implements this interface)
const ERC4626_ABI = [
  // ERC-20 base
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  // ERC-4626 vault
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function convertToShares(uint256 assets) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256 shares)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
  // Events
  'event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares)',
  'event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
]

export type SpendingMode = 'NORMAL' | 'CONSERVATION' | 'CRITICAL'

export interface TreasuryState {
  usdcBalance: string          // USDC in operational wallet (18 dec)
  usycShares: string           // USYC vault shares held
  usycValueUsdc: string        // USYC shares converted to USDC value
  totalValueUsdc: string       // usdcBalance + usycValueUsdc
  yieldEarnedUsdc: string      // estimated yield earned since deployment
  spendingMode: SpendingMode
  annualYieldUsdc: string      // projected annual yield at current balance
  apy: number                  // current APY estimate (4% USYC baseline)
  lastRebalance: string | null // ISO timestamp of last deposit/redeem
}

export interface RebalanceResult {
  action: 'deposit' | 'redeem' | 'none'
  amountUsdc: string
  txHash?: string
  reason: string
}

export class TreasuryManager {
  private signer: ethers.Signer | null = null
  private provider: ethers.Provider | null = null
  private usycVault: ethers.Contract | null = null
  private usdcToken: ethers.Contract | null = null
  private agentAddress: string = ''
  private deploymentTime: number = Date.now()
  private initialUsycShares: bigint = 0n
  private lastRebalanceTime: string | null = null

  // Configuration
  private readonly USYC_APY = 0.04             // 4% baseline T-bill yield
  private readonly MIN_FLOAT_USDC = '5.0'      // keep at least 5 USDC liquid for ops
  private readonly NORMAL_FLOAT_USDC = '20.0'  // rebalance back to 20 USDC float
  private readonly CRITICAL_THRESHOLD = '2.0'  // below this -> CRITICAL mode

  async init(signer: ethers.Signer, provider: ethers.Provider) {
    this.signer = signer
    this.provider = provider
    this.agentAddress = await signer.getAddress()

    this.usycVault = new ethers.Contract(USYC_ADDRESS, ERC4626_ABI, signer)
    this.usdcToken = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer)

    // Record initial share balance to track yield accumulation
    try {
      this.initialUsycShares = await this.usycVault.balanceOf(this.agentAddress)
    } catch (err) {
      console.warn('[Treasury] Could not read initial USYC balance (vault may not exist on testnet)')
      this.initialUsycShares = 0n
    }

    console.log(`[Treasury] Initialized. Agent: ${this.agentAddress}`)
    console.log(`[Treasury] USYC vault: ${USYC_ADDRESS} (~${this.USYC_APY * 100}% APY)`)
    console.log(`[Treasury] USDC token: ${USDC_ADDRESS}`)
  }

  /**
   * Get current treasury state including USYC yield position.
   */
  async getState(): Promise<TreasuryState> {
    if (!this.usycVault || !this.usdcToken || !this.agentAddress) {
      return this._mockState()
    }

    try {
      const [usdcRaw, usycShares] = await Promise.all([
        this.usdcToken.balanceOf(this.agentAddress),
        this.usycVault.balanceOf(this.agentAddress),
      ])

      // Convert USYC shares to USDC value via vault exchange rate
      let usycValueRaw = 0n
      try {
        usycValueRaw = await this.usycVault.convertToAssets(usycShares)
      } catch {
        // If convertToAssets fails, estimate using APY
        const elapsed = (Date.now() - this.deploymentTime) / 1000 / 86400 / 365 // years
        const growthFactor = 1 + this.USYC_APY * elapsed
        usycValueRaw = (usycShares * BigInt(Math.floor(growthFactor * 1e6))) / 1000000n
      }

      const usdcBalance = ethers.formatUnits(usdcRaw, 6)
      const usycValue = ethers.formatUnits(usycValueRaw, 6)
      const totalValue = (parseFloat(usdcBalance) + parseFloat(usycValue)).toFixed(6)

      // Estimate yield earned: current USYC value vs initial deposit
      const initialValueRaw = this.initialUsycShares > 0n
        ? (this.initialUsycShares * BigInt(1e6)) / 1000000n  // approximate initial cost basis
        : 0n
      const yieldEarned = Math.max(0, parseFloat(usycValue) - parseFloat(ethers.formatUnits(initialValueRaw, 6)))

      const annualYield = parseFloat(usycValue) * this.USYC_APY

      return {
        usdcBalance,
        usycShares: ethers.formatUnits(usycShares, 18),
        usycValueUsdc: usycValue,
        totalValueUsdc: totalValue,
        yieldEarnedUsdc: yieldEarned.toFixed(6),
        spendingMode: this._getSpendingMode(usdcBalance, totalValue),
        annualYieldUsdc: annualYield.toFixed(2),
        apy: this.USYC_APY,
        lastRebalance: this.lastRebalanceTime,
      }
    } catch (err: any) {
      console.warn('[Treasury] State read error:', err.message)
      return this._mockState()
    }
  }

  /**
   * Rebalance treasury: redeem USYC if float is low, deposit if surplus.
   * Called at start of each risk cycle to ensure operational funds available.
   */
  async rebalance(): Promise<RebalanceResult> {
    if (!this.usycVault || !this.usdcToken) {
      return { action: 'none', amountUsdc: '0', reason: 'Treasury not initialized' }
    }

    const state = await this.getState()
    const usdcFloat = parseFloat(state.usdcBalance)
    const usycValue = parseFloat(state.usycValueUsdc)
    const minFloat = parseFloat(this.MIN_FLOAT_USDC)
    const normalFloat = parseFloat(this.NORMAL_FLOAT_USDC)

    // Need to top up: redeem USYC -> USDC
    if (usdcFloat < minFloat && usycValue > 0) {
      const redeemUsdc = normalFloat - usdcFloat
      console.log(`[Treasury] Float low (${usdcFloat.toFixed(2)} USDC) - redeeming ${redeemUsdc.toFixed(2)} from USYC`)

      try {
        const redeemShares = await this.usycVault.convertToShares(
          ethers.parseUnits(redeemUsdc.toFixed(6), 6)
        )
        const tx = await this.usycVault.redeem(redeemShares, this.agentAddress, this.agentAddress)
        await tx.wait()
        this.lastRebalanceTime = new Date().toISOString()
        console.log(`[Treasury] Redeemed ${redeemUsdc.toFixed(2)} USDC from USYC. Tx: ${tx.hash}`)
        return {
          action: 'redeem',
          amountUsdc: redeemUsdc.toFixed(6),
          txHash: tx.hash,
          reason: `Float ${usdcFloat.toFixed(2)} USDC < min ${this.MIN_FLOAT_USDC} USDC`,
        }
      } catch (err: any) {
        console.warn('[Treasury] Redeem failed (non-fatal):', err.message)
        return { action: 'none', amountUsdc: '0', reason: `Redeem failed: ${err.message}` }
      }
    }

    // Surplus: deposit excess USDC -> USYC
    if (usdcFloat > normalFloat * 2) {
      const depositUsdc = usdcFloat - normalFloat
      console.log(`[Treasury] Surplus USDC (${usdcFloat.toFixed(2)}) - depositing ${depositUsdc.toFixed(2)} into USYC`)

      try {
        const depositAmount = ethers.parseUnits(depositUsdc.toFixed(6), 6)
        // Approve USDC to USYC vault
        const approveTx = await this.usdcToken.approve(USYC_ADDRESS, depositAmount)
        await approveTx.wait()
        // Deposit USDC -> get USYC shares
        const depositTx = await this.usycVault.deposit(depositAmount, this.agentAddress)
        await depositTx.wait()
        this.lastRebalanceTime = new Date().toISOString()
        console.log(`[Treasury] Deposited ${depositUsdc.toFixed(2)} USDC into USYC. Tx: ${depositTx.hash}`)
        return {
          action: 'deposit',
          amountUsdc: depositUsdc.toFixed(6),
          txHash: depositTx.hash,
          reason: `Surplus ${usdcFloat.toFixed(2)} USDC > ${normalFloat * 2} USDC target`,
        }
      } catch (err: any) {
        console.warn('[Treasury] Deposit failed (non-fatal):', err.message)
        return { action: 'none', amountUsdc: '0', reason: `Deposit failed: ${err.message}` }
      }
    }

    return { action: 'none', amountUsdc: '0', reason: 'Float within normal range' }
  }

  /**
   * Determine spending mode from current balances.
   */
  _getSpendingMode(usdcBalance: string, totalValue: string): SpendingMode {
    const usdc = parseFloat(usdcBalance)
    const total = parseFloat(totalValue)
    const critical = parseFloat(this.CRITICAL_THRESHOLD)
    const min = parseFloat(this.MIN_FLOAT_USDC)

    if (total < critical) return 'CRITICAL'
    if (usdc < min && total < 10) return 'CONSERVATION'
    return 'NORMAL'
  }

  /**
   * Mock state for when contracts are not reachable (testnet downtime etc).
   * Shows a realistic Dryad treasury for demo purposes.
   */
  _mockState(): TreasuryState {
    const elapsed = (Date.now() - this.deploymentTime) / 1000 / 86400 / 365
    const principal = 23600
    const yieldEarned = principal * this.USYC_APY * elapsed
    const usycValue = principal + yieldEarned
    const usdcFloat = 14.99  // realistic post-deposit float

    return {
      usdcBalance: usdcFloat.toFixed(6),
      usycShares: (usycValue / 1.04).toFixed(6),  // shares worth slightly less at inception
      usycValueUsdc: usycValue.toFixed(6),
      totalValueUsdc: (usycValue + usdcFloat).toFixed(6),
      yieldEarnedUsdc: yieldEarned.toFixed(6),
      spendingMode: 'NORMAL',
      annualYieldUsdc: (usycValue * this.USYC_APY).toFixed(2),
      apy: this.USYC_APY,
      lastRebalance: this.lastRebalanceTime,
    }
  }

  /**
   * Human-readable summary of treasury health for logs.
   */
  async logState() {
    const s = await this.getState()
    console.log('\n[Treasury] ─────────────────────────────')
    console.log(`[Treasury] Mode:         ${s.spendingMode}`)
    console.log(`[Treasury] USDC float:   $${parseFloat(s.usdcBalance).toFixed(2)}`)
    console.log(`[Treasury] USYC (yield): $${parseFloat(s.usycValueUsdc).toFixed(2)} (~${(s.apy * 100).toFixed(0)}% APY T-bills)`)
    console.log(`[Treasury] Total:        $${parseFloat(s.totalValueUsdc).toFixed(2)}`)
    console.log(`[Treasury] Yield earned: $${parseFloat(s.yieldEarnedUsdc).toFixed(4)}`)
    console.log(`[Treasury] Proj annual:  $${s.annualYieldUsdc}/yr`)
    console.log('[Treasury] ─────────────────────────────\n')
  }
}
