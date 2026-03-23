import type { Plugin } from '@elizaos/core';
import { logger } from '@elizaos/core';

import { checkBiodiversityAction } from './actions/checkBiodiversity.ts';
import { manageDIEMAction } from './actions/manageDIEM.ts';
import { manageStETHAction } from './actions/manageStETH.ts';
import { recordMilestoneAction } from './actions/recordMilestone.ts';
import { payContractorAction } from './actions/payContractor.ts';
import { verifyAttestationAction } from './actions/verifyAttestation.ts';
import { sendEmailAction, checkEmailAction } from './actions/agentMail.ts';
import { checkWeatherAction } from './actions/checkWeather.ts';
import { findContractorAction } from './actions/findContractor.ts';
import { selfAssessAction } from './actions/selfAssess.ts';
import { checkUpdatesAction } from './actions/checkUpdates.ts';
import { communityStatsAction } from './actions/communityStats.ts';
import { generateReportAction } from './actions/generateReport.ts';
import contractorReputationProvider from './providers/contractorReputation.ts';
import { dryadRoutes } from './routes.ts';
import { DecisionLoopService } from './services/decisionLoop.ts';
import knowledgeProvider from './providers/knowledgeProvider.ts';

const dryadPlugin: Plugin = {
  name: 'dryad',
  description:
    'Autonomous land management plugin for Dryad. Manages biodiversity monitoring, DIEM tokens, stETH treasury, onchain milestones, contractor payments, attestation verification, email, photo submissions, and autonomous decision loop.',

  async init(_config: Record<string, string>) {
    logger.info('Initializing Dryad plugin');
    logger.info('Actions: checkBiodiversity, manageDIEM, manageStETH, recordMilestone, payContractor, verifyAttestation, sendEmail, checkEmail');
    logger.info('Routes: /submit, /dashboard, /api/*');
    logger.info('Services: DecisionLoopService (24-hour cycle)');
  },

  actions: [
    checkBiodiversityAction,
    manageDIEMAction,
    manageStETHAction,
    recordMilestoneAction,
    payContractorAction,
    verifyAttestationAction,
    sendEmailAction,
    checkEmailAction,
    checkWeatherAction,
    findContractorAction,
    selfAssessAction,
    checkUpdatesAction,
    communityStatsAction,
    generateReportAction,
  ],

  providers: [knowledgeProvider, contractorReputationProvider],

  routes: dryadRoutes,

  services: [DecisionLoopService],
};

export default dryadPlugin;
