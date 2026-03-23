import type { Action, ActionResult, HandlerCallback, IAgentRuntime, Memory, State } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { getCurrentSeason } from '../utils/seasonalAwareness.ts';

const API_URL = 'https://api.open-meteo.com/v1/forecast?latitude=42.3417&longitude=-83.1001&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&hourly=soil_temperature_6cm&timezone=America/Detroit&forecast_days=7';

export type WeatherFlag = 'MUDDY_CONDITIONS' | 'PLANTING_WINDOW' | 'HEAT_STRESS' | 'HIGH_WIND' | 'DROUGHT_RISK' | 'FROST_RISK';

export interface WeatherForecast {
  date: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  windMax: number;
  soilTemp: number;
}

export interface WeatherAssessment {
  forecasts: WeatherForecast[];
  flags: WeatherFlag[];
  contractorWorkSafe: boolean;
  plantingWindowOpen: boolean;
  summary: string;
}

// Cache
let cachedAssessment: WeatherAssessment | null = null;
let cacheTimestamp = 0;
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

function celsiusToF(c: number): number { return Math.round(c * 9 / 5 + 32); }

export async function getWeatherAssessment(): Promise<WeatherAssessment> {
  if (cachedAssessment && Date.now() - cacheTimestamp < CACHE_DURATION_MS) {
    return cachedAssessment;
  }

  try {
    const res = await fetch(API_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);

    const data = await res.json() as any;
    const daily = data.daily || {};
    const hourly = data.hourly || {};

    const forecasts: WeatherForecast[] = (daily.time || []).map((date: string, i: number) => ({
      date,
      tempMax: daily.temperature_2m_max?.[i] ?? 20,
      tempMin: daily.temperature_2m_min?.[i] ?? 10,
      precipitation: daily.precipitation_sum?.[i] ?? 0,
      windMax: daily.wind_speed_10m_max?.[i] ?? 10,
      soilTemp: hourly.soil_temperature_6cm?.[i * 24 + 12] ?? 10, // noon reading
    }));

    const flags: WeatherFlag[] = [];
    let contractorWorkSafe = true;
    let plantingWindowOpen = false;

    // Check 48hr rain
    const rain48h = forecasts.slice(0, 2).reduce((s, f) => s + f.precipitation, 0);
    if (rain48h > 12.7) {
      flags.push('MUDDY_CONDITIONS');
      contractorWorkSafe = false;
    }

    // Check soil temp for planting
    const avgSoilTemp = forecasts.reduce((s, f) => s + f.soilTemp, 0) / forecasts.length;
    const hasFrost = forecasts.some(f => f.tempMin < 0);
    if (avgSoilTemp > 10 && !hasFrost) {
      flags.push('PLANTING_WINDOW');
      plantingWindowOpen = true;
    }
    if (hasFrost) flags.push('FROST_RISK');

    // Heat stress
    if (forecasts.some(f => f.tempMax > 35)) flags.push('HEAT_STRESS');

    // High wind
    if (forecasts.some(f => f.windMax > 65)) {
      flags.push('HIGH_WIND');
      contractorWorkSafe = false;
    }

    // Drought (all 7 days < 2mm total)
    const totalPrecip = forecasts.reduce((s, f) => s + f.precipitation, 0);
    if (totalPrecip < 2) flags.push('DROUGHT_RISK');

    const today = forecasts[0];
    const season = getCurrentSeason();
    let summary = `${celsiusToF(today.tempMax)}°F high, ${celsiusToF(today.tempMin)}°F low today.`;

    if (today.precipitation > 0) summary += ` ${today.precipitation.toFixed(1)}mm rain expected.`;
    else summary += ' Dry.';

    if (!contractorWorkSafe) summary += ' Conditions unsafe for contractor work.';
    else summary += ' Good conditions for site work.';

    if (flags.includes('PLANTING_WINDOW')) summary += ` Soil temp ${celsiusToF(avgSoilTemp)}°F — planting window ${season.plantingAppropriate ? 'OPEN' : 'open but season not right'}.`;
    if (flags.includes('FROST_RISK')) summary += ' Frost risk in forecast.';
    if (flags.includes('DROUGHT_RISK')) summary += ' Dry stretch — monitor new plantings.';
    if (flags.includes('HEAT_STRESS')) summary += ' Extreme heat ahead — saplings may need emergency watering.';

    // Look ahead for rain
    const rainDays = forecasts.filter(f => f.precipitation > 1);
    if (rainDays.length > 0 && !flags.includes('MUDDY_CONDITIONS')) {
      summary += ` Rain expected ${rainDays[0].date} (${rainDays[0].precipitation.toFixed(1)}mm).`;
    }

    const assessment: WeatherAssessment = { forecasts, flags, contractorWorkSafe, plantingWindowOpen, summary };
    cachedAssessment = assessment;
    cacheTimestamp = Date.now();
    return assessment;

  } catch (error) {
    logger.warn({ error }, '[Weather] API failed, using safe defaults');
    return {
      forecasts: [],
      flags: [],
      contractorWorkSafe: true,
      plantingWindowOpen: false,
      summary: 'Weather data unavailable — assuming conditions are safe.',
    };
  }
}

