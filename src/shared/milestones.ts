export const MILESTONE_DEFINITIONS = [
  { key: 'SiteAssessment', label: 'Site Assessment', color: '#1565c0', tag: 'assessment' },
  { key: 'InvasiveRemoval', label: 'Invasive Removal', color: '#c62828', tag: 'removal' },
  { key: 'SoilPrep', label: 'Soil Prep', color: '#6d4c41', tag: 'soil' },
  { key: 'NativePlanting', label: 'Native Planting', color: '#2e7d32', tag: 'planting' },
  { key: 'Monitoring', label: 'Monitoring', color: '#f9a825', tag: 'monitoring' },
] as const;

export type MilestoneType = (typeof MILESTONE_DEFINITIONS)[number]['key'];

export const MILESTONE_TYPES: MilestoneType[] = MILESTONE_DEFINITIONS.map((definition) => definition.key);

export function getMilestoneDefinition(index: number) {
  return MILESTONE_DEFINITIONS[Math.max(0, Math.min(index, MILESTONE_DEFINITIONS.length - 1))];
}

export function getMilestoneTypeIndex(type: MilestoneType): number {
  return MILESTONE_DEFINITIONS.findIndex((definition) => definition.key === type);
}
