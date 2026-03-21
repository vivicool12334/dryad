import type { Action, ActionResult, Content, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';

const INVASIVE_SPECIES: Record<string, string> = {
  'Ailanthus': 'Tree of Heaven',
  'Lonicera': 'Amur Honeysuckle',
  'Lythrum': 'Purple Loosestrife',
  'Phragmites': 'Common Reed',
  'Alliaria': 'Garlic Mustard',
  'Reynoutria': 'Japanese Knotweed',
  'Rhamnus': 'Buckthorn',
};

const INATURALIST_BASE = 'https://api.inaturalist.org/v1/observations';

// Detroit 25th Street approximate coordinates
const LAT = 42.331;
const LNG = -83.046;
const RADIUS_KM = 5;

interface Observation {
  id: number;
  species_guess: string | null;
  taxon?: {
    name: string;
    preferred_common_name?: string;
    ancestry?: string;
  };
  observed_on: string | null;
  location?: string;
  quality_grade: string;
}

export const checkBiodiversityAction: Action = {
  name: 'CHECK_BIODIVERSITY',
  similes: ['BIODIVERSITY_CHECK', 'SCAN_SPECIES', 'CHECK_INVASIVES', 'ECOLOGICAL_SURVEY'],
  description:
    'Check biodiversity data from iNaturalist for the Detroit 25th Street parcels. Detects invasive species and computes an ecosystem health score.',

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
      logger.info('Checking biodiversity via iNaturalist API');

      const url = `${INATURALIST_BASE}?lat=${LAT}&lng=${LNG}&radius=${RADIUS_KM}&per_page=200&taxon_name=Plantae&quality_grade=research&order_by=observed_on`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`iNaturalist API returned ${response.status}`);
      }

      const data = (await response.json()) as { total_results: number; results: Observation[] };
      const observations = data.results;
      const totalObservations = data.total_results;

      // Detect invasive species
      const invasivesFound: Array<{ scientific: string; common: string; count: number; latestDate: string | null }> = [];
      const nativeSpecies: Set<string> = new Set();

      const invasiveCounts: Record<string, { count: number; latestDate: string | null }> = {};

      for (const obs of observations) {
        const taxonName = obs.taxon?.name || obs.species_guess || '';

        let isInvasive = false;
        for (const [genus, commonName] of Object.entries(INVASIVE_SPECIES)) {
          if (taxonName.toLowerCase().includes(genus.toLowerCase())) {
            isInvasive = true;
            if (!invasiveCounts[genus]) {
              invasiveCounts[genus] = { count: 0, latestDate: null };
            }
            invasiveCounts[genus].count++;
            if (obs.observed_on && (!invasiveCounts[genus].latestDate || obs.observed_on > invasiveCounts[genus].latestDate)) {
              invasiveCounts[genus].latestDate = obs.observed_on;
            }
            break;
          }
        }

        if (!isInvasive && obs.taxon?.name) {
          nativeSpecies.add(obs.taxon.preferred_common_name || obs.taxon.name);
        }
      }

      for (const [genus, data] of Object.entries(invasiveCounts)) {
        invasivesFound.push({
          scientific: genus,
          common: INVASIVE_SPECIES[genus],
          count: data.count,
          latestDate: data.latestDate,
        });
      }

      // Compute health score (0-100)
      const totalInvasiveObs = invasivesFound.reduce((sum, i) => sum + i.count, 0);
      const invasiveRatio = observations.length > 0 ? totalInvasiveObs / observations.length : 0;
      const speciesDiversity = nativeSpecies.size;
      const diversityScore = Math.min(speciesDiversity / 20, 1) * 50; // Up to 50 points for diversity
      const invasiveScore = (1 - invasiveRatio) * 50; // Up to 50 points for low invasive ratio
      const healthScore = Math.round(diversityScore + invasiveScore);

      // Build response
      const invasiveReport =
        invasivesFound.length > 0
          ? invasivesFound
              .map(
                (i) =>
                  `- **${i.common}** (${i.scientific}): ${i.count} observations${i.latestDate ? `, last seen ${i.latestDate}` : ''}`
              )
              .join('\n')
          : 'No invasive species detected in recent observations.';

      const responseText = `## Biodiversity Report — 25th Street Parcels, Detroit

**Total observations:** ${totalObservations} (analyzed: ${observations.length})
**Native species detected:** ${speciesDiversity}
**Ecosystem Health Score:** ${healthScore}/100

### Invasive Species Watch
${invasiveReport}

### Top Native Species
${Array.from(nativeSpecies)
  .slice(0, 10)
  .map((s) => `- ${s}`)
  .join('\n')}

${
  invasivesFound.length > 0
    ? `\n**Recommendation:** ${invasivesFound.map((i) => i.common).join(', ')} detected. Consider scheduling invasive removal for affected parcels.`
    : '\n**Status:** Ecosystem looks healthy. Continue monitoring.'
}`;

      const responseContent: Content = {
        text: responseText,
        actions: ['CHECK_BIODIVERSITY'],
        source: message.content.source,
      };

      await callback(responseContent);

      return {
        text: `Biodiversity check complete. Health score: ${healthScore}/100. ${invasivesFound.length} invasive species detected.`,
        values: {
          success: true,
          healthScore,
          invasiveCount: invasivesFound.length,
          nativeSpeciesCount: speciesDiversity,
          totalObservations,
        },
        data: {
          invasivesFound,
          nativeSpecies: Array.from(nativeSpecies),
        },
        success: true,
      };
    } catch (error) {
      logger.error({ error }, 'Error in CHECK_BIODIVERSITY action');
      const errorMsg = `Failed to check biodiversity: ${error instanceof Error ? error.message : String(error)}`;

      await callback({
        text: errorMsg,
        actions: ['CHECK_BIODIVERSITY'],
        source: message.content.source,
      });

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
      { name: '{{name1}}', content: { text: 'Check the biodiversity on our lots' } },
      {
        name: 'Dryad',
        content: {
          text: 'Running biodiversity analysis from iNaturalist data for the 25th Street parcels...',
          actions: ['CHECK_BIODIVERSITY'],
        },
      },
    ],
    [
      { name: '{{name1}}', content: { text: 'Are there any invasive species?' } },
      {
        name: 'Dryad',
        content: {
          text: 'Let me scan for invasive species in our area using iNaturalist observations.',
          actions: ['CHECK_BIODIVERSITY'],
        },
      },
    ],
  ],
};
