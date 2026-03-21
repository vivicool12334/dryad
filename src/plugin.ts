import type { Plugin } from '@elizaos/core';
import { logger } from '@elizaos/core';

import { checkBiodiversityAction } from './actions/checkBiodiversity.ts';
import { manageDIEMAction } from './actions/manageDIEM.ts';
import { manageStETHAction } from './actions/manageStETH.ts';
import { recordMilestoneAction } from './actions/recordMilestone.ts';
import { payContractorAction } from './actions/payContractor.ts';
import { verifyAttestationAction } from './actions/verifyAttestation.ts';
import { sendEmailAction, checkEmailAction } from './actions/agentMail.ts';

const dryadPlugin: Plugin = {
  name: 'dryad',
  description:
    'Autonomous land management plugin for Dryad. Manages biodiversity monitoring, DIEM tokens, stETH treasury, onchain milestones, contractor payments, attestation verification, and email communication.',

  async init(_config: Record<string, string>) {
    logger.info('Initializing Dryad plugin');
    logger.info('Actions: checkBiodiversity, manageDIEM, manageStETH, recordMilestone, payContractor, verifyAttestation');
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
  ],
};

export default dryadPlugin;
