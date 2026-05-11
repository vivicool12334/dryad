/**
 * Action: CHECK_SATELLITE_IMAGERY
 *
 * Pulls a fresh Sentinel-2 cycle from the satellite microservice, computes
 * per-parcel NDVI deltas, surfaces anomalies, and replies with a summary.
 *
 * Triggered by:
 *   - Chat: "check the satellite", "satellite check", "ndvi", etc.
 *   - decisionLoop weekly trigger (see services/decisionLoop.ts)
 */
import type {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { logger } from '@elizaos/core';
import {
  runSatelliteCycle,
  type SatelliteCycle,
  type ParcelTrendDelta,
  type NdviAnomaly,
} from '../services/satelliteMonitor.ts';
import { recordApiCall } from './selfAssess.ts';
import { getErrorMessage } from '../utils/fileErrors.ts';

const TRIGGER_PHRASES = [
  /\bsatellite\b/i,
  /\bndvi\b/i,
  /\bevi\b/i,
  /\bsentinel\b/i,
  /\bremote\s+sens(ing|e)\b/i,
];

function shouldHandle(text: string | undefined): boolean {
  if (!text) return false;
  return TRIGGER_PHRASES.some((re) => re.test(text));
}

export function summarizeCycle(
  cycle: SatelliteCycle,
  deltas: ParcelTrendDelta[],
  anomalies: NdviAnomaly[],
): string {
  const validObs = cycle.observations.filter((o) => !o.error);
  if (validObs.length === 0) {
    const errs = cycle.errors.length > 0 ? cycle.errors.join('; ') : 'no usable scene';
    return `Satellite cycle ${cycle.cycle_id}: no observations. ${errs}`;
  }

  const ndviMean =
    validObs.reduce((s, o) => s + o.ndvi_mean, 0) / validObs.length;
  const captureDate = validObs[0].capture_datetime?.slice(0, 10) ?? 'unknown';
  const sceneId = validObs[0].scene_id ?? 'unknown';
  const cloud = validObs[0].cloud_cover ?? 0;
  const sat = validObs[0].satellite ?? 'sentinel-2';

  const lines: string[] = [];
  lines.push(
    `Sentinel-2 (${sat}) capture ${captureDate}, ${cloud.toFixed(1)}% cloud cover.`,
  );
  lines.push(
    `${validObs.length}/${cycle.observations.length} parcels imaged. Mean NDVI ${ndviMean.toFixed(3)}.`,
  );

  // Per-parcel changes (only if we have a baseline)
  const withBaseline = deltas.filter(
    (d) => d.ndvi_delta != null && d.ndvi_prev != null,
  );
  if (withBaseline.length > 0) {
    const meanDelta =
      withBaseline.reduce((s, d) => s + (d.ndvi_delta ?? 0), 0) /
      withBaseline.length;
    const sign = meanDelta >= 0 ? '+' : '';
    lines.push(`Mean NDVI delta vs last cycle: ${sign}${meanDelta.toFixed(3)}.`);
  } else {
    lines.push('No prior cycle on file — this is the baseline.');
  }

  if (anomalies.length > 0) {
    const noun = anomalies.length === 1 ? 'parcel' : 'parcels';
    lines.push('');
    lines.push(`ANOMALY: ${anomalies.length} ${noun} with NDVI drop > 0.15 in 7d:`);
    for (const a of anomalies) {
      lines.push(
        `  - ${a.parcel_address}: ${a.ndvi_prev.toFixed(3)} → ${a.ndvi_now.toFixed(3)} (Δ${a.ndvi_delta.toFixed(3)} over ${a.days_between.toFixed(1)}d)`,
      );
    }
    lines.push('Recommend on-site investigation.');
  }

  if (cycle.errors.length > 0) {
    lines.push('');
    lines.push(`Errors: ${cycle.errors.length}`);
    for (const e of cycle.errors.slice(0, 3)) lines.push(`  - ${e}`);
  }

  // If pinning is enabled and we got a preview URL, surface the first one as a viewable image.
  const firstPreview = validObs.find((o) => o.preview_ipfs_url)?.preview_ipfs_url;
  if (firstPreview) {
    lines.push('');
    lines.push(`Preview image: ${firstPreview}`);
  }

  lines.push('');
  lines.push(`scene: ${sceneId}`);
  return lines.join('\n');
}

export const checkSatelliteImageryAction: Action = {
  name: 'CHECK_SATELLITE_IMAGERY',
  similes: [
    'CHECK_SATELLITE',
    'SATELLITE_CHECK',
    'NDVI_CHECK',
    'CHECK_NDVI',
    'REMOTE_SENSING',
    'CHECK_VEGETATION_INDEX',
    'PULL_SENTINEL',
  ],
  description:
    "Pull fresh Sentinel-2 imagery via Microsoft Planetary Computer and compute per-parcel NDVI/EVI. Surfaces biomass trends and anomalies (NDVI drop > 0.15 in 7 days). Output is summarized into chat and persisted to data/satellite-history.jsonl.",

  validate: async (_runtime: IAgentRuntime, message: Memory) => {
    return shouldHandle(message?.content?.text);
  },

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: Record<string, unknown> | undefined,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    try {
      const { cycle, deltas, anomalies } = await runSatelliteCycle();
      recordApiCall('satellite', true);

      const summary = summarizeCycle(cycle, deltas, anomalies);
      logger.info(`[satellite] cycle ${cycle.cycle_id} complete: ${summary.split('\n')[1]}`);

      await callback?.({
        text: summary,
        action: 'CHECK_SATELLITE_IMAGERY',
      });

      return {
        success: true,
        text: summary,
        values: {
          cycleId: cycle.cycle_id,
          observationsCount: cycle.observations.length,
          anomaliesCount: anomalies.length,
        },
        data: {
          actionName: 'CHECK_SATELLITE_IMAGERY',
          cycle,
          deltas,
          anomalies,
        },
      };
    } catch (e) {
      const msg = getErrorMessage(e);
      logger.error(`[satellite] cycle failed: ${msg}`);
      recordApiCall('satellite', false);
      await callback?.({
        text: `Satellite check failed: ${msg}`,
        error: true,
      });
      return {
        success: false,
        error: e instanceof Error ? e : new Error(msg),
      };
    }
  },

  examples: [
    [
      { name: 'user', content: { text: 'Check the satellite imagery for the parcels.' } },
      {
        name: 'Dryad',
        content: {
          text: 'Pulling latest Sentinel-2 cycle...',
          action: 'CHECK_SATELLITE_IMAGERY',
        },
      },
    ],
    [
      { name: 'user', content: { text: 'What is the NDVI trend on the lots?' } },
      {
        name: 'Dryad',
        content: {
          text: 'Pulling fresh NDVI data from Microsoft Planetary Computer...',
          action: 'CHECK_SATELLITE_IMAGERY',
        },
      },
    ],
  ],
};
