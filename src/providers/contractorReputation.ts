/**
 * Contractor reputation tracking provider.
 * Stores performance data, computes reliability/quality scores,
 * and recommends the best contractor for a given service type.
 */
import type { Provider, IAgentRuntime, Memory, State, ProviderResult } from '@elizaos/core';
import * as fs from 'fs';
import * as path from 'path';

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
  } catch {
    contractors = [];
  }
  loaded = true;
}

function saveContractors(): void {
  try {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(contractors, null, 2));
  } catch (e) {
    console.error('Failed to save contractors:', e);
  }
}

export function getContractor(email: string): ContractorRecord | undefined {
  loadContractors();
  return contractors.find(c => c.email.toLowerCase() === email.toLowerCase());
}

export function getAllContractors(): ContractorRecord[] {
  loadContractors();
  return [...contractors];
}

export function addContractor(record: Omit<ContractorRecord, 'reliabilityScore' | 'qualityScore' | 'jobsCompleted' | 'jobsAccepted' | 'avgResponseTimeHours' | 'photoVerificationPassRate' | 'costEfficiency' | 'totalPaidUsd' | 'addedDate'>): ContractorRecord {
  loadContractors();
  const full: ContractorRecord = {
    ...record,
    jobsCompleted: 0,
    jobsAccepted: 0,
    avgResponseTimeHours: 0,
    photoVerificationPassRate: 0,
    costEfficiency: 1.0,
    reliabilityScore: 50, // Neutral start
    qualityScore: 50,
    totalPaidUsd: 0,
    addedDate: new Date().toISOString().split('T')[0],
  };
  contractors.push(full);
  saveContractors();
  return full;
}

export function updateContractor(email: string, updates: Partial<ContractorRecord>): ContractorRecord | undefined {
  loadContractors();
  const idx = contractors.findIndex(c => c.email.toLowerCase() === email.toLowerCase());
  if (idx === -1) return undefined;
  contractors[idx] = { ...contractors[idx], ...updates };
  // Recompute reliability
  const c = contractors[idx];
  if (c.jobsAccepted > 0) {
    c.reliabilityScore = Math.round((c.jobsCompleted / c.jobsAccepted) * 100);
  }
  saveContractors();
  return contractors[idx];
}

export function recordJobCompletion(email: string, paidUsd: number): void {
  loadContractors();
  const c = contractors.find(ct => ct.email.toLowerCase() === email.toLowerCase());
  if (!c) return;
  c.jobsCompleted++;
  c.totalPaidUsd += paidUsd;
  c.lastJobDate = new Date().toISOString().split('T')[0];
  if (c.jobsAccepted > 0) c.reliabilityScore = Math.round((c.jobsCompleted / c.jobsAccepted) * 100);
  saveContractors();
}

export function recordPhotoVerification(email: string, passed: boolean): void {
  loadContractors();
  const c = contractors.find(ct => ct.email.toLowerCase() === email.toLowerCase());
  if (!c) return;
  const total = c.jobsCompleted + 1;
  const passCount = Math.round(c.photoVerificationPassRate * c.jobsCompleted) + (passed ? 1 : 0);
  c.photoVerificationPassRate = passCount / total;
  saveContractors();
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
