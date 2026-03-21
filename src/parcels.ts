/**
 * Parcel data for the 9 vacant lots on 25th Street, Detroit, MI.
 * GPS coordinates from U.S. Census Bureau Geocoder.
 * Each lot is 30x110ft.
 */

export interface Parcel {
  address: string;
  lat: number;
  lng: number;
}

// Individual lot coordinates (Census Bureau geocoded)
export const PARCELS: Parcel[] = [
  { address: '3904 25th St', lat: 42.337704, lng: -83.097127 },
  { address: '3908 25th St', lat: 42.337724, lng: -83.097133 },
  { address: '3912 25th St', lat: 42.337744, lng: -83.097145 },
  { address: '3916 25th St', lat: 42.337778, lng: -83.097175 },
  { address: '3920 25th St', lat: 42.337803, lng: -83.097191 },
  { address: '3924 25th St', lat: 42.337828, lng: -83.097207 },
  { address: '3928 25th St', lat: 42.337853, lng: -83.097223 },
  { address: '3932 25th St', lat: 42.337878, lng: -83.097239 },
  { address: '3936 25th St', lat: 42.337902, lng: -83.097254 },
];

// Bounding box covering all 9 lots with ~30ft buffer
export const PARCEL_BOUNDS = {
  sw: { lat: 42.33725, lng: -83.09782 },
  ne: { lat: 42.33836, lng: -83.09658 },
  center: { lat: 42.337803, lng: -83.097191 },
};

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
