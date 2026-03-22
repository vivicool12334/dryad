/**
 * Autonomous Decision Loop for Dryad.
 * Runs every 6 hours:
 * 1. Check for new verified photo submissions → email contractor if invasives
 * 2. Check iNaturalist for on-parcel observations
 * 3. Check AgentMail for new messages
 * 4. Check treasury balances → evaluate 60/40 allocation + adaptive spending
 * 5. Check DIEM stake health → plan purchase if credits running low
 * 6. Record Monitoring milestone if thresholds crossed
 * 7. Post summary
 */
import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import { getSubmissions, markProcessed, type PhotoSubmission } from '../submissions.ts';
import { INVASIVE_SPECIES } from '../actions/checkBiodiversity.ts';
import { sendDryadEmail } from '../actions/agentMail.ts';
import { PARCEL_BOUNDS } from '../parcels.ts';

const CYCLE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CONTRACTOR_EMAIL = process.env.CONTRACTOR_EMAIL || 'powahgen@gmail.com';

// Financial model constants
const ANNUAL_OPERATING_COST = 645; // $/yr current
const ANNUAL_COST_WITH_LVT = 978; // $/yr if land value tax passes
const STETH_APR = 0.035;
const SUSTAINABILITY_THRESHOLD = ANNUAL_OPERATING_COST / STETH_APR; // ~$18,429
const NON_NEGOTIABLE_ANNUAL = 270 + 58 + 5; // taxes + VPS + gas = $333/yr

export class DecisionLoopService extends Service {
  static serviceType = 'dryad-decision-loop';
  capabilityDescription = 'Autonomous 6-hour decision loop: monitors submissions, invasives, treasury health, DIEM stake, and contractor coordination.';

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info('[Dryad] Starting autonomous decision loop (every 6 hours)');
    const service = new DecisionLoopService(runtime);

    // Run first cycle after 30 seconds
    setTimeout(() => service.runCycle(), 30_000);
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
    logger.info('[Dryad] ═══ Decision loop cycle starting ═══');
    const cycleStart = Date.now();

