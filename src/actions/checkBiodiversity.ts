import type { Action, ActionResult, Content, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { PARCEL_BOUNDS, isWithinParcels, findNearestParcel, MAX_PARCEL_DISTANCE_METERS } from '../parcels.ts';
import * as fs from 'fs';
import * as path from 'path';
import { recordApiCall } from './selfAssess.ts';

// Three-tier MNFI-sourced invasive species priority system
export const INVASIVE_PRIORITY_1: Record<string, string> = {
  // Aggressive woody invaders - triggers contractor hiring
  'Rhamnus': 'Common Buckthorn',
  'Frangula': 'Glossy Buckthorn',
  'Elaeagnus': 'Autumn Olive',
  'Lonicera': 'Amur Honeysuckle',
  'Rosa': 'Multiflora Rose',
  'Celastrus': 'Oriental Bittersweet',
};

export const INVASIVE_PRIORITY_2: Record<string, string> = {
  // Aggressive herbaceous invaders - triggers monitoring alerts
  'Phalaris': 'Reed Canary Grass',
  'Lythrum': 'Purple Loosestrife',
  'Centaurea': 'Spotted Knapweed',
  'Alliaria': 'Garlic Mustard',
  'Reynoutria': 'Japanese Knotweed',
};

export const INVASIVE_PRIORITY_3: Record<string, string> = {
  'Ailanthus': 'Tree of Heaven',
};

// Combined flat map for backward compatibility
export const INVASIVE_SPECIES: Record<string, string> = {
  ...INVASIVE_PRIORITY_1,
  ...INVASIVE_PRIORITY_2,
  ...INVASIVE_PRIORITY_3,
  'Phragmites': 'Common Reed (non-native)', // Note: native subsp. americanus should be left alone
};

// Native indicator species - bonus for health score
const NATIVE_INDICATORS: string[] = [
  'Andropogon', 'Schizachyrium', 'Sorghastrum', 'Panicum', // prairie grasses
  'Asclepias', 'Echinacea', 'Rudbeckia', 'Monarda', 'Liatris', // key forbs
  'Quercus', 'Carya', // oaks, hickories
  'Solidago', 'Aster', 'Symphyotrichum', // goldenrods, asters
];

const INATURALIST_BASE = 'https://api.inaturalist.org/v1/observations';

interface Observation {
  id: number;
  species_guess: string | null;
  taxon?: {
    name: string;
    preferred_common_name?: string;
  };
  observed_on: string | null;
  location?: string; // "lat,lng" string
  quality_grade: string;
}

function parseLocation(location: string | undefined): { lat: number; lng: number } | null {
  if (!location) return null;
  const parts = location.split(',');
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

export const checkBiodiversityAction: Action = {
  name: 'CHECK_BIODIVERSITY',
  similes: ['BIODIVERSITY_CHECK', 'SCAN_SPECIES', 'CHECK_INVASIVES', 'ECOLOGICAL_SURVEY'],
  description:
    'Check biodiversity data from iNaturalist for the Detroit 25th Street parcels. Only includes observations that fall within the actual parcel boundaries. Detects invasive species and computes an ecosystem health score.',

  validate: async (_runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
    return true;
  },

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      logger.info('Checking biodiversity via iNaturalist API (parcel-filtered)');

      // Use bounding box query instead of radius - iNaturalist supports nelat/nelng/swlat/swlng
      const { sw, ne } = PARCEL_BOUNDS;
      const url = `${INATURALIST_BASE}?nelat=${ne.lat}&nelng=${ne.lng}&swlat=${sw.lat}&swlng=${sw.lng}&per_page=200&taxon_name=Plantae&order_by=observed_on`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`iNaturalist API returned ${response.status}`);
      }

      const data = (await response.json()) as { total_results: number; results: Observation[] };

      // Second-pass filter: only keep observations actually within parcel distance
      const onParcelObs: Array<Observation & { nearestParcel: string }> = [];
      let totalFetched = data.results.length;

      for (const obs of data.results) {
        const loc = parseLocation(obs.location);
        if (!loc) continue;

        if (isWithinParcels(loc.lat, loc.lng)) {
          const { parcel } = findNearestParcel(loc.lat, loc.lng);
          onParcelObs.push({ ...obs, nearestParcel: parcel.address });
        }
      }

      // Detect invasive species by priority tier (only from on-parcel observations)
      const invasivesFound: Array<{ scientific: string; common: string; priority: number; count: number; latestDate: string | null; parcels: Set<string> }> = [];
      const nativeSpecies: Set<string> = new Set();
      let nativeIndicatorCount = 0;
      const invasiveCounts: Record<string, { count: number; priority: number; latestDate: string | null; parcels: Set<string> }> = {};

      // Priority-ordered invasive lookup
      const priorityLists: Array<[Record<string, string>, number]> = [
        [INVASIVE_PRIORITY_1, 1],
        [INVASIVE_PRIORITY_2, 2],
        [INVASIVE_PRIORITY_3, 3],
        [{ 'Phragmites': 'Common Reed (non-native)' }, 2], // Non-native Phragmites
      ];

      for (const obs of onParcelObs) {
        const taxonName = obs.taxon?.name || obs.species_guess || '';
        const lowerName = taxonName.toLowerCase();

        // Skip native Phragmites (subsp. americanus)
        if (lowerName.includes('phragmites') && lowerName.includes('americanus')) {
          nativeSpecies.add('Phragmites australis subsp. americanus (native)');
          continue;
        }

        let isInvasive = false;
        for (const [list, priority] of priorityLists) {
          for (const [genus, commonName] of Object.entries(list)) {
            if (lowerName.includes(genus.toLowerCase())) {
              isInvasive = true;
              if (!invasiveCounts[genus]) {
                invasiveCounts[genus] = { count: 0, priority, latestDate: null, parcels: new Set() };
              }
              invasiveCounts[genus].count++;
              invasiveCounts[genus].parcels.add(obs.nearestParcel);
              if (obs.observed_on && (!invasiveCounts[genus].latestDate || obs.observed_on > invasiveCounts[genus].latestDate)) {
                invasiveCounts[genus].latestDate = obs.observed_on;
              }
              break;
            }
          }
          if (isInvasive) break;
        }

        if (!isInvasive && obs.taxon?.name) {
          nativeSpecies.add(obs.taxon.preferred_common_name || obs.taxon.name);
          // Check for native indicator species (lakeplain community)
          for (const indicator of NATIVE_INDICATORS) {
            if (lowerName.includes(indicator.toLowerCase())) {
              nativeIndicatorCount++;
              break;
            }
          }
        }
      }

      for (const [genus, d] of Object.entries(invasiveCounts)) {
        invasivesFound.push({
          scientific: genus,
          common: INVASIVE_SPECIES[genus] || genus,
          priority: d.priority,
          count: d.count,
          latestDate: d.latestDate,
          parcels: d.parcels,
        });
      }
      // Sort by priority (1 = most urgent)
      invasivesFound.sort((a, b) => a.priority - b.priority);

      // Compute health score (0-100) - weighted by priority tier and native indicators
      const p1Count = invasivesFound.filter((i) => i.priority === 1).reduce((s, i) => s + i.count, 0);
      const p2Count = invasivesFound.filter((i) => i.priority === 2).reduce((s, i) => s + i.count, 0);
      const p3Count = invasivesFound.filter((i) => i.priority === 3).reduce((s, i) => s + i.count, 0);
      const weightedInvasive = p1Count * 3 + p2Count * 2 + p3Count * 1; // P1 weighted 3x
      const invasiveRatio = onParcelObs.length > 0 ? Math.min(weightedInvasive / (onParcelObs.length * 2), 1) : 0;
      const speciesDiversity = nativeSpecies.size;
      const diversityScore = Math.min(speciesDiversity / 20, 1) * 40; // 40 points for diversity
      const invasiveScore = (1 - invasiveRatio) * 40; // 40 points for low invasive ratio
      const indicatorBonus = Math.min(nativeIndicatorCount / 5, 1) * 20; // 20 bonus for native indicators
      const healthScore = Math.round(diversityScore + invasiveScore + indicatorBonus);

      // ── Observation Learning: record new species to learned.md ──
      try {
        const learnedPath = path.join(__dirname, '../knowledge/learned.md');
        let learnedContent = fs.readFileSync(learnedPath, 'utf-8');
        const allKnownGenera = [...Object.keys(INVASIVE_SPECIES), ...NATIVE_INDICATORS];

        for (const obs of onParcelObs) {
          const species = obs.taxon?.name;
          if (!species) continue;
          const isKnown = allKnownGenera.some(g => species.toLowerCase().includes(g.toLowerCase()));
          if (!isKnown && !learnedContent.includes(species)) {
            const commonName = obs.taxon?.preferred_common_name || 'no common name';
            const entry = `\n- [${new Date().toISOString().split('T')[0]}] New species: **${species}** (${commonName}) at ${obs.nearestParcel}. Observer: ${obs.quality_grade}. Needs classification.`;
            learnedContent = learnedContent.replace('## New Species Observations\n', '## New Species Observations\n' + entry);
            fs.writeFileSync(learnedPath, learnedContent, 'utf-8');
            logger.info(`[Dryad] Learned new species: ${species} (${commonName})`);
          }
        }
      } catch (e) {
        // Non-critical - don't fail the action if learning fails
      }

      recordApiCall('iNaturalist', true);

      const priorityLabels = ['', 'P1-REMOVE', 'P2-MONITOR', 'P3-ASSESS'];
      const invasiveReport =
        invasivesFound.length > 0
          ? invasivesFound
              .map(
                (i) =>
                  `- [${priorityLabels[i.priority]}] **${i.common}** (${i.scientific}): ${i.count} obs on ${Array.from(i.parcels).join(', ')}${i.latestDate ? ` - last seen ${i.latestDate}` : ''}`
              )
              .join('\n')
          : 'No invasive species detected within parcel boundaries.';

      const responseText = `## Biodiversity Report - 25th Street Parcels, Detroit

**Bounding box:** ${sw.lat.toFixed(5)},${sw.lng.toFixed(5)} to ${ne.lat.toFixed(5)},${ne.lng.toFixed(5)}
**iNaturalist observations in area:** ${totalFetched}
**On-parcel observations:** ${onParcelObs.length}
**Native species detected:** ${speciesDiversity}
**Ecosystem Health Score:** ${healthScore}/100

### Invasive Species Watch (on-parcel only)
${invasiveReport}

### Top Native Species
${Array.from(nativeSpecies).slice(0, 10).map((s) => `- ${s}`).join('\n') || 'No native species observations on parcels yet.'}

${
  invasivesFound.length > 0
    ? `\n**Action needed:** ${invasivesFound.map((i) => `${i.common} at ${Array.from(i.parcels).join(', ')}`).join('; ')}. Schedule invasive removal.`
    : '\n**Status:** No invasives detected on parcels. Continue monitoring.'
}`;

      await callback({
        text: responseText,
        actions: ['CHECK_BIODIVERSITY'],
        source: message.content.source,
      });

      return {
        text: `Biodiversity check complete. Health score: ${healthScore}/100. ${invasivesFound.length} invasive species on parcels.`,
        values: {
          success: true,
          healthScore,
          invasiveCount: invasivesFound.length,
          nativeSpeciesCount: speciesDiversity,
          onParcelObservations: onParcelObs.length,
        },
        data: {
          invasivesFound: invasivesFound.map((i) => ({ ...i, parcels: Array.from(i.parcels) })),
          nativeSpecies: Array.from(nativeSpecies),
        },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in CHECK_BIODIVERSITY action');
      const errorMsg = `Failed to check biodiversity: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: errorMsg, actions: ['CHECK_BIODIVERSITY'], source: message.content.source });
      return { text: errorMsg, values: { success: false }, data: {}, success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'Check the biodiversity on our lots' } },
      { name: 'Dryad', content: { text: 'Running parcel-filtered biodiversity analysis from iNaturalist...', actions: ['CHECK_BIODIVERSITY'] } },
    ],
    [
      { name: '{{name1}}', content: { text: 'Any invasive species on our parcels?' } },
      { name: 'Dryad', content: { text: 'Scanning for invasives within parcel boundaries only...', actions: ['CHECK_BIODIVERSITY'] } },
    ],
  ],
};
