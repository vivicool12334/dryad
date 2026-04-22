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
} as const;

// Individual lot centers - from ArcGIS parcel polygons (centroids)
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

export const PARCEL_ADDRESSES = PARCELS.map((parcel) => parcel.address);

export const PARCEL_CENTER: [number, number] = [PARCEL_BOUNDS.center.lat, PARCEL_BOUNDS.center.lng];
