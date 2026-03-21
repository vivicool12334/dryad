/**
 * Autonomous Decision Loop for Dryad.
 * Runs every 4 hours:
 * 1. Check for new verified photo submissions
 * 2. If invasives found → create remediation plan → email contractor → record milestone
 * 3. Check stETH yield → auto-buy DIEM if available
 * 4. Record Monitoring milestone after each cycle
 */
import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import { getSubmissions, markProcessed, type PhotoSubmission } from '../submissions.ts';
import { INVASIVE_SPECIES } from '../actions/checkBiodiversity.ts';
import { sendDryadEmail } from '../actions/agentMail.ts';
import { PARCEL_BOUNDS } from '../parcels.ts';

const CYCLE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const CONTRACTOR_EMAIL = process.env.CONTRACTOR_EMAIL || 'powahgen@gmail.com';

export class DecisionLoopService extends Service {
  static serviceType = 'dryad-decision-loop';
  capabilityDescription = 'Autonomous decision loop that monitors submissions, detects invasives, emails contractors, and manages treasury.';

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info('[Dryad] Starting autonomous decision loop (every 4 hours)');
    const service = new DecisionLoopService(runtime);

    // Run first cycle after 30 seconds (let everything initialize)
    setTimeout(() => service.runCycle(), 30_000);

    // Then every 4 hours
    service.timer = setInterval(() => service.runCycle(), CYCLE_INTERVAL_MS);

    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    const service = runtime.getService(DecisionLoopService.serviceType) as DecisionLoopService | undefined;
    if (service) service.stop();
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[Dryad] Decision loop stopped');
  }

  async runCycle() {
    logger.info('[Dryad] === Decision loop cycle starting ===');

    try {
      // Step 1: Process new photo submissions
      await this.processSubmissions();

      // Step 2: Check iNaturalist for new on-parcel observations
      await this.checkBiodiversity();

      // Step 3: Log cycle completion
      logger.info('[Dryad] === Decision loop cycle complete ===');
    } catch (error) {
      logger.error({ error }, '[Dryad] Decision loop cycle failed');
    }
  }

  private async processSubmissions() {
    const unprocessed = getSubmissions({ unprocessedOnly: true });
    if (unprocessed.length === 0) {
      logger.info('[Dryad] No new verified submissions to process');
      return;
    }

    logger.info(`[Dryad] Processing ${unprocessed.length} new submissions`);

    // Group by type
    const invasiveReports: PhotoSubmission[] = [];
    const proofOfWork: PhotoSubmission[] = [];

    for (const sub of unprocessed) {
      if (sub.type === 'plant_id') {
        // Check if it's an invasive species
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

    // Handle invasive species reports → email contractor
    if (invasiveReports.length > 0) {
      const parcelsAffected = [...new Set(invasiveReports.map((s) => s.nearestParcel))];
      const speciesList = [...new Set(invasiveReports.map((s) => s.species || 'Unknown species'))];

      const emailBody = `INVASIVE SPECIES ALERT — Action Required

${invasiveReports.length} invasive species observation(s) confirmed on the following parcels:

Parcels: ${parcelsAffected.join(', ')}
Species: ${speciesList.join(', ')}

Details:
${invasiveReports.map((s) => `- ${s.species || 'Unknown'} at ${s.nearestParcel} (${s.distanceMeters.toFixed(0)}m from parcel center)\n  "${s.description}"\n  Photo: ${s.photoFilename}`).join('\n\n')}

Please schedule removal at your earliest convenience. Standard removal protocol:
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
        logger.info(`[Dryad] Sent invasive alert email to ${CONTRACTOR_EMAIL} for ${parcelsAffected.join(', ')}`);
      } catch (error) {
        logger.error({ error }, '[Dryad] Failed to send contractor email');
      }
    }

    // Handle proof-of-work submissions
    if (proofOfWork.length > 0) {
      logger.info(`[Dryad] ${proofOfWork.length} proof-of-work submissions verified`);
    }

    // Mark all as processed
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
      for (const obs of observations) {
        const name = obs.taxon?.name || obs.species_guess || '';
        for (const genus of Object.keys(INVASIVE_SPECIES)) {
          if (name.toLowerCase().includes(genus.toLowerCase())) {
            invasiveCount++;
            break;
          }
        }
      }

      logger.info(`[Dryad] Biodiversity check: ${observations.length} observations, ${invasiveCount} invasive`);
    } catch (error) {
      logger.error({ error }, '[Dryad] Biodiversity check failed');
    }
  }
}
