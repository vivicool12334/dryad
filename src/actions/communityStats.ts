import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { getAllSubmissions } from '../submissions.ts';
import { recordApiCall } from './selfAssess.ts';

const INAT_PROJECT = 'dryad-25th-street-parcels-mapping';
const INAT_BASE = 'https://api.inaturalist.org/v1';

interface CommunityMetrics {
  totalObservations: number;
  researchGradeObservations: number;
  uniqueObservers: number;
  topObservers: Array<{ username: string; count: number }>;
  speciesCount: number;
  mostRecent: { species: string; observer: string; date: string } | null;
  totalPhotoSubmissions: number;
  submissionsThisMonth: number;
  engagementTrend: 'growing' | 'stable' | 'declining';
}

// Cache
let cached: CommunityMetrics | null = null;
let cacheTime = 0;
const CACHE_MS = 6 * 3600000;

interface InatObserverResult {
  user?: {
    login?: string;
  };
  observation_count?: number;
}

interface InatObservationResult {
  taxon?: {
    preferred_common_name?: string;
    name?: string;
  };
  species_guess?: string;
  user?: {
    login?: string;
  };
  observed_on?: string;
  created_at?: string;
}

interface InatResponse<T> {
  total_results?: number;
  results?: T[];
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

export async function getCommunityMetrics(): Promise<CommunityMetrics> {
  if (cached && Date.now() - cacheTime < CACHE_MS) return cached;

  let totalObs = 0, researchGrade = 0, speciesCount = 0;
  let topObservers: Array<{ username: string; count: number }> = [];
  let mostRecent: CommunityMetrics['mostRecent'] = null;

  try {
    // Total observations
    const obsData = await fetchJSON<InatResponse<never>>(`${INAT_BASE}/observations?project_id=${INAT_PROJECT}&per_page=0`);
    totalObs = obsData.total_results || 0;

    // Research grade count
    const rgData = await fetchJSON<InatResponse<never>>(`${INAT_BASE}/observations?project_id=${INAT_PROJECT}&quality_grade=research&per_page=0`);
    researchGrade = rgData.total_results || 0;

    // Observers
    const obsrvData = await fetchJSON<InatResponse<InatObserverResult>>(`${INAT_BASE}/observations/observers?project_id=${INAT_PROJECT}&per_page=10`);
    topObservers = (obsrvData.results || []).map((r) => ({
      username: r.user?.login || '?',
      count: r.observation_count || 0,
    }));

    // Species count
    const spData = await fetchJSON<InatResponse<never>>(`${INAT_BASE}/observations/species_counts?project_id=${INAT_PROJECT}&per_page=0`);
    speciesCount = spData.total_results || 0;

    // Most recent
    const recentData = await fetchJSON<InatResponse<InatObservationResult>>(`${INAT_BASE}/observations?project_id=${INAT_PROJECT}&order=desc&order_by=created_at&per_page=1`);
    const recent = recentData.results?.[0];
    if (recent) {
      mostRecent = {
        species: recent.taxon?.preferred_common_name || recent.taxon?.name || recent.species_guess || 'Unknown',
        observer: recent.user?.login || '?',
        date: recent.observed_on || recent.created_at?.split('T')[0] || '?',
      };
    }

    recordApiCall('iNaturalist', true);
  } catch (e) {
    logger.warn({ error: e }, '[CommunityStats] iNaturalist API failed');
    recordApiCall('iNaturalist', false);
  }

  // Photo submissions
  const subs = getAllSubmissions();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const thisMonthSubs = subs.filter(s => s.submittedAt >= monthStart);

  // Trend (simple: compare observers to a baseline)
  const trend: CommunityMetrics['engagementTrend'] =
    topObservers.length > 5 ? 'growing' :
    topObservers.length > 2 ? 'stable' : 'declining';

  const metrics: CommunityMetrics = {
    totalObservations: totalObs,
    researchGradeObservations: researchGrade,
    uniqueObservers: topObservers.length,
    topObservers: topObservers.slice(0, 5),
    speciesCount,
    mostRecent: mostRecent,
    totalPhotoSubmissions: subs.length,
    submissionsThisMonth: thisMonthSubs.length,
    engagementTrend: trend,
  };

  cached = metrics;
  cacheTime = Date.now();
  return metrics;
}

export const communityStatsAction: Action = {
  name: 'COMMUNITY_STATS',
  similes: ['ENGAGEMENT_STATS', 'VOLUNTEER_COUNT', 'COMMUNITY_REPORT', 'WHO_IS_HELPING'],
  description: 'Track and report on community participation - iNaturalist observations, photo submissions, volunteer activity.',

  validate: async () => true,

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      const m = await getCommunityMetrics();

      const trendEmoji = m.engagementTrend === 'growing' ? '📈' : m.engagementTrend === 'stable' ? '➡️' : '📉';

      let text = `## Community Report\n\n`;
      text += `### iNaturalist Project\n`;
      text += `- **Observations:** ${m.totalObservations} total (${m.researchGradeObservations} research grade)\n`;
      text += `- **Unique observers:** ${m.uniqueObservers}\n`;
      text += `- **Species documented:** ${m.speciesCount}\n`;

      if (m.topObservers.length > 0) {
        text += `- **Top observers:** ${m.topObservers.map(o => `${o.username} (${o.count})`).join(', ')}\n`;
      }

      if (m.mostRecent) {
        text += `- **Most recent:** ${m.mostRecent.species} by ${m.mostRecent.observer} on ${m.mostRecent.date}\n`;
      }

      text += `\n### Photo Submissions\n`;
      text += `- **Total:** ${m.totalPhotoSubmissions}\n`;
      text += `- **This month:** ${m.submissionsThisMonth}\n`;

      text += `\n### Engagement Trend: ${trendEmoji} ${m.engagementTrend}\n\n`;

      text += `To contribute: visit the lots and photograph plants using the iNaturalist app.\n`;
      text += `Project: [inaturalist.org/projects/${INAT_PROJECT}](https://www.inaturalist.org/projects/${INAT_PROJECT})`;

      await callback({ text, actions: ['COMMUNITY_STATS'], source: message.content.source });

      return {
        text: `Community stats: ${m.totalObservations} observations from ${m.uniqueObservers} volunteers`,
        values: { success: true, observations: m.totalObservations, observers: m.uniqueObservers },
        data: {},
        success: true,
      };
    } catch (error) {
      const msg = `Community stats failed: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: msg, actions: ['COMMUNITY_STATS'], source: message.content.source });
      return { text: msg, values: { success: false }, data: {}, success: false };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'How is community engagement going?' } },
      { name: 'Dryad', content: { text: "Let me check our iNaturalist project and submission stats...", actions: ['COMMUNITY_STATS'] } },
    ],
    [
      { name: '{{name1}}', content: { text: 'How many volunteers do we have?' } },
      { name: 'Dryad', content: { text: "I'll pull the latest community participation numbers.", actions: ['COMMUNITY_STATS'] } },
    ],
  ],
};
