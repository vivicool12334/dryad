import type { Action, ActionResult, Content, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { keccak256, toHex } from 'viem';
import { PARCELS, haversineDistance, isWithinParcels, findNearestParcel, MAX_PARCEL_DISTANCE_METERS } from '../parcels.ts';
import { getSubmissions, getAllSubmissions } from '../submissions.ts';

// Build PARCEL_COORDS from shared parcels module
const PARCEL_COORDS: Record<string, { lat: number; lng: number }> = {};
for (const p of PARCELS) {
  PARCEL_COORDS[p.address] = { lat: p.lat, lng: p.lng };
}

const MAX_DISTANCE_METERS = MAX_PARCEL_DISTANCE_METERS;
const MAX_AGE_HOURS = 72;

interface AttestationData {
  lat?: number;
  lng?: number;
  timestamp?: number;
  imageHash?: string;
  parcel?: string;
  description?: string;
  submissionId?: string;
}

function parseAttestationFromMessage(text: string): AttestationData {
  const data: AttestationData = {};

  // Check if this references a submission ID (sub_xxxxx_xxxxxx format)
  const subIdMatch = text.match(/\b(sub_[a-zA-Z0-9_]+)\b/i);
  if (subIdMatch) {
    data.submissionId = subIdMatch[1];
    // Try to load the submission and use its data
    const submission = getAllSubmissions().find(s => s.id === data.submissionId);
    if (submission) {
      data.lat = submission.exifLat ?? submission.lat;
      data.lng = submission.exifLng ?? submission.lng;
      data.timestamp = Math.floor(submission.timestamp / 1000); // Convert to seconds
      data.imageHash = submission.imageHash;
      data.parcel = submission.nearestParcel;
      data.description = submission.description;
      return data; // Return early with loaded submission data
    }
  }

  // Extract coordinates
  const latMatch = text.match(/lat[itude]*[:\s=]+(-?\d+\.?\d*)/i);
  const lngMatch = text.match(/(?:lng|lon|longitude)[:\s=]+(-?\d+\.?\d*)/i);
  if (latMatch) data.lat = parseFloat(latMatch[1]);
  if (lngMatch) data.lng = parseFloat(lngMatch[1]);

  // Extract timestamp
  const tsMatch = text.match(/timestamp[:\s=]+(\d{10,13})/i);
  if (tsMatch) {
    const ts = parseInt(tsMatch[1]);
    data.timestamp = ts > 1e12 ? Math.floor(ts / 1000) : ts; // Handle ms vs s
  }

  // Extract image hash
  const hashMatch = text.match(/(?:hash|image_hash)[:\s=]+(0x[a-fA-F0-9]{64})/i);
  if (hashMatch) data.imageHash = hashMatch[1];

  // Extract parcel
  for (const p of Object.keys(PARCEL_COORDS)) {
    const addr = p.split(' ')[0];
    if (text.includes(addr)) {
      data.parcel = p;
      break;
    }
  }

  data.description = text;
  return data;
}

export const verifyAttestationAction: Action = {
  name: 'VERIFY_ATTESTATION',
  similes: ['CHECK_ATTESTATION', 'VERIFY_PHOTO', 'VALIDATE_PROOF', 'GPS_VERIFY'],
  description:
    'Verify a GPS-tagged photo attestation. Checks: (1) GPS location matches a managed parcel, (2) timestamp is recent (within 72 hours), (3) image hash is valid.',

  validate: async (_runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
    return true;
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      logger.info('Verifying attestation');

      const attestation = parseAttestationFromMessage(message.content.text || '');

      const checks: Array<{ name: string; passed: boolean; detail: string }> = [];

      // Check 1: GPS location
      if (attestation.lat != null && attestation.lng != null && attestation.parcel) {
        const parcelCoords = PARCEL_COORDS[attestation.parcel];
        if (parcelCoords) {
          const distance = haversineDistance(attestation.lat, attestation.lng, parcelCoords.lat, parcelCoords.lng);
          const passed = distance <= MAX_DISTANCE_METERS;
          checks.push({
            name: 'GPS Location',
            passed,
            detail: `Distance to ${attestation.parcel}: ${distance.toFixed(1)}m (max: ${MAX_DISTANCE_METERS}m)`,
          });
        }
      } else if (attestation.lat != null && attestation.lng != null) {
        // Find nearest parcel
        let nearestParcel = '';
        let nearestDistance = Infinity;
        for (const [parcel, coords] of Object.entries(PARCEL_COORDS)) {
          const dist = haversineDistance(attestation.lat, attestation.lng, coords.lat, coords.lng);
          if (dist < nearestDistance) {
            nearestDistance = dist;
            nearestParcel = parcel;
          }
        }
        const passed = nearestDistance <= MAX_DISTANCE_METERS;
        checks.push({
          name: 'GPS Location',
          passed,
          detail: `Nearest parcel: ${nearestParcel} (${nearestDistance.toFixed(1)}m away, max: ${MAX_DISTANCE_METERS}m)`,
        });
      } else {
        checks.push({ name: 'GPS Location', passed: false, detail: 'No GPS coordinates provided' });
      }

      // Check 2: Timestamp
      if (attestation.timestamp) {
        const now = Math.floor(Date.now() / 1000);
        const ageHours = (now - attestation.timestamp) / 3600;
        const passed = ageHours >= 0 && ageHours <= MAX_AGE_HOURS;
        checks.push({
          name: 'Timestamp',
          passed,
          detail: `Age: ${ageHours.toFixed(1)} hours (max: ${MAX_AGE_HOURS}h)`,
        });
      } else {
        checks.push({ name: 'Timestamp', passed: false, detail: 'No timestamp provided' });
      }

      // Check 3: Image hash
      if (attestation.imageHash) {
        const validFormat = /^0x[a-fA-F0-9]{64}$/.test(attestation.imageHash);
        checks.push({
          name: 'Image Hash',
          passed: validFormat,
          detail: validFormat ? `Valid hash: ${attestation.imageHash.slice(0, 18)}...` : 'Invalid hash format',
        });
      } else {
        checks.push({ name: 'Image Hash', passed: false, detail: 'No image hash provided' });
      }

      const allPassed = checks.every((c) => c.passed);
      const passedCount = checks.filter((c) => c.passed).length;

      const responseText = `## Attestation Verification

${checks.map((c) => `${c.passed ? '✅' : '❌'} **${c.name}:** ${c.detail}`).join('\n')}

### Result: ${allPassed ? '✅ VERIFIED' : `⚠️ ${passedCount}/${checks.length} checks passed`}

${!allPassed ? 'Please provide missing or corrected data to complete verification.' : 'This attestation is valid and can be used as proof of work.'}`;

      await callback({
        text: responseText,
        actions: ['VERIFY_ATTESTATION'],
        source: message.content.source,
      });

      return {
        text: `Attestation verification: ${passedCount}/${checks.length} checks passed`,
        values: {
          success: true,
          allPassed,
          passedCount,
          totalChecks: checks.length,
        },
        data: { checks, attestation },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in VERIFY_ATTESTATION action');
      const errorMsg = `Failed to verify attestation: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: errorMsg, actions: ['VERIFY_ATTESTATION'], source: message.content.source });
      return {
        text: errorMsg,
        values: { success: false },
        data: {},
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Verify attestation: lat=42.3312 lng=-83.0465 timestamp=1711036800 hash=0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890 parcel 4501',
        },
      },
      {
        name: 'Dryad',
        content: {
          text: 'Verifying GPS-tagged attestation for parcel 4501 25th St...',
          actions: ['VERIFY_ATTESTATION'],
        },
      },
    ],
  ],
};
