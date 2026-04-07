/**
 * Autonomous Decision Loop for Dryad.
 * Runs every 24 hours:
 * 1. Check for new verified photo submissions → email contractor if invasives
 * 2. Check iNaturalist for on-parcel observations
 * 3. Check AgentMail for new messages
 * 4. Check treasury balances → evaluate allocation + adaptive spending
 * 4b. Active yield rebalancing → fetch live APYs, rebalance if beneficial
 * 5. Check DIEM stake health → plan purchase if credits running low
 * 6. Record Monitoring milestone if thresholds crossed
 * 7. Post summary
 */
import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import { getSubmissions, markProcessed, updateSubmissionVision, getSubmissionById, type PhotoSubmission } from '../submissions.ts';
import { INVASIVE_SPECIES, INVASIVE_PRIORITY_1, INVASIVE_PRIORITY_2, INVASIVE_PRIORITY_3 } from '../actions/checkBiodiversity.ts';
import { sendDryadEmail } from '../actions/agentMail.ts';
import { PARCEL_BOUNDS, isWithinParcels, findNearestParcel } from '../parcels.ts';
import { getWeatherAssessment } from '../actions/checkWeather.ts';
import { getCurrentSeason, getSeasonalBriefing } from '../utils/seasonalAwareness.ts';
import { recordLoopExecution, recordApiCall } from '../actions/selfAssess.ts';
import { generateWeeklyReport } from '../actions/generateReport.ts';
import { audit } from './auditLog.ts';
import { appendLoopEntry, type LoopStep } from './loopHistory.ts';
import { appendTreasurySnapshot } from './treasurySnapshots.ts';
import { appendHealthSnapshot } from './healthSnapshots.ts';
import { getTransactionHistory } from '../security/transactionGuard.ts';
import { verifyWorkPhoto, verifyBeforeAfter } from './visionVerify.ts';
import { postTweet, getNextQueuedTweet } from '../utils/twitter.ts';
import { runRebalanceCheck } from './rebalancer.ts';
import { TIMING, FINANCIAL, DEMO_MODE, demoLog, demoSection, logConfig } from '../config/constants.ts';

const CYCLE_INTERVAL_MS = TIMING.CYCLE_INTERVAL_MS;
const CONTRACTOR_EMAIL = process.env.CONTRACTOR_EMAIL || 'powahgen@gmail.com';

// Weekly report tracking
let weeklyReportSentDate = '';
let demoCycleCount = 0;

// Financial model constants — pulled from centralized config
const ANNUAL_OPERATING_COST = FINANCIAL.ANNUAL_OPERATING_COST;
const ANNUAL_COST_ESTABLISHMENT = FINANCIAL.ANNUAL_COST_ESTABLISHMENT;
const ANNUAL_COST_WITH_LVT = FINANCIAL.ANNUAL_COST_WITH_LVT;
const STETH_APR = FINANCIAL.STETH_APR;
const SUSTAINABILITY_THRESHOLD = FINANCIAL.SUSTAINABILITY_THRESHOLD;
const NON_NEGOTIABLE_ANNUAL = FINANCIAL.NON_NEGOTIABLE_ANNUAL;

// Track spending mode across cycles to detect changes
let lastSpendingMode: string = '';
let lastYieldUSD: number = 0;

// Native indicator species (subset from checkBiodiversity for loop use)
const NATIVE_INDICATORS = [
  'Andropogon', 'Schizachyrium', 'Sorghastrum', 'Panicum',
  'Asclepias', 'Echinacea', 'Rudbeckia', 'Monarda', 'Liatris',
  'Quercus', 'Carya',
  'Solidago', 'Aster', 'Symphyotrichum',
];

// Singleton reference for admin trigger endpoint
let activeInstance: DecisionLoopService | null = null;

/** Trigger a manual decision loop cycle (used by admin API) */
export async function triggerManualCycle(): Promise<{ triggered: boolean; message: string }> {
  if (!activeInstance) return { triggered: false, message: 'Decision loop service not running' };
  // Don't allow concurrent cycles
  if ((activeInstance as any)._running) return { triggered: false, message: 'Cycle already in progress' };
  activeInstance.runCycle();  // fire and forget — it's async
  return { triggered: true, message: 'Decision loop cycle triggered' };
}