export const checkWeatherAction: Action = {
  name: 'CHECK_WEATHER',
  similes: ['WEATHER_CHECK', 'GET_FORECAST', 'CHECK_CONDITIONS', 'WEATHER'],
  description: 'Check 7-day weather forecast for the 25th Street parcels. Includes soil temperature, precipitation, wind, and planting window assessment.',

  validate: async () => true,

  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ): Promise<ActionResult> => {
    try {
      const assessment = await getWeatherAssessment();
      const season = getCurrentSeason();

      let text = `## Weather — 25th Street Parcels\n\n`;
      text += `**${assessment.summary}**\n\n`;
      text += `**Season:** ${season.season} — ${season.description}\n\n`;

      if (assessment.flags.length > 0) {
        text += `**Active Flags:** ${assessment.flags.join(', ')}\n\n`;
      }

      text += `### 7-Day Forecast\n`;
      for (const f of assessment.forecasts) {
        const icon = f.precipitation > 1 ? '🌧' : f.tempMax > 30 ? '☀️' : '⛅';
        text += `${icon} **${f.date}** — ${celsiusToF(f.tempMax)}°F / ${celsiusToF(f.tempMin)}°F`;
        if (f.precipitation > 0) text += ` | ${f.precipitation.toFixed(1)}mm rain`;
        text += `\n`;
      }

      text += `\n**Contractor work:** ${assessment.contractorWorkSafe ? '✅ Safe' : '⚠️ Unsafe — defer'}\n`;
      text += `**Planting:** ${assessment.plantingWindowOpen ? '✅ Window open' : '❌ Not recommended'}\n`;

      await callback({ text, actions: ['CHECK_WEATHER'], source: message.content.source });

      return {
        text: assessment.summary,
        values: { success: true, contractorWorkSafe: assessment.contractorWorkSafe, flags: assessment.flags },
        data: assessment as unknown as Record<string, unknown>,
        success: true,
      };
    } catch (error) {
      const msg = `Weather check failed: ${error instanceof Error ? error.message : String(error)}`;
      await callback({ text: msg, actions: ['CHECK_WEATHER'], source: message.content.source });
      return { text: msg, values: { success: false }, data: {}, success: false };
    }
  },

  examples: [
    [
      { name: '{{name1}}', content: { text: "What's the weather like at the lots?" } },
      { name: 'Dryad', content: { text: "Let me check the forecast for the 25th Street parcels...", actions: ['CHECK_WEATHER'] } },
    ],
    [
      { name: '{{name1}}', content: { text: 'Is it safe to schedule contractor work this week?' } },
      { name: 'Dryad', content: { text: "I'll check conditions — rain and muddy soil can damage the site during removal work.", actions: ['CHECK_WEATHER'] } },
    ],
  ],
};
