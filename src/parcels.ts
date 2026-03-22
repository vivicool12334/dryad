/**
 * Parcel data for the 9 vacant lots on 25th Street, Detroit, MI.
 * EXACT coordinates from Detroit ArcGIS Parcels API (FeatureServer/0).
 * Parcel numbers 12009482–12009490, addresses 4475–4523 25th Street.
 */

export interface Parcel {
  address: string;
  parcelNumber: string;
  lat: number;
  lng: number;
}

// Bounding box for iNaturalist API queries (wider than parcels for observation capture)
export const PARCEL_BOUNDS = {
  sw: { lat: 42.3411, lng: -83.1007 },
  ne: { lat: 42.3424, lng: -83.0994 },
  center: { lat: 42.34174, lng: -83.10007 },
};

// Individual lot centers — from ArcGIS parcel polygons (centroids)
export const PARCELS: Parcel[] = [
  { address: '4475 25th St', parcelNumber: '12009490', lat: 42.34143, lng: -83.09995 },
  { address: '4481 25th St', parcelNumber: '12009489', lat: 42.34150, lng: -83.09999 },
  { address: '4487 25th St', parcelNumber: '12009488', lat: 42.34158, lng: -83.10003 },
  { address: '4493 25th St', parcelNumber: '12009487', lat: 42.34166, lng: -83.10007 },
  { address: '4501 25th St', parcelNumber: '12009486', lat: 42.34176, lng: -83.10012 },
  { address: '4509 25th St', parcelNumber: '12009485', lat: 42.34184, lng: -83.10016 },
  { address: '4513 25th St', parcelNumber: '12009484', lat: 42.34192, lng: -83.10020 },
  { address: '4521 25th St', parcelNumber: '12009483', lat: 42.34199, lng: -83.10024 },
  { address: '4523 25th St', parcelNumber: '12009482', lat: 42.34207, lng: -83.10028 },
];

// Maximum distance in meters for a point to be "on our parcels"
export const MAX_PARCEL_DISTANCE_METERS = 50;

/**
 * Haversine distance between two GPS points in meters.
 */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Check if a GPS point falls within our parcel bounding box.
 */
export function isWithinParcels(lat: number, lng: number): boolean {
  return (
    lat >= PARCEL_BOUNDS.sw.lat &&
    lat <= PARCEL_BOUNDS.ne.lat &&
    lng >= PARCEL_BOUNDS.sw.lng &&
    lng <= PARCEL_BOUNDS.ne.lng
  );
}

/**
 * Find the nearest parcel to a GPS point.
 */
export function findNearestParcel(lat: number, lng: number): { parcel: Parcel; distance: number } {
  let nearest = PARCELS[0];
  let minDist = Infinity;
  for (const p of PARCELS) {
    const d = haversineDistance(lat, lng, p.lat, p.lng);
    if (d < minDist) {
      minDist = d;
      nearest = p;
    }
  }
  return { parcel: nearest, distance: minDist };
}
