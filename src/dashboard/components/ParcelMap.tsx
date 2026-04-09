import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card, Loading } from '../App';

// SECURITY: Escape HTML entities in GeoJSON properties to prevent XSS
function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Parcel center points (fallback if GeoJSON fetch fails)
const PARCEL_CENTERS = [
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

const CENTER: [number, number] = [42.34174, -83.10007];

export default function ParcelMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
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

  // Initialize Leaflet map — wait for CDN script to be ready
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const tryInit = () => {
      const L = (window as any).L;
      if (!L) {
        // CDN script not loaded yet — retry
        setTimeout(tryInit, 200);
        return;
      }
      initMap(L);
    };

    const initMap = (L: any) => {

    const map = L.map(mapRef.current, {
      center: CENTER,
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
    const L = (window as any).L;
    if (!L || !mapInstanceRef.current || !mapReady) return;

    const map = mapInstanceRef.current;

    // Remove existing layers
    map.eachLayer((layer: any) => {
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
        onEachFeature: (feature: any, layer: any) => {
          const addr = escHtml(feature.properties?.address || feature.properties?.Address || feature.properties?.SITEADDRESS || 'Parcel');
          const parcelNo = escHtml(feature.properties?.parcelno || feature.properties?.parcelNumber || '');
          layer.bindPopup(`
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
      PARCEL_CENTERS.forEach(p => {
        const icon = L.divIcon({
          html: `<div style="width:12px;height:12px;border-radius:50%;background:${invasiveColor};border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>`,
          className: '',
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });
        const marker = L.marker([p.lat, p.lng], { icon });
        marker.bindPopup(`
          <div style="font-family: monospace; font-size: 12px; color: #e0e0e0;">
            <strong style="color: #4caf50">${p.address}</strong><br/>
            Parcel #${p.parcelNumber}<br/>
            <span style="color: #81c784">30 × 110 ft</span>
          </div>
        `);
        marker._dryadParcel = true;
        marker.addTo(map);
      });
    }
  }, [geojson, invasiveColor, mapReady]);

  return (
    <Card title="25th Street Parcels — Detroit, MI">
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