export class DecisionLoopService extends Service {
  static serviceType = 'dryad-decision-loop';
  capabilityDescription = 'Autonomous 24-hour decision loop: monitors submissions, invasives, treasury health, DIEM stake, and contractor coordination.';

  private timer: ReturnType<typeof setInterval> | null = null;
  private _running = false;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    if (DEMO_MODE) logConfig();
    const intervalDesc = DEMO_MODE ? `${CYCLE_INTERVAL_MS / 1000}s (DEMO)` : '24 hours';
    logger.info(`[Dryad] Starting autonomous decision loop (every ${intervalDesc})`);
    const service = new DecisionLoopService(runtime);
    activeInstance = service;  // Store singleton reference

    // Run first cycle after delay
    setTimeout(() => service.runCycle(), TIMING.FIRST_CYCLE_DELAY_MS);
    service.timer = setInterval(() => service.runCycle(), CYCLE_INTERVAL_MS);

    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    const service = runtime.getService(DecisionLoopService.serviceType) as DecisionLoopService | undefined;
    if (service) service.stop();
  }

  async stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    logger.info('[Dryad] Decision loop stopped');
  }

  async runCycle() {
    if (this._running) { logger.warn('[Dryad] Cycle already in progress, skipping'); return; }
    this._running = true;
    logger.info('[Dryad] ═══ Decision loop cycle starting ═══');
    const cycleStart = Date.now();
    const steps: LoopStep[] = [];
    const actionsTriggered: string[] = [];
    const errorsEncountered: string[] = [];

    // Helper to run a named step and record its timing/result
    const runStep = async (name: string, fn: () => Promise<string>): Promise<void> => {
      const t = Date.now();
      try {
        const result = await fn();
        steps.push({ name, result, durationMs: Date.now() - t, status: 'ok' });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        steps.push({ name, result: `error: ${msg}`, durationMs: Date.now() - t, status: 'error' });
        errorsEncountered.push(`${name}: ${msg}`);
        logger.error({ error }, `[Dryad] Step "${name}" failed`);
      }
    };

    try {
      // 0. Environmental context
      const season = getCurrentSeason();
      const weather = await getWeatherAssessment();
      logger.info(`[Dryad] ${getSeasonalBriefing()}`);
      logger.info(`[Dryad] Weather: ${weather.summary}`);
      if (weather.flags.length > 0) {
        logger.info(`[Dryad] Weather flags: ${weather.flags.join(', ')}`);
      }

      // 1. Process photo submissions
      await runStep('submissions', async () => {
        const result = await this.processSubmissions(weather.contractorWorkSafe, season);
        if (result.emailsSent > 0) actionsTriggered.push('sendEmail');
        return `${result.processed} processed, ${result.invasiveAlerts} invasive alerts, ${result.emailsSent} emails`;
      });

      // 2. Check iNaturalist biodiversity
      await runStep('biodiversity', async () => {
        const result = await this.checkBiodiversity(season.season);
        if (result.healthScore !== null) {
          appendHealthSnapshot({
            timestamp: Date.now(),
            healthScore: result.healthScore,
            invasivesP1: result.invasivesP1,
            invasivesP2: result.invasivesP2,
            invasivesP3: result.invasivesP3,
            observationsTotal: result.observationsTotal,
            nativeSpeciesCount: result.nativeSpeciesCount,
            nativeIndicatorCount: result.nativeIndicatorCount,
            season: season.season,
            seasonalMultiplier: season.healthScoreThresholdMultiplier,
            invasiveSpecies: result.invasiveSpecies,
          });
        }
        return `health=${result.healthScore}/100, obs=${result.observationsTotal}, P1=${result.invasivesP1} P2=${result.invasivesP2} P3=${result.invasivesP3}`;
      });

      // 3. Check treasury health
      await runStep('treasury', async () => {
        const result = await this.checkTreasuryHealth();
        if (result.modeChanged) actionsTriggered.push('treasuryAlert');
        if (result.snapshot) appendTreasurySnapshot(result.snapshot);
        return `mode=${result.mode}, wstETH=${result.wstethNum.toFixed(4)}, yield=$${result.annualYield.toFixed(0)}/yr`;
      });

      // 3b. Active yield rebalancing (runs after treasury health check)
      await runStep('yield_rebalance', async () => {
        const result = await runRebalanceCheck();
        if (result.startsWith('rebalanced')) actionsTriggered.push('yieldRebalance');
        return result;
      });

      // 4. Check DIEM stake
      await runStep('diem', async () => {
        const result = await this.checkDIEMHealth();
        return `DIEM=${result.balance.toFixed(4)}, credits=$${result.dailyCredits.toFixed(2)}/day`;
      });

      // 5. Weekly report check
      await runStep('weekly_report', async () => {
        const sent = await this.checkWeeklyReport();
        if (sent) actionsTriggered.push('weeklyReport');
        return sent ? 'sent' : 'not due';
      });

      const elapsed = Date.now() - cycleStart;
      logger.info(`[Dryad] ═══ Decision loop cycle complete (${(elapsed / 1000).toFixed(1)}s) ═══`);
      recordLoopExecution(true);
      audit('LOOP_EXECUTION', `Completed in ${(elapsed / 1000).toFixed(1)}s`, 'decisionLoop', 'info');

      appendLoopEntry({
        timestamp: cycleStart,
        status: 'success',
        durationMs: elapsed,
        season: season.season,
        actionsTriggered,
        errorsEncountered,
        steps,
      });

      // Post from tweet queue — every cycle in demo, Mon/Thu in production
      demoCycleCount++;
      const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, 4=Thu
      const shouldTweet = TIMING.TWEET_EVERY_CYCLE || dayOfWeek === 1 || dayOfWeek === 4;
      if (shouldTweet) {
        try {
          const nextTweet = getNextQueuedTweet();
          if (nextTweet) {
            await postTweet(nextTweet);
          }
        } catch (tweetErr) {
          logger.warn({ error: tweetErr }, '[Dryad] Twitter post failed (non-fatal)');
        }
      }

    } catch (error) {
      const elapsed = Date.now() - cycleStart;
      logger.error({ error }, '[Dryad] Decision loop cycle failed');
      recordLoopExecution(false);
      const msg = error instanceof Error ? error.message : String(error);
      audit('LOOP_FAILURE', msg, 'decisionLoop', 'critical');
      errorsEncountered.push(msg);

      // Still record the failed entry
      const season = getCurrentSeason();
      appendLoopEntry({
        timestamp: cycleStart,
        status: 'failure',
        durationMs: elapsed,
        season: season.season,
        actionsTriggered,
        errorsEncountered,
        steps,
      });
    } finally {
      this._running = false;
    }
  }

  private async processSubmissions(contractorWorkSafe: boolean = true, season?: ReturnType<typeof getCurrentSeason>): Promise<{ processed: number; invasiveAlerts: number; emailsSent: number }> {
    const unprocessed = getSubmissions({ unprocessedOnly: true });
    if (unprocessed.length === 0) {
      logger.info('[Dryad] No new verified submissions');
      return { processed: 0, invasiveAlerts: 0, emailsSent: 0 };
    }

    logger.info(`[Dryad] Processing ${unprocessed.length} new submissions`);

    const invasiveReports: PhotoSubmission[] = [];
    const proofOfWork: PhotoSubmission[] = [];

    for (const sub of unprocessed) {
      if (sub.type === 'plant_id') {
        const speciesName = (sub.species || sub.description || '').toLowerCase();
        for (const [genus, common] of Object.entries(INVASIVE_SPECIES)) {
          if (speciesName.includes(genus.toLowerCase()) || speciesName.includes(common.toLowerCase())) {
            invasiveReports.push(sub);
            break;
          }
        }
      } else if (sub.type === 'proof_of_work') {
        proofOfWork.push(sub);
      }
    }

    let emailsSent = 0;

    if (invasiveReports.length > 0) {
      if (!contractorWorkSafe) {
        logger.info('[Dryad] Invasives detected but weather unsafe for contractor work — deferring email to next cycle');
      } else {
        const parcelsAffected = [...new Set(invasiveReports.map((s) => s.nearestParcel))];
        const speciesList = [...new Set(invasiveReports.map((s) => s.species || 'Unknown species'))];
        const seasonNote = season ? `\nSeason: ${season.season}. ${season.description}.` : '';

        const emailBody = `INVASIVE SPECIES ALERT — Action Required${seasonNote}

${invasiveReports.length} invasive species observation(s) confirmed on the following parcels:

Parcels: ${parcelsAffected.join(', ')}
Species: ${speciesList.join(', ')}

Details:
${invasiveReports.map((s) => `- ${s.species || 'Unknown'} at ${s.nearestParcel} (${s.distanceMeters.toFixed(0)}m from center)\n  "${s.description}"\n  Photo: ${s.photoFilename}`).join('\n\n')}

Removal protocol:
1. Cut at base, apply glyphosate to stump
2. Bag and remove all plant material
3. Take GPS-tagged before/after photos
4. Submit proof-of-work photos at: ${process.env.SERVER_URL || 'http://localhost:3000'}/submit

Budget: Up to $50 per parcel per visit.`;

        try {
          await sendDryadEmail(
            CONTRACTOR_EMAIL,
            `[Dryad] Invasive Species Alert — ${parcelsAffected.join(', ')}`,
            emailBody
          );
          emailsSent++;
          logger.info(`[Dryad] Sent invasive alert to ${CONTRACTOR_EMAIL}`);
        } catch (error) {
          logger.error({ error }, '[Dryad] Failed to send contractor email');
        }
      }
    }

    // Vision-verify proof-of-work photos before approving
    let visionApproved = 0;
    let visionFlagged = 0;
    if (proofOfWork.length > 0) {
      for (const sub of proofOfWork) {
        // Skip if already vision-verified
        if (sub.visionVerifiedAt) {
          if (sub.visionApproved) visionApproved++;
          else visionFlagged++;
          continue;
        }

        // Only verify if we have a photo on disk
        if (!sub.photoPath) {
          logger.warn(`[Dryad] Proof-of-work ${sub.id} has no photo path — skipping vision check`);
          continue;
        }

        try {
          // Check if there's a before photo for comparison
          let result;
          if (sub.beforePhotoPath) {
            result = await verifyBeforeAfter({
              beforePhotoPath: sub.beforePhotoPath,
              afterPhotoPath: sub.photoPath,
              workType: sub.workType || 'site_assessment',
              workDescription: sub.description,
              parcelAddress: sub.nearestParcel,
            });
          } else {
            result = await verifyWorkPhoto({
              photoPath: sub.photoPath,
              workType: sub.workType || 'site_assessment',
              workDescription: sub.description,
              parcelAddress: sub.nearestParcel,
              contractorName: sub.contractorName,
            });
          }

          updateSubmissionVision(sub.id, {
            score: result.score,
            approved: result.approved,
            reasoning: result.reasoning,
            matchedIndicators: result.matchedIndicators,
            flagsTriggered: result.flagsTriggered,
            model: result.model,
          });

          if (result.approved) {
            visionApproved++;
            logger.info(`[Dryad] ✅ ${sub.id} vision-approved (score: ${result.score.toFixed(2)})`);
          } else {
            visionFlagged++;
            logger.warn(`[Dryad] ⚠️ ${sub.id} vision-flagged (score: ${result.score.toFixed(2)}): ${result.reasoning}`);
          }
        } catch (err: any) {
          logger.error(`[Dryad] Vision verification error for ${sub.id}: ${err?.message}`);
        }
      }

      logger.info(`[Dryad] ${proofOfWork.length} proof-of-work: ${visionApproved} approved, ${visionFlagged} flagged for review`);
    }

    markProcessed(unprocessed.map((s) => s.id));
    return { processed: unprocessed.length, invasiveAlerts: invasiveReports.length, emailsSent };
  }

  private async checkBiodiversity(seasonName: string): Promise<{
    healthScore: number | null;
    invasivesP1: number;
    invasivesP2: number;
    invasivesP3: number;
    observationsTotal: number;
    nativeSpeciesCount: number;
    nativeIndicatorCount: number;
    invasiveSpecies: string[];
  }> {
    const empty = { healthScore: null, invasivesP1: 0, invasivesP2: 0, invasivesP3: 0, observationsTotal: 0, nativeSpeciesCount: 0, nativeIndicatorCount: 0, invasiveSpecies: [] };

    try {
      const { sw, ne } = PARCEL_BOUNDS;
      const url = `https://api.inaturalist.org/v1/observations?nelat=${ne.lat}&nelng=${ne.lng}&swlat=${sw.lat}&swlng=${sw.lng}&per_page=200&taxon_name=Plantae&order_by=observed_on`;
      const response = await fetch(url);
      if (!response.ok) return empty;

      const data = (await response.json()) as any;
      const observations = data.results || [];

      // Filter to on-parcel observations
      const onParcelObs = observations.filter((obs: any) => {
        if (!obs.location) return false;
        const [lat, lng] = obs.location.split(',').map(parseFloat);
        return isWithinParcels(lat, lng);
      });

      let p1Count = 0, p2Count = 0, p3Count = 0;
      const nativeSpecies = new Set<string>();
      let nativeIndicatorCount = 0;
      const invasiveCommonNames: string[] = [];

      for (const obs of onParcelObs) {
        const name = (obs.taxon?.name || obs.species_guess || '').toLowerCase();

        // Skip native Phragmites
        if (name.includes('phragmites') && name.includes('americanus')) {
          nativeSpecies.add('Phragmites australis subsp. americanus (native)');
          continue;
        }

        let isInvasive = false;
        for (const [genus, common] of Object.entries(INVASIVE_PRIORITY_1)) {
          if (name.includes(genus.toLowerCase())) { p1Count++; if (!invasiveCommonNames.includes(common)) invasiveCommonNames.push(common); isInvasive = true; break; }
        }
        if (!isInvasive) {
          for (const [genus, common] of Object.entries(INVASIVE_PRIORITY_2)) {
            if (name.includes(genus.toLowerCase())) { p2Count++; if (!invasiveCommonNames.includes(common)) invasiveCommonNames.push(common); isInvasive = true; break; }
          }
        }
        if (!isInvasive) {
          for (const [genus, common] of Object.entries(INVASIVE_PRIORITY_3)) {
            if (name.includes(genus.toLowerCase())) { p3Count++; if (!invasiveCommonNames.includes(common)) invasiveCommonNames.push(common); isInvasive = true; break; }
          }
        }

        if (!isInvasive && obs.taxon?.name) {
          nativeSpecies.add(obs.taxon.preferred_common_name || obs.taxon.name);
          for (const ind of NATIVE_INDICATORS) {
            if (name.includes(ind.toLowerCase())) { nativeIndicatorCount++; break; }
          }
        }
      }

      // Health score
      const weightedInvasive = p1Count * 3 + p2Count * 2 + p3Count * 1;
      const invasiveRatio = onParcelObs.length > 0 ? Math.min(weightedInvasive / (onParcelObs.length * 2), 1) : 0;
      const diversityScore = Math.min(nativeSpecies.size / 20, 1) * 40;
      const invasiveScore = (1 - invasiveRatio) * 40;
      const indicatorBonus = Math.min(nativeIndicatorCount / 5, 1) * 20;
      const healthScore = Math.round(diversityScore + invasiveScore + indicatorBonus);

      logger.info(`[Dryad] iNaturalist: ${observations.length} obs total, ${onParcelObs.length} on-parcel, health=${healthScore}/100, P1=${p1Count} P2=${p2Count} P3=${p3Count}`);
      recordApiCall('iNaturalist', true);

      return {
        healthScore,
        invasivesP1: p1Count,
        invasivesP2: p2Count,
        invasivesP3: p3Count,
        observationsTotal: onParcelObs.length,
        nativeSpeciesCount: nativeSpecies.size,
        nativeIndicatorCount,
        invasiveSpecies: invasiveCommonNames,
      };
    } catch (error) {
      logger.error({ error }, '[Dryad] iNaturalist check failed');
      recordApiCall('iNaturalist', false);
      return empty;
    }
  }

  private async checkTreasuryHealth(): Promise<{
    mode: string;
    wstethNum: number;
    annualYield: number;
    modeChanged: boolean;
    snapshot: import('./treasurySnapshots.ts').TreasurySnapshot | null;
  }> {
    const empty = { mode: 'UNKNOWN', wstethNum: 0, annualYield: 0, modeChanged: false, snapshot: null };

    try {
      const { createPublicClient, http, parseAbi, formatEther, formatUnits } = await import('viem');
      const { base, baseSepolia } = await import('viem/chains');
      const { privateKeyToAccount } = await import('viem/accounts');
      const { CHAIN: chainConfig } = await import('../config/constants.ts');

      const pk = process.env.EVM_PRIVATE_KEY;
      if (!pk) return empty;

      const account = privateKeyToAccount(pk as `0x${string}`);
      const selectedChain = chainConfig.USE_TESTNET ? baseSepolia : base;
      const rpcTransport = chainConfig.RPC_URL ? http(chainConfig.RPC_URL) : http();
      const client = createPublicClient({ chain: selectedChain, transport: rpcTransport });
      const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);

      const ethBal = await client.getBalance({ address: account.address });
      const wstethBal = await client.readContract({
        address: chainConfig.WSTETH_ADDRESS,
        abi, functionName: 'balanceOf', args: [account.address],
      }) as bigint;

      // DIEM balance
      const diemAddr = chainConfig.DIEM_ADDRESS;
      let diemNum = 0;
      try {
        const diemBal = await client.readContract({ address: diemAddr, abi, functionName: 'balanceOf', args: [account.address] }) as bigint;
        diemNum = parseFloat(formatUnits(diemBal, 18));
      } catch { /* non-critical */ }

      const ethNum = parseFloat(formatEther(ethBal));
      const wstethNum = parseFloat(formatEther(wstethBal));

      // Live ETH price
      let ethPrice = 2600;
      try {
        const pr = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd', { signal: AbortSignal.timeout(5000) });
        if (pr.ok) { const d = await pr.json() as any; ethPrice = d?.ethereum?.usd || 2600; }
      } catch { /* use fallback */ }

      const estimatedUsd = (ethNum + wstethNum) * ethPrice;
      const annualYield = wstethNum * ethPrice * STETH_APR;
      const dailyYieldUsd = annualYield / 365;

      const isSustainable = annualYield >= ANNUAL_OPERATING_COST;
      const coversNonNegotiable = annualYield >= NON_NEGOTIABLE_ANNUAL;
      const mode = isSustainable ? 'NORMAL' : coversNonNegotiable ? 'CONSERVATION' : 'CRITICAL';

      // Daily spend from tx guard
      const dayAgo = Date.now() - 86400000;
      const dailySpendUsd = getTransactionHistory()
        .filter(tx => tx.timestamp > dayAgo)
        .reduce((s, tx) => s + tx.amount, 0);

      const snapshot: import('./treasurySnapshots.ts').TreasurySnapshot = {
        timestamp: Date.now(),
        wstEthBalance: wstethNum.toFixed(6),
        ethBalance: ethNum.toFixed(6),
        ethPriceUsd: ethPrice,
        estimatedUsd: parseFloat(estimatedUsd.toFixed(2)),
        annualYieldUsd: parseFloat(annualYield.toFixed(2)),
        dailyYieldUsd: parseFloat(dailyYieldUsd.toFixed(4)),
        spendingMode: mode as 'NORMAL' | 'CONSERVATION' | 'CRITICAL',
        dailySpendUsd: parseFloat(dailySpendUsd.toFixed(2)),
        diemBalance: diemNum.toFixed(4),
      };

      logger.info(`[Dryad] Treasury: ${ethNum.toFixed(4)} ETH + ${wstethNum.toFixed(4)} wstETH = ~$${estimatedUsd.toFixed(0)} | Yield: ~$${annualYield.toFixed(0)}/yr | Mode: ${mode}`);

      const modeChanged = lastSpendingMode !== '' && lastSpendingMode !== mode;
      const yieldShift = lastYieldUSD > 0 && Math.abs(annualYield - lastYieldUSD) / lastYieldUSD > 0.1;

      if (modeChanged || yieldShift) {
        const alertSubject = modeChanged
          ? `[Dryad] Spending mode changed: ${lastSpendingMode} → ${mode}`
          : `[Dryad] Yield shift: $${lastYieldUSD.toFixed(0)} → $${annualYield.toFixed(0)}/yr`;

        const alertBody = `Dryad Treasury Alert

Spending Mode: ${mode}${modeChanged ? ` (was ${lastSpendingMode})` : ''}
Total Value: ~$${estimatedUsd.toFixed(0)}
ETH: ${ethNum.toFixed(4)} | wstETH: ${wstethNum.toFixed(4)}
Annual Yield: ~$${annualYield.toFixed(0)}/yr (3.5% APR on wstETH)
Required: $${ANNUAL_OPERATING_COST}/yr | Non-negotiable: $${NON_NEGOTIABLE_ANNUAL}/yr

${mode === 'NORMAL' ? 'All operations active.' : mode === 'CONSERVATION' ? 'Discretionary contractor jobs paused. Monitoring + taxes + VPS continue.' : 'CRITICAL: Yield insufficient for core costs. Steward intervention needed.'}`;

        try {
          await sendDryadEmail(CONTRACTOR_EMAIL, alertSubject, alertBody);
          logger.info(`[Dryad] Sent treasury alert email: ${alertSubject}`);
        } catch (e) {
          logger.error({ error: e }, '[Dryad] Failed to send treasury alert');
        }

        audit('TREASURY_MODE_CHANGE', `${lastSpendingMode || 'initial'} → ${mode}`, 'decisionLoop', mode === 'CRITICAL' ? 'critical' : 'warn');
      }

      lastSpendingMode = mode;
      lastYieldUSD = annualYield;

      if (mode === 'CONSERVATION') {
        logger.warn('[Dryad] CONSERVATION MODE — pausing discretionary contractor jobs');
      } else if (mode === 'CRITICAL') {
        logger.error('[Dryad] CRITICAL — yield insufficient for non-negotiable costs. Steward intervention needed.');
      }

      return { mode, wstethNum, annualYield, modeChanged, snapshot };
    } catch (error) {
      logger.error({ error }, '[Dryad] Treasury check failed');
      return empty;
    }
  }

  private async checkDIEMHealth(): Promise<{ balance: number; dailyCredits: number }> {
    try {
      const { createPublicClient, http, parseAbi, formatUnits } = await import('viem');
      const { base, baseSepolia } = await import('viem/chains');
      const { privateKeyToAccount } = await import('viem/accounts');
      const { CHAIN: chainConfig } = await import('../config/constants.ts');

      const pk = process.env.EVM_PRIVATE_KEY;
      if (!pk) return { balance: 0, dailyCredits: 0 };

      const diemAddr = chainConfig.DIEM_ADDRESS;
      const account = privateKeyToAccount(pk as `0x${string}`);
      const selectedChain = chainConfig.USE_TESTNET ? baseSepolia : base;
      const rpcTransport = chainConfig.RPC_URL ? http(chainConfig.RPC_URL) : http();
      const client = createPublicClient({ chain: selectedChain, transport: rpcTransport });
      const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);

      const balance = await client.readContract({ address: diemAddr, abi, functionName: 'balanceOf', args: [account.address] }) as bigint;
      const balNum = parseFloat(formatUnits(balance, 18));
      const dailyCredits = balNum;

      logger.info(`[Dryad] DIEM: ${balNum.toFixed(4)} | Credits: ~$${dailyCredits.toFixed(2)}/day`);
      if (dailyCredits < FINANCIAL.DIEM_LOW_CREDIT_THRESHOLD) {
        logger.warn('[Dryad] DIEM stake is low — inference credits may run out.');
      }
      return { balance: balNum, dailyCredits };
    } catch (error) {
      logger.error({ error }, '[Dryad] DIEM check failed');
      return { balance: 0, dailyCredits: 0 };
    }
  }

  private async checkWeeklyReport(): Promise<boolean> {
    try {
      const now = new Date();
      const detroit = new Date(now.toLocaleString('en-US', { timeZone: 'America/Detroit' }));
      const isMonday = detroit.getDay() === 1;
      const hour = detroit.getHours();
      const today = detroit.toDateString();

      // In demo mode, send report every Nth cycle instead of waiting for Monday
      const demoReportDue = TIMING.WEEKLY_REPORT_EVERY_N_CYCLES !== null
        && demoCycleCount > 0
        && demoCycleCount % TIMING.WEEKLY_REPORT_EVERY_N_CYCLES === 0;

      if ((demoReportDue || (isMonday && hour >= 8 && hour < 12)) && weeklyReportSentDate !== today) {
        logger.info('[Dryad] Monday morning — generating weekly report');
        const report = await generateWeeklyReport();
        await sendDryadEmail(
          CONTRACTOR_EMAIL,
          `[Dryad] Weekly Report — ${detroit.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
          report
        );
        weeklyReportSentDate = today;
        logger.info('[Dryad] Weekly report sent');
        return true;
      }
      return false;
    } catch (error) {
      logger.error({ error }, '[Dryad] Weekly report failed');
      return false;
    }
  }
}
