/**
 * Demo-mode fetch interceptor for the external APIs Dryad depends on.
 */
import { demoLog } from '../../config/constants.ts';

export interface MockiNaturalistObs {
  taxon: {
    name: string;
    preferred_common_name: string;
    ancestry: string;
  };
  location: string; // "lat,lng"
  observed_on: string;
  quality_grade: string;
  id: number;
}

export interface MockWeatherDay {
  tempMax: number;
  tempMin: number;
  precipitation: number;
  windMax: number;
  soilTemp: number;
}

const ethPriceQueue: number[] = [];
const weatherQueue: Array<{ safe: boolean; data?: Partial<MockWeatherDay>[] }> = [];
const inatQueue: Array<{ observations: MockiNaturalistObs[] }> = [];

const DEFAULT_ETH_PRICE = 2600;

const DEFAULT_INAT_OBSERVATIONS: MockiNaturalistObs[] = [
  // P1 invasive - Common Buckthorn
  { taxon: { name: 'Rhamnus cathartica', preferred_common_name: 'Common Buckthorn', ancestry: '1/2/47126/211194/47125/47124/47602' }, location: '42.3417,-83.1001', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100001 },
  { taxon: { name: 'Rhamnus cathartica', preferred_common_name: 'Common Buckthorn', ancestry: '1/2/47126/211194/47125/47124/47602' }, location: '42.3419,-83.1003', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100002 },
  { taxon: { name: 'Rhamnus cathartica', preferred_common_name: 'Common Buckthorn', ancestry: '1/2/47126/211194/47125/47124/47602' }, location: '42.3415,-83.0998', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100003 },
  // P2 invasive - Garlic Mustard
  { taxon: { name: 'Alliaria petiolata', preferred_common_name: 'Garlic Mustard', ancestry: '1/2/47126/47125/47124/47604' }, location: '42.3418,-83.1002', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100004 },
  { taxon: { name: 'Alliaria petiolata', preferred_common_name: 'Garlic Mustard', ancestry: '1/2/47126/47125/47124/47604' }, location: '42.3416,-83.0999', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'needs_id', id: 100005 },
  // P3 - Tree of Heaven
  { taxon: { name: 'Ailanthus altissima', preferred_common_name: 'Tree of Heaven', ancestry: '1/2/47126/47125/47124/47605' }, location: '42.3420,-83.1005', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100006 },
  // Native indicators
  { taxon: { name: 'Andropogon gerardii', preferred_common_name: 'Big Bluestem', ancestry: '1/2/47163/47162/47161/47160' }, location: '42.3417,-83.1001', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100010 },
  { taxon: { name: 'Schizachyrium scoparium', preferred_common_name: 'Little Bluestem', ancestry: '1/2/47163/47162/47161/47160' }, location: '42.3418,-83.1000', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100011 },
  { taxon: { name: 'Asclepias tuberosa', preferred_common_name: 'Butterfly Milkweed', ancestry: '1/2/47126/47125/47124/47603' }, location: '42.3416,-83.1002', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100012 },
  { taxon: { name: 'Echinacea purpurea', preferred_common_name: 'Purple Coneflower', ancestry: '1/2/47126/47125/47124/47603' }, location: '42.3419,-83.1001', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100013 },
  { taxon: { name: 'Rudbeckia hirta', preferred_common_name: 'Black-eyed Susan', ancestry: '1/2/47126/47125/47124/47603' }, location: '42.3417,-83.0999', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100014 },
  { taxon: { name: 'Monarda fistulosa', preferred_common_name: 'Wild Bergamot', ancestry: '1/2/47126/47125/47124/47603' }, location: '42.3418,-83.1003', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100015 },
  { taxon: { name: 'Quercus macrocarpa', preferred_common_name: 'Bur Oak', ancestry: '1/2/47126/47125/47124/47601' }, location: '42.3415,-83.1001', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100016 },
  { taxon: { name: 'Liatris spicata', preferred_common_name: 'Blazing Star', ancestry: '1/2/47126/47125/47124/47603' }, location: '42.3417,-83.1004', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100017 },
  // Some more natives for diversity score
  { taxon: { name: 'Solidago canadensis', preferred_common_name: 'Canada Goldenrod', ancestry: '1/2/47126/47125/47124/47603' }, location: '42.3416,-83.1001', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100018 },
  { taxon: { name: 'Panicum virgatum', preferred_common_name: 'Switchgrass', ancestry: '1/2/47163/47162/47161/47160' }, location: '42.3418,-83.1001', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100019 },
  { taxon: { name: 'Sorghastrum nutans', preferred_common_name: 'Indian Grass', ancestry: '1/2/47163/47162/47161/47160' }, location: '42.3417,-83.1002', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100020 },
  { taxon: { name: 'Symphyotrichum novae-angliae', preferred_common_name: 'New England Aster', ancestry: '1/2/47126/47125/47124/47603' }, location: '42.3419,-83.1000', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100021 },
  { taxon: { name: 'Carya ovata', preferred_common_name: 'Shagbark Hickory', ancestry: '1/2/47126/47125/47124/47601' }, location: '42.3416,-83.1003', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 100022 },
];

