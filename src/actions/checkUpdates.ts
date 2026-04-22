import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import * as fs from 'fs';
import * as path from 'path';

const PACKAGES_TO_CHECK = [
  '@elizaos/core',
  '@elizaos/cli',
  '@elizaos/plugin-sql',
  '@elizaos/plugin-venice',
  '@elizaos/plugin-evm',
  '@elizaos/plugin-bootstrap',
];

interface VersionCheck {
  package: string;
  current: string;
  latest: string;
  updateType: 'major' | 'minor' | 'patch' | 'up-to-date' | 'error';
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface NpmLatestVersionResponse {
  version?: string;
}

function compareVersions(current: string, latest: string): 'major' | 'minor' | 'patch' | 'up-to-date' {
  const c = current.replace(/^\^|~/, '').split('.').map(Number);
  const l = latest.split('.').map(Number);
  if (c[0] !== l[0]) return 'major';
  if (c[1] !== l[1]) return 'minor';
  if (c[2] !== l[2]) return 'patch';
  return 'up-to-date';
}

export const checkUpdatesAction: Action = {
  name: 'CHECK_UPDATES',
  similes: ['CHECK_VERSION', 'SOFTWARE_UPDATES', 'UPDATE_CHECK', 'AM_I_UP_TO_DATE'],
  description: 'Check if elizaOS or plugins have updates available on npm. Reports only - does NOT auto-update.',

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
      // Read current versions from package.json
      let pkgJson: PackageManifest;
      try {
        const pkgPath = path.join(process.cwd(), 'package.json');
        pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as PackageManifest;
      } catch {
        throw new Error('Could not read package.json');
      }

      const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
      const results: VersionCheck[] = [];

      for (const pkg of PACKAGES_TO_CHECK) {
        const current = deps[pkg];
        if (!current) {
          results.push({ package: pkg, current: 'not installed', latest: '?', updateType: 'error' });
          continue;
        }

        try {
          const res = await fetch(`https://registry.npmjs.org/${pkg}/latest`, { signal: AbortSignal.timeout(3000) });
          if (!res.ok) throw new Error(`${res.status}`);
          const data = await res.json() as NpmLatestVersionResponse;
          if (!data.version) throw new Error('Missing version in npm response');
          const latest = data.version;
          const updateType = compareVersions(current, latest);
          results.push({ package: pkg, current, latest, updateType });
        } catch {
          results.push({ package: pkg, current, latest: 'check failed', updateType: 'error' });
        }
      }

      const hasUpdates = results.some(r => r.updateType !== 'up-to-date' && r.updateType !== 'error');
      const hasMajor = results.some(r => r.updateType === 'major');

      let report = `## Software Update Check\n\n`;
      report += `**Node.js:** ${process.version}\n\n`;

      for (const r of results) {
        const icon = r.updateType === 'up-to-date' ? '✅' :
          r.updateType === 'major' ? '🔴' :
          r.updateType === 'minor' ? '🟡' :
          r.updateType === 'patch' ? '🟢' : '⚪';

        report += `${icon} **${r.package}:** ${r.current}`;
        if (r.updateType !== 'up-to-date' && r.updateType !== 'error') {
          report += ` → ${r.latest} (${r.updateType.toUpperCase()})`;
        } else if (r.updateType === 'up-to-date') {
          report += ' (up to date)';
        } else {
          report += ` (${r.latest})`;
        }
        report += '\n';
      }

      if (hasUpdates) {
        report += `\n### Recommendation\n`;
        if (hasMajor) {
          report += `🔴 **Major version changes detected** - review changelogs before updating. May contain breaking changes.\n`;
        } else {
          report += `Updates available. Safe to apply during next maintenance window.\n`;
          report += `Run: \`bun update ${results.filter(r => r.updateType !== 'up-to-date' && r.updateType !== 'error').map(r => r.package).join(' ')}\`\n`;
        }
      } else {
        report += `\nAll packages are up to date.\n`;
      }

      report += `\n*The agent does NOT auto-update. Nick applies updates manually.*`;

      await callback({ text: report, actions: ['CHECK_UPDATES'], source: message.content.source });

      return {
        text: `Update check complete. ${results.filter(r => r.updateType !== 'up-to-date' && r.updateType !== 'error').length} updates available.`,
        values: { success: true, hasUpdates },
        data: {},
        success: true,
      };
    } catch (error) {
      const msg = `Update check failed: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: msg, actions: ['CHECK_UPDATES'], source: message.content.source });
      return { text: msg, values: { success: false }, data: {}, success: false };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: 'Check for software updates' } },
      { name: 'Dryad', content: { text: "Checking npm registry for elizaOS and plugin updates...", actions: ['CHECK_UPDATES'] } },
    ],
    [
      { name: '{{name1}}', content: { text: 'Am I running the latest version?' } },
      { name: 'Dryad', content: { text: "Let me check your package versions against the npm registry.", actions: ['CHECK_UPDATES'] } },
    ],
  ],
};
