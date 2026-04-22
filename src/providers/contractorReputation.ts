/**
 * Contractor reputation tracking provider.
 * Stores performance data, computes reliability/quality scores,
 * and recommends the best contractor for a given service type.
 */
import type { Provider, IAgentRuntime, Memory, State, ProviderResult } from '@elizaos/core';
import * as fs from 'fs';
import * as path from 'path';
import { getErrorMessage, isFileNotFoundError } from '../utils/fileErrors.ts';

export type ServiceType = 'invasive_removal' | 'planting' | 'soil_prep' | 'mowing' | 'site_assessment' | 'tree_work';
type ContractorStatus = 'prospect' | 'onboarding' | 'active' | 'inactive' | 'blocked';

export interface ContractorRecord {
  name: string;
  email: string;
  walletAddress?: string;
  services: ServiceType[];
  status: ContractorStatus;
  jobsCompleted: number;
  jobsAccepted: number;
  avgResponseTimeHours: number;
  photoVerificationPassRate: number;
  costEfficiency: number;
  reliabilityScore: number;
  qualityScore: number;
  lastJobDate?: string;
  totalPaidUsd: number;
  notes: string[];
  addedDate: string;
}

const DATA_FILE = path.join(process.cwd(), '.eliza', 'contractors.json');
let contractors: ContractorRecord[] = [];
let loaded = false;

function loadContractors(): void {
  if (loaded) return;
  try {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    contractors = JSON.parse(raw);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      contractors = [];
      loaded = true;
      return;
    }
    throw new Error(`Failed to load contractor reputation data from ${DATA_FILE}: ${getErrorMessage(error)}`);
  }
  loaded = true;
}

function saveContractors(): void {
  try {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(contractors, null, 2));
  } catch (error) {
    throw new Error(`Failed to save contractor reputation data to ${DATA_FILE}: ${getErrorMessage(error)}`);
  }
}

function persistContractorRecords<T>(mutate: () => T): T {
  loadContractors();
  const previous = structuredClone(contractors);
  try {
    const result = mutate();
    saveContractors();
    return result;
  } catch (error) {
    contractors = previous;
    throw error;
  }
}

export function getAllContractors(): ContractorRecord[] {
  loadContractors();
  return [...contractors];
}

export function addContractor(record: Omit<ContractorRecord, 'reliabilityScore' | 'qualityScore' | 'jobsCompleted' | 'jobsAccepted' | 'avgResponseTimeHours' | 'photoVerificationPassRate' | 'costEfficiency' | 'totalPaidUsd' | 'addedDate'>): ContractorRecord {
  return persistContractorRecords(() => {
    const full: ContractorRecord = {
      ...record,
      jobsCompleted: 0,
      jobsAccepted: 0,
      avgResponseTimeHours: 0,
      photoVerificationPassRate: 0,
      costEfficiency: 1.0,
      reliabilityScore: 50,
      qualityScore: 50,
      totalPaidUsd: 0,
      addedDate: new Date().toISOString().split('T')[0],
    };
    contractors.push(full);
    return full;
  });
}

export function getBestContractorForService(serviceType: ServiceType): ContractorRecord | null {
  loadContractors();
  const candidates = contractors
    .filter(c => c.status === 'active' && c.services.includes(serviceType) && c.reliabilityScore >= 70)
    .sort((a, b) => {
      // Prefer: higher reliability, higher quality, more jobs completed
      const scoreA = a.reliabilityScore * 0.4 + a.qualityScore * 0.4 + Math.min(a.jobsCompleted * 5, 20);
      const scoreB = b.reliabilityScore * 0.4 + b.qualityScore * 0.4 + Math.min(b.jobsCompleted * 5, 20);
      return scoreB - scoreA;
    });
  return candidates[0] || null;
}

// Provider for elizaOS
const contractorReputationProvider: Provider = {
  name: 'contractor-reputation',
  description: 'Contractor performance tracking and reputation scoring',

  async get(_runtime: IAgentRuntime, message: Memory, _state?: State): Promise<ProviderResult> {
    const text = (message.content?.text || '').toLowerCase();
    if (!/contractor|hire|worker|removal|planting|mow/.test(text)) {
      return { text: '', values: {}, data: {} };
    }

    loadContractors();
    if (contractors.length === 0) {
      return {
        text: 'CONTRACTOR REGISTRY: No contractors registered yet. Use FIND_CONTRACTOR to discover and onboard new contractors.',
        values: {},
        data: {},
      };
    }

    const active = contractors.filter(c => c.status === 'active');
    const summary = active.map(c =>
      `- ${c.name} (${c.services.join(', ')}): reliability ${c.reliabilityScore}/100, ${c.jobsCompleted} jobs, $${c.totalPaidUsd} total paid`
    ).join('\n');

    return {
      text: `CONTRACTOR REGISTRY:\n${active.length} active contractors:\n${summary || 'None active'}`,
      values: {},
      data: {},
    };
  },
};

export default contractorReputationProvider;
