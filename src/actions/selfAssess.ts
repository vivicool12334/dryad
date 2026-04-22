import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { getSecurityLog } from '../security/sanitize.ts';
import { getTransactionHistory } from '../security/transactionGuard.ts';
import { getAllSubmissions } from '../submissions.ts';
import { getAllContractors } from '../providers/contractorReputation.ts';
import { getCurrentSeason, getSeasonalBriefing } from '../utils/seasonalAwareness.ts';
import * as fs from 'fs';
import * as path from 'path';
import { isFileNotFoundError } from '../utils/fileErrors.ts';

// ─── Metrics tracking ───
const metrics = {
  loopExecutions: 0,
  loopSuccesses: 0,
  loopFailures: 0,
  apiCalls: {
    iNaturalist: { total: 0, failures: 0 },
    weather: { total: 0, failures: 0 },
    coinGecko: { total: 0, failures: 0 },
  },
  startTime: Date.now(),
};

export function recordLoopExecution(success: boolean): void {
  metrics.loopExecutions++;
  if (success) metrics.loopSuccesses++;
  else metrics.loopFailures++;
}

export function recordApiCall(api: 'iNaturalist' | 'weather' | 'coinGecko', success: boolean): void {
  if (metrics.apiCalls[api]) {
    metrics.apiCalls[api].total++;
    if (!success) metrics.apiCalls[api].failures++;
  }
}

function apiUptime(api: 'iNaturalist' | 'weather' | 'coinGecko'): string {
  const { total, failures } = metrics.apiCalls[api];
  if (total === 0) return 'no calls yet';
  return `${Math.round(((total - failures) / total) * 100)}% (${total - failures}/${total})`;
}

function countLearnedSpecies(): number {
  try {
    const content = fs.readFileSync(path.join(__dirname, '../knowledge/learned.md'), 'utf-8');
    return (content.match(/New species:/g) || []).length;
  } catch (error) {
    if (isFileNotFoundError(error)) return 0;
    throw error;
  }
}

export const selfAssessAction: Action = {
  name: 'SELF_ASSESS',
  similes: ['CHECK_PERFORMANCE', 'HOW_AM_I_DOING', 'AGENT_STATUS', 'PERFORMANCE_REPORT', 'STATUS_REPORT'],
  description: 'Evaluate the agent\'s operational effectiveness, API health, ecological progress, and suggest improvements.',

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
      const season = getCurrentSeason();
      const secLog = getSecurityLog();
      const txHistory = getTransactionHistory();
      const submissions = getAllSubmissions();
      const contractors = getAllContractors();
      const learnedSpecies = countLearnedSpecies();
      const uptime = Math.round((Date.now() - metrics.startTime) / 3600000);

      const suggestions: string[] = [];

      // Decision loop health
      const loopRate = metrics.loopExecutions > 0
        ? Math.round((metrics.loopSuccesses / metrics.loopExecutions) * 100)
        : 0;

      if (metrics.loopFailures > 0 && loopRate < 90) {
        suggestions.push(`Decision loop success rate is ${loopRate}% - investigate failures`);
      }

      // API health
      if (metrics.apiCalls.iNaturalist.failures > metrics.apiCalls.iNaturalist.total * 0.1) {
        suggestions.push('iNaturalist API failure rate >10% - consider increasing cache duration or adding retry logic');
      }

      // Submissions
      const verifiedSubs = submissions.filter(s => s.verified);
      const unprocessed = submissions.filter(s => !s.processed && s.verified);
      if (unprocessed.length > 5) {
        suggestions.push(`${unprocessed.length} unprocessed photo submissions - decision loop may need attention`);
      }

      // Contractors
      const activeContractors = contractors.filter(c => c.status === 'active');
      if (activeContractors.length === 0 && season.season !== 'DORMANT') {
        suggestions.push('No active contractors registered - use FIND_CONTRACTOR to discover and onboard');
      }

      // Security
      const injectionAttempts = secLog.filter(e => e.event === 'INJECTION_ATTEMPT');
      if (injectionAttempts.length > 0) {
        suggestions.push(`${injectionAttempts.length} injection attempts detected - review security log`);
      }

      // Seasonal suggestions
      if (season.season === 'EARLY_SPRING') {
        suggestions.push('EARLY_SPRING: Priority window for invasive removal before leaf-out. Schedule contractor work now.');
      }
      if (season.season === 'SPRING' && activeContractors.length === 0) {
        suggestions.push('SPRING planting window open but no contractors available - critical gap');
      }

      // Milestones
      if (metrics.loopExecutions > 10 && txHistory.length === 0) {
        suggestions.push('No payments recorded after 10+ decision cycles - are milestones being tracked?');
      }

      // Format report
      const report = `## Self-Assessment - ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Detroit', month: 'long', day: 'numeric', year: 'numeric' })}

**Uptime:** ${uptime} hours | **Season:** ${season.season}

### Decision Loop
- Executions: ${metrics.loopExecutions}
- Success rate: ${loopRate}% (${metrics.loopSuccesses} ok, ${metrics.loopFailures} failed)

### API Health
- iNaturalist: ${apiUptime('iNaturalist')}
- Weather (Open-Meteo): ${apiUptime('weather')}
- ETH Price (CoinGecko): ${apiUptime('coinGecko')}

### Community Engagement
- Photo submissions: ${submissions.length} total (${verifiedSubs.length} verified)
- New species learned: ${learnedSpecies}

### Contractors
- Registered: ${contractors.length} (${activeContractors.length} active)
- Total paid: $${txHistory.reduce((s, t) => s + t.amount, 0).toFixed(0)}
- Transactions: ${txHistory.length}

### Security
- Events logged: ${secLog.length}
- Injection attempts: ${injectionAttempts.length}

### Suggestions
${suggestions.length > 0 ? suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'No issues detected. Operating normally.'}

${getSeasonalBriefing()}`;

      await callback({ text: report, actions: ['SELF_ASSESS'], source: message.content.source });

      return {
        text: `Self-assessment complete. ${suggestions.length} suggestions.`,
        values: { success: true, loopRate, suggestions: suggestions.length },
        data: {},
        success: true,
      };
    } catch (error) {
      const msg = `Self-assessment failed: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: msg, actions: ['SELF_ASSESS'], source: message.content.source });
      return { text: msg, values: { success: false }, data: {}, success: false };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'How are you doing?' } },
      { name: 'Dryad', content: { text: 'Running a self-assessment...', actions: ['SELF_ASSESS'] } },
    ],
    [
      { name: '{{name1}}', content: { text: 'Give me a status report' } },
      { name: 'Dryad', content: { text: "I'll evaluate my performance and suggest improvements.", actions: ['SELF_ASSESS'] } },
    ],
  ],
};