const DEFAULT_WEATHER_SAFE: MockWeatherDay[] = [
  { tempMax: 22, tempMin: 10, precipitation: 0, windMax: 15, soilTemp: 14 },
  { tempMax: 20, tempMin: 8, precipitation: 2.5, windMax: 20, soilTemp: 13 },
  { tempMax: 24, tempMin: 12, precipitation: 0, windMax: 10, soilTemp: 15 },
  { tempMax: 19, tempMin: 7, precipitation: 0, windMax: 18, soilTemp: 12 },
  { tempMax: 21, tempMin: 9, precipitation: 1.0, windMax: 12, soilTemp: 14 },
  { tempMax: 23, tempMin: 11, precipitation: 0, windMax: 8, soilTemp: 15 },
  { tempMax: 25, tempMin: 13, precipitation: 0, windMax: 14, soilTemp: 16 },
];

let originalFetch: typeof globalThis.fetch | null = null;

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  if (url.includes('api.inaturalist.org')) {
    const obs = inatQueue.length > 0 ? inatQueue.shift()! : { observations: DEFAULT_INAT_OBSERVATIONS };
    demoLog(`iNaturalist mock → ${obs.observations.length} observations`);
    return Promise.resolve(new Response(JSON.stringify({
      total_results: obs.observations.length,
      results: obs.observations.map(o => ({
        taxon: o.taxon,
        location: o.location,
        observed_on: o.observed_on,
        quality_grade: o.quality_grade,
        id: o.id,
      })),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }

  if (url.includes('coingecko.com') || url.includes('api.coingecko')) {
    const price = ethPriceQueue.length > 0 ? ethPriceQueue.shift()! : DEFAULT_ETH_PRICE;
    demoLog(`CoinGecko mock → ETH = $${price}`);
    return Promise.resolve(new Response(JSON.stringify({
      ethereum: { usd: price },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }

  if (url.includes('api.open-meteo.com')) {
    const scenario = weatherQueue.length > 0 ? weatherQueue.shift()! : { safe: true };
    const days = scenario.data || DEFAULT_WEATHER_SAFE;
    demoLog(`Open-Meteo mock → ${scenario.safe ? 'safe' : 'UNSAFE'} conditions`);

    const dates = days.map((_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    });

    return Promise.resolve(new Response(JSON.stringify({
      daily: {
        time: dates,
        temperature_2m_max: days.map(d => d.tempMax),
        temperature_2m_min: days.map(d => d.tempMin),
        precipitation_sum: days.map(d => d.precipitation),
        wind_speed_10m_max: days.map(d => d.windMax),
      },
      hourly: {
        soil_temperature_6cm: days.flatMap(d => Array(24).fill(d.soilTemp)),
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }

  if (url.includes('yields.llama.fi') || url.includes('defillama')) {
    demoLog(`DeFi Llama mock → returning default APYs`);
    return Promise.resolve(new Response(JSON.stringify({
      data: [
        { project: 'aave-v3', chain: 'Base', symbol: 'USDC', apy: 4.8 },
        { project: 'compound-v3', chain: 'Base', symbol: 'USDC', apy: 4.3 },
        { project: 'morpho-blue', chain: 'Base', symbol: 'USDC', apy: 6.2 },
        { project: 'aerodrome-v2', chain: 'Base', symbol: 'USDC-DAI', apy: 7.9 },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }

  if (originalFetch) return originalFetch(input, init);
  return Promise.reject(new Error(`No mock for URL: ${url}`));
}

export const mockAPIs = {
  /** Intercept global fetch with mock responses */
  install() {
    if (originalFetch) return;
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch as typeof globalThis.fetch;
    demoLog('Mock API layer installed (iNaturalist, CoinGecko, Open-Meteo, DeFi Llama)');
  },

  /** Restore real fetch */
  uninstall() {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
      originalFetch = null;
      demoLog('Mock API layer removed');
    }
  },

  /** Queue a specific ETH price for the next CoinGecko call */
  queueEthPrice(price: number) {
    ethPriceQueue.push(price);
    demoLog(`Queued ETH price: $${price}`);
  },

  /** Queue unsafe weather for the next Open-Meteo call */
  queueUnsafeWeather() {
    weatherQueue.push({
      safe: false,
      data: [
        { tempMax: -5, tempMin: -12, precipitation: 25, windMax: 55, soilTemp: -2 },
        { tempMax: -3, tempMin: -10, precipitation: 15, windMax: 45, soilTemp: -1 },
        { tempMax: 0, tempMin: -8, precipitation: 10, windMax: 35, soilTemp: 0 },
        { tempMax: 2, tempMin: -5, precipitation: 5, windMax: 30, soilTemp: 1 },
        { tempMax: 5, tempMin: -2, precipitation: 0, windMax: 25, soilTemp: 3 },
        { tempMax: 8, tempMin: 0, precipitation: 0, windMax: 20, soilTemp: 5 },
        { tempMax: 10, tempMin: 2, precipitation: 0, windMax: 15, soilTemp: 7 },
      ],
    });
    demoLog('Queued unsafe weather (blizzard conditions)');
  },

  /** Queue a specific set of iNaturalist observations */
  queueINatObservations(observations: MockiNaturalistObs[]) {
    inatQueue.push({ observations });
    demoLog(`Queued ${observations.length} iNaturalist observations`);
  },

  /** Queue heavy invasive pressure. */
  queueInvasivePressure() {
    const heavyInvasives: MockiNaturalistObs[] = [];
    for (let i = 0; i < 20; i++) {
      heavyInvasives.push({
        taxon: { name: 'Rhamnus cathartica', preferred_common_name: 'Common Buckthorn', ancestry: '1/2/47126' },
        location: `42.${3415 + Math.random() * 10 | 0},-83.${998 + Math.random() * 10 | 0}`,
        observed_on: new Date().toISOString().split('T')[0],
        quality_grade: 'research',
        id: 200000 + i,
      });
    }
    heavyInvasives.push(
      { taxon: { name: 'Andropogon gerardii', preferred_common_name: 'Big Bluestem', ancestry: '1/2/47163' }, location: '42.3417,-83.1001', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 200100 },
      { taxon: { name: 'Rudbeckia hirta', preferred_common_name: 'Black-eyed Susan', ancestry: '1/2/47126' }, location: '42.3418,-83.1002', observed_on: new Date().toISOString().split('T')[0], quality_grade: 'research', id: 200101 },
    );
    inatQueue.push({ observations: heavyInvasives });
    demoLog('Queued heavy invasive pressure (20 Buckthorn + 2 natives)');
  },
};
