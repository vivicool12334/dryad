import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card } from './ui';
import { PARCELS, PARCEL_CENTER } from '../../shared/parcels';

interface LeafletLayer {
  _dryadParcel?: boolean;
  addTo: (map: LeafletMapInstance) => unknown;
  bindPopup?: (content: string) => unknown;
}

interface LeafletMapInstance {
  eachLayer: (callback: (layer: LeafletLayer) => void) => void;
  removeLayer: (layer: LeafletLayer) => void;
  remove: () => void;
}

interface LeafletGlobal {
  map: (
    element: HTMLDivElement | null,
    options: { center: [number, number]; zoom: number; zoomControl: boolean },
  ) => LeafletMapInstance;
  tileLayer: (
    url: string,
    options: Record<string, string | number>,
  ) => { addTo: (map: LeafletMapInstance) => unknown };
  geoJSON: (
    data: unknown,
    options: {
      style: Record<string, string | number>;
      onEachFeature: (feature: ParcelFeature | undefined, layer: LeafletLayer) => void;
    },
  ) => LeafletLayer;
  divIcon: (options: {
    html: string;
    className: string;
    iconSize: [number, number];
    iconAnchor: [number, number];
  }) => unknown;
  marker: (
    coordinates: [number, number],
    options: { icon: unknown },
  ) => LeafletLayer;
}

interface ParcelFeature {
  properties?: {
  address?: string;
  Address?: string;
  SITEADDRESS?: string;
  parcelno?: string;
  parcelNumber?: string;
  };
}

// SECURITY: Escape HTML entities in GeoJSON properties to prevent XSS
function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default function ParcelMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<LeafletMapInstance | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const { data: geojson } = useQuery({
    queryKey: ['parcels-geojson'],
    queryFn: api.parcelsGeoJson,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 2,
  });

  const { data: healthTrend } = useQuery({
    queryKey: ['health-trend'],
    queryFn: () => api.healthTrend(7),
    staleTime: 5 * 60_000,
  });

  const latest = healthTrend?.latest;
  const invasiveColor = latest
    ? (latest.invasivesP1 > 0 ? '#ef5350' : latest.invasivesP2 > 0 ? '#f9a825' : '#4caf50')
    : '#4caf50';

  // Initialize Leaflet map - wait for CDN script to be ready
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const getLeaflet = (): LeafletGlobal | null => {
      const { L } = window as Window & { L?: LeafletGlobal };
      return L ?? null;
    };

    const tryInit = () => {
      const L = getLeaflet();
      if (!L) {
        // CDN script not loaded yet - retry
        setTimeout(tryInit, 200);
        return;
      }
      initMap(L);
    };

    const initMap = (L: LeafletGlobal) => {

    const map = L.map(mapRef.current, {
      center: PARCEL_CENTER,
      zoom: 18,
      zoomControl: true,
    });

    // OpenStreetMap Esri satellite tiles (free, no API key)
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 20,
      }
    ).addTo(map);

    // Hybrid labels layer on top
    L.tileLayer(
      'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { opacity: 0.7, maxZoom: 20 }
    ).addTo(map);

      mapInstanceRef.current = map;
      setMapReady(true);
    };

    tryInit();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Add/update parcel markers when map is ready
  useEffect(() => {
    const { L } = window as Window & { L?: LeafletGlobal };
    if (!L || !mapInstanceRef.current || !mapReady) return;

    const map = mapInstanceRef.current;

    // Remove existing layers
    map.eachLayer((layer: LeafletLayer) => {
      if (layer._dryadParcel) map.removeLayer(layer);
    });

    if (geojson && geojson.features && geojson.features.length > 0) {
      // Real polygon boundaries from Detroit ArcGIS
      const geoLayer = L.geoJSON(geojson, {
        style: {
          color: invasiveColor,
          weight: 2,
          opacity: 0.9,
          fillColor: invasiveColor,
          fillOpacity: 0.25,
        },
        onEachFeature: (feature: ParcelFeature | undefined, layer: LeafletLayer) => {
          const addr = escHtml(feature?.properties?.address || feature?.properties?.Address || feature?.properties?.SITEADDRESS || 'Parcel');
          const parcelNo = escHtml(feature?.properties?.parcelno || feature?.properties?.parcelNumber || '');
          layer.bindPopup?.(`
            <div style="font-family: var(--font-mono, monospace); font-size: 12px; color: #e0e0e0;">
              <strong style="color: #4caf50">${addr}</strong><br/>
              Parcel #${parcelNo}<br/>
              <span style="color: #81c784">30 × 110 ft</span>
            </div>
          `);
          layer._dryadParcel = true;
        },
      });
      geoLayer._dryadParcel = true;
      geoLayer.addTo(map);
    } else {
      // Fallback: marker pins at parcel centers
      PARCELS.forEach((parcel) => {
        const icon = L.divIcon({
          html: `<div style="width:12px;height:12px;border-radius:50%;background:${invasiveColor};border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>`,
          className: '',
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });
        const marker = L.marker([parcel.lat, parcel.lng], { icon });
        marker.bindPopup?.(`
          <div style="font-family: monospace; font-size: 12px; color: #e0e0e0;">
            <strong style="color: #4caf50">${parcel.address}</strong><br/>
            Parcel #${parcel.parcelNumber}<br/>
            <span style="color: #81c784">30 × 110 ft</span>
          </div>
        `);
        marker._dryadParcel = true;
        marker.addTo(map);
      });
    }
  }, [geojson, invasiveColor, mapReady]);

  return (
    <Card title="25th Street Parcels - Detroit, MI">
      <div style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 4 }}>
        <span>9 lots · 0.68 acres · 4475–4523 25th Street · Chadsey-Condon</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ display: 'inline-block', width: 10, height: 10, background: '#4caf50', borderRadius: 2 }} /> Healthy</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ display: 'inline-block', width: 10, height: 10, background: '#f9a825', borderRadius: 2 }} /> P2 invasives</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ display: 'inline-block', width: 10, height: 10, background: '#ef5350', borderRadius: 2 }} /> P1 invasives</span>
        </div>
      </div>
      <div ref={mapRef} style={{ height: 380, borderRadius: 8, overflow: 'hidden' }} />
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        Satellite imagery: Esri World Imagery ·{' '}
        {geojson?.features?.length
          ? <span style={{ color: 'var(--green)' }}>✓ Real parcel boundaries from Detroit ArcGIS</span>
          : <span style={{ color: 'var(--text-dim)' }}>Parcel center markers (boundary data unavailable)</span>
        }
      </div>
    </Card>
  );
}
