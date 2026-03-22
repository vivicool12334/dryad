/**
 * Parcel data for the 9 vacant lots on 25th Street between Ash and Beech, Detroit, MI.
 * Corrected GPS coordinates from landowner.
 * Each lot is 30x110ft.
 */

export interface Parcel {
  address: string;
  lat: number;
  lng: number;
}

// Bounding box covering all 9 lots (corrected coordinates from landowner)
// NW corner: 42.3295, -83.1065
// SE corner: 42.3285, -83.1050
export const PARCEL_BOUNDS = {
  sw: { lat: 42.3285, lng: -83.1065 },
  ne: { lat: 42.3295, lng: -83.1050 },
  center: { lat: 42.3290, lng: -83.10575 },
};

// Individual lot coordinates (interpolated evenly across the block, north to south)
export const PARCELS: Parcel[] = [
  { address: '3904 25th St', lat: 42.32855, lng: -83.10575 },
  { address: '3908 25th St', lat: 42.32867, lng: -83.10575 },
  { address: '3912 25th St', lat: 42.32879, lng: -83.10575 },
  { address: '3916 25th St', lat: 42.32891, lng: -83.10575 },
  { address: '3920 25th St', lat: 42.32900, lng: -83.10575 },
  { address: '3924 25th St', lat: 42.32912, lng: -83.10575 },
  { address: '3928 25th St', lat: 42.32924, lng: -83.10575 },
  { address: '3932 25th St', lat: 42.32936, lng: -83.10575 },
  { address: '3936 25th St', lat: 42.32945, lng: -83.10575 },
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
