/**
 * Michigan growing season awareness for SE Michigan (Zone 6a).
 * Adjusts agent behavior based on time of year.
 */

export type Season = 'DORMANT' | 'EARLY_SPRING' | 'SPRING' | 'SUMMER' | 'FALL';

export interface SeasonalContext {
  season: Season;
  description: string;
  priorities: string[];
  contractorWorkTypes: string[];
  healthScoreThresholdMultiplier: number;
  plantingAppropriate: boolean;
  mowingAppropriate: boolean;
}

export function getCurrentSeason(): SeasonalContext {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Detroit' }));
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();

  // DORMANT: Nov 1 – Mar 15
  if (month >= 11 || month < 3 || (month === 3 && day <= 15)) {
    return {
      season: 'DORMANT',
      description: 'Dormant season - minimal field activity',
      priorities: ['planning', 'soil testing', 'community outreach', 'grant applications'],
      contractorWorkTypes: ['hazard_tree_removal'],
      healthScoreThresholdMultiplier: 0.7,
      plantingAppropriate: false,
      mowingAppropriate: false,
    };
  }

  // EARLY_SPRING: Mar 16 – Apr 30
  if ((month === 3 && day > 15) || month === 4) {
    return {
      season: 'EARLY_SPRING',
      description: 'Critical invasive removal window before leaf-out',
      priorities: ['invasive removal', 'knotweed/buckthorn before leaf-out', 'soil prep'],
      contractorWorkTypes: ['invasive_removal', 'soil_prep', 'site_assessment'],
      healthScoreThresholdMultiplier: 1.2,
      plantingAppropriate: false,
      mowingAppropriate: false,
    };
  }

  // SPRING: May 1 – Jun 30
  if (month === 5 || month === 6) {
    return {
      season: 'SPRING',
      description: 'Prime planting window - bare-root oak stock goes in',
      priorities: ['planting', 'seeding', 'monitoring establishment', 'invasive removal'],
      contractorWorkTypes: ['planting', 'seeding', 'invasive_removal', 'watering'],
      healthScoreThresholdMultiplier: 1.0,
      plantingAppropriate: true,
      mowingAppropriate: false,
    };
  }

  // SUMMER: Jul 1 – Aug 31
  if (month === 7 || month === 8) {
    return {
      season: 'SUMMER',
      description: 'Monitoring intensive - iNaturalist surveys peak',
      priorities: ['monitoring', 'watering new plantings', 'community engagement', 'iNaturalist surveys'],
      contractorWorkTypes: ['monitoring', 'watering', 'spot_removal', 'mowing'],
      healthScoreThresholdMultiplier: 1.0,
      plantingAppropriate: false,
      mowingAppropriate: true,
    };
  }

  // FALL: Sep 1 – Oct 31
  return {
    season: 'FALL',
    description: 'Second planting window for woody species, fall maintenance',
    priorities: ['fall planting', 'seed collection', 'fall mowing', 'site assessment'],
    contractorWorkTypes: ['planting', 'seed_collection', 'mowing', 'site_assessment'],
    healthScoreThresholdMultiplier: 0.9,
    plantingAppropriate: true,
    mowingAppropriate: true,
  };
}

export function getSeasonalBriefing(): string {
  const ctx = getCurrentSeason();
  const now = new Date().toLocaleDateString('en-US', { timeZone: 'America/Detroit', month: 'short', day: 'numeric' });
  const threshold = Math.round(40 * ctx.healthScoreThresholdMultiplier);

  return `Season: ${ctx.season} (${now}). ${ctx.description}. ` +
    `Priorities: ${ctx.priorities.slice(0, 3).join(', ')}. ` +
    `Health threshold: ${threshold}/100 (${ctx.healthScoreThresholdMultiplier}x). ` +
    `Planting: ${ctx.plantingAppropriate ? 'YES' : 'no'}. Mowing: ${ctx.mowingAppropriate ? 'YES' : 'no'}.`;
}