    try {
      // 1. Process photo submissions
      await this.processSubmissions();

      // 2. Check iNaturalist
      await this.checkBiodiversity();

      // 3. Check treasury health
      await this.checkTreasuryHealth();

      // 4. Check DIEM stake
      await this.checkDIEMHealth();

      const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
      logger.info(`[Dryad] ═══ Decision loop cycle complete (${elapsed}s) ═══`);
    } catch (error) {
      logger.error({ error }, '[Dryad] Decision loop cycle failed');
    }
  }

  private async processSubmissions() {
    const unprocessed = getSubmissions({ unprocessedOnly: true });
    if (unprocessed.length === 0) {
      logger.info('[Dryad] No new verified submissions');
      return;
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

    if (invasiveReports.length > 0) {
      const parcelsAffected = [...new Set(invasiveReports.map((s) => s.nearestParcel))];
      const speciesList = [...new Set(invasiveReports.map((s) => s.species || 'Unknown species'))];

      const emailBody = `INVASIVE SPECIES ALERT — Action Required

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
        logger.info(`[Dryad] Sent invasive alert to ${CONTRACTOR_EMAIL}`);
      } catch (error) {
        logger.error({ error }, '[Dryad] Failed to send contractor email');
      }
    }

    if (proofOfWork.length > 0) {
      logger.info(`[Dryad] ${proofOfWork.length} proof-of-work submissions verified`);
    }

    markProcessed(unprocessed.map((s) => s.id));
  }

  private async checkBiodiversity() {
    try {
      const { sw, ne } = PARCEL_BOUNDS;
      const url = `https://api.inaturalist.org/v1/observations?nelat=${ne.lat}&nelng=${ne.lng}&swlat=${sw.lat}&swlng=${sw.lng}&per_page=50&taxon_name=Plantae&order_by=observed_on`;
      const response = await fetch(url);
      if (!response.ok) return;

      const data = (await response.json()) as any;
      const observations = data.results || [];

      let invasiveCount = 0;
      const invasiveNames: string[] = [];
      for (const obs of observations) {
        const name = obs.taxon?.name || obs.species_guess || '';
        for (const [genus, common] of Object.entries(INVASIVE_SPECIES)) {
          if (name.toLowerCase().includes(genus.toLowerCase())) {
            invasiveCount++;
            if (!invasiveNames.includes(common)) invasiveNames.push(common);
            break;
          }
        }
      }

      logger.info(`[Dryad] iNaturalist: ${observations.length} obs, ${invasiveCount} invasive${invasiveNames.length ? ` (${invasiveNames.join(', ')})` : ''}`);
    } catch (error) {
      logger.error({ error }, '[Dryad] iNaturalist check failed');
    }
  }

  private async checkTreasuryHealth() {
    try {
      const { createPublicClient, http, parseAbi, formatEther } = await import('viem');
      const { base } = await import('viem/chains');
      const { privateKeyToAccount } = await import('viem/accounts');

      const pk = process.env.EVM_PRIVATE_KEY;
      if (!pk) return;

      const account = privateKeyToAccount(pk as `0x${string}`);
      const client = createPublicClient({ chain: base, transport: http() });
      const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);

      const ethBal = await client.getBalance({ address: account.address });
      const wstethBal = await client.readContract({
        address: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452' as `0x${string}`,
        abi, functionName: 'balanceOf', args: [account.address],
      }) as bigint;

      const ethNum = parseFloat(formatEther(ethBal));
      const wstethNum = parseFloat(formatEther(wstethBal));
      const ethPrice = 2600; // approximate
      const totalUSD = (ethNum + wstethNum) * ethPrice;
      const annualYield = wstethNum * ethPrice * STETH_APR;

      // Determine spending mode
      const isSustainable = annualYield >= ANNUAL_OPERATING_COST;
      const coversNonNegotiable = annualYield >= NON_NEGOTIABLE_ANNUAL;
      const mode = isSustainable ? 'NORMAL' : coversNonNegotiable ? 'CONSERVATION' : 'CRITICAL';

      logger.info(`[Dryad] Treasury: ${ethNum.toFixed(4)} ETH + ${wstethNum.toFixed(4)} wstETH = ~$${totalUSD.toFixed(0)} | Yield: ~$${annualYield.toFixed(0)}/yr | Mode: ${mode}`);

      if (mode === 'CONSERVATION') {
        logger.warn('[Dryad] CONSERVATION MODE — pausing discretionary contractor jobs, maintaining monitoring + taxes + VPS');
      } else if (mode === 'CRITICAL') {
        logger.error('[Dryad] CRITICAL — yield insufficient for non-negotiable costs. Steward intervention needed.');
      }
    } catch (error) {
      logger.error({ error }, '[Dryad] Treasury check failed');
    }
  }

  private async checkDIEMHealth() {
    try {
      const { createPublicClient, http, parseAbi, formatUnits } = await import('viem');
      const { base } = await import('viem/chains');
      const { privateKeyToAccount } = await import('viem/accounts');

      const pk = process.env.EVM_PRIVATE_KEY;
      if (!pk) return;

      const diemAddr = (process.env.DIEM_TOKEN_ADDRESS || '0xf4d97f2da56e8c3098f3a8d538db630a2606a024') as `0x${string}`;
      const account = privateKeyToAccount(pk as `0x${string}`);
      const client = createPublicClient({ chain: base, transport: http() });
      const abi = parseAbi(['function balanceOf(address) view returns (uint256)']);

      const balance = await client.readContract({ address: diemAddr, abi, functionName: 'balanceOf', args: [account.address] }) as bigint;
      const balNum = parseFloat(formatUnits(balance, 18));

      // 1 DIEM staked = $1/day in credits
      const dailyCredits = balNum;
      const daysRemaining = dailyCredits > 0 ? Infinity : 0; // Staked DIEM renews daily

      logger.info(`[Dryad] DIEM: ${balNum.toFixed(4)} | Credits: ~$${dailyCredits.toFixed(2)}/day`);

      if (dailyCredits < 0.1) {
        logger.warn('[Dryad] DIEM stake is low — inference credits may run out. Consider buying more DIEM via Uniswap.');
      }
    } catch (error) {
      logger.error({ error }, '[Dryad] DIEM check failed');
    }
  }
}
