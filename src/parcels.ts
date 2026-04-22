import { SUBMISSIONS } from './config/constants.ts';
import { PARCELS, PARCEL_BOUNDS, type Parcel } from './shared/parcels.ts';

export type { Parcel } from './shared/parcels.ts';
export { PARCELS, PARCEL_BOUNDS } from './shared/parcels.ts';

// Maximum distance in meters for a point to be "on our parcels"
export const MAX_PARCEL_DISTANCE_METERS = SUBMISSIONS.MAX_PARCEL_DISTANCE_METERS;

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
