export type SpendingMode = 'NORMAL' | 'CONSERVATION' | 'CRITICAL';

export const ANNUAL_OPERATING_COST_USD = 945;
export const NON_NEGOTIABLE_ANNUAL_COST_USD = 383;

export const SPENDING_MODE_META = {
  NORMAL: {
    badgeColor: 'green',
    cssColor: 'var(--green)',
    description: 'All operations active. Yield covers full annual costs.',
  },
  CONSERVATION: {
    badgeColor: 'amber',
    cssColor: 'var(--amber)',
    description: 'Discretionary contractor jobs paused. Monitoring + taxes + VPS continue.',
  },
  CRITICAL: {
    badgeColor: 'red',
    cssColor: 'var(--red)',
    description: 'Yield insufficient for core costs. Steward intervention needed.',
  },
} as const;

export function getSpendingMode(
  annualYield: number,
  annualOperatingCost: number = ANNUAL_OPERATING_COST_USD,
  nonNegotiableAnnualCost: number = NON_NEGOTIABLE_ANNUAL_COST_USD,
): SpendingMode {
  if (annualYield >= annualOperatingCost) return 'NORMAL';
  if (annualYield >= nonNegotiableAnnualCost) return 'CONSERVATION';
  return 'CRITICAL';
}
