import { useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react/esm/core';
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Plus, Minus, RotateCcw } from 'lucide-react';
import type { DistrictLitigation } from '@/lib/dashboardQueries';

// Register only the ECharts modules we use (tree-shakeable core build).
echarts.use([MapChart, TooltipComponent, VisualMapComponent, CanvasRenderer]);

/**
 * Tamil Nadu Litigation Heat Map — Apache ECharts choropleth (React 19 safe).
 *
 * Renders real district boundaries from a bundled GeoJSON, shaded by total case
 * load (green = lowest → orange → red = highest). Supports pan/zoom with
 * on-screen controls, a rich hover tooltip and click-to-drill-down. No
 * react-simple-maps — builds cleanly on React 19 / Vercel with no peer conflicts.
 */

const GEO_URL = '/tn-districts.geojson';
const MAP_NAME = 'tamilnadu';
const DEFAULT_ZOOM = 1.2;
const DEFAULT_CENTER: [number, number] = [78.5, 11.0];
const NO_DATA = '#e2e8f0';   // slate-200 — districts with no recorded cases

// Normalise a district name so GeoJSON spellings line up with cases.district.
function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z]/g, '');
}

// Common spelling variants between the GeoJSON and stored case districts.
const ALIASES: Record<string, string> = {
  trichy: 'tiruchirappalli',
  tiruchirapalli: 'tiruchirappalli',
  tuticorin: 'thoothukkudi',
  thuthukudi: 'thoothukkudi',
  kanniyakumari: 'kanyakumari',
  villupuram: 'viluppuram',
  tirupattur: 'tirupathur',
  tiruppattur: 'tirupathur',
  kanchipuram: 'kancheepuram',
  thenilgiris: 'nilgiris',
  virudunagar: 'virudhunagar',
  nagappattinam: 'nagapattinam',
};

function canon(s: string): string {
  const n = norm(s);
  return ALIASES[n] ?? n;
}

interface DistrictDatum {
  name: string;
  value: number;        // total cases — drives the colour scale
}

export function TNDistrictMap({
  districts, selected, onSelect, loading,
}: {
  districts: DistrictLitigation[];
  selected: string | null;
  onSelect: (district: string) => void;
  loading: boolean;
}) {
  const chartRef = useRef<ReactECharts>(null);
  const [mapReady, setMapReady] = useState(false);
  const [geoNames, setGeoNames] = useState<string[]>([]);
  const [view, setView] = useState<{ zoom: number; center: [number, number] }>({
    zoom: DEFAULT_ZOOM, center: DEFAULT_CENTER,
  });

  // Load + register the GeoJSON once (served same-origin from /public).
  useEffect(() => {
    let active = true;
    fetch(GEO_URL)
      .then(r => r.json())
      .then((geo: { features?: { properties?: Record<string, unknown> }[] }) => {
        if (!active) return;
        echarts.registerMap(MAP_NAME, geo as Parameters<typeof echarts.registerMap>[1]);
        const names = (geo.features ?? [])
          .map(f => (f.properties?.district as string) ?? '')
          .filter(Boolean);
        setGeoNames(names);
        setMapReady(true);
      })
      .catch(() => { if (active) setMapReady(false); });
    return () => { active = false; };
  }, []);

  // Merge case totals onto every GeoJSON district by canonical name so colours
  // line up with the boundary even with spelling variants.
  const { data, max } = useMemo(() => {
    const litByCanon = new Map<string, DistrictLitigation>();
    let max = 0;
    for (const d of districts) {
      litByCanon.set(canon(d.district), d);
      if (d.total > max) max = d.total;
    }
    const data: DistrictDatum[] = geoNames.map(name => ({
      name,
      value: litByCanon.get(canon(name))?.total ?? 0,
    }));
    return { data, max };
  }, [districts, geoNames]);

  const selectedName = useMemo(() => {
    if (!selected) return null;
    const key = canon(selected);
    return geoNames.find(n => canon(n) === key) ?? null;
  }, [selected, geoNames]);

  const option = useMemo(() => ({
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: '#0f172a',
      borderColor: '#0f172a',
      textStyle: { color: '#fff', fontSize: 12 },
      formatter: (p: { name: string; data?: DistrictDatum }) => {
        const v = p.data?.value ?? 0;
        return (
          `<div style="min-width:140px">` +
          `<div style="font-weight:700;margin-bottom:2px">${p.name}</div>` +
          `<div style="display:flex;justify-content:space-between;gap:18px"><span>Total Cases</span><b>${v}</b></div>` +
          `<div style="margin-top:3px;opacity:.7;font-size:11px">${v > 0 ? 'Click for full analytics' : 'No recorded cases'}</div>` +
          `</div>`
        );
      },
    },
    visualMap: {
      min: 0,
      max: Math.max(1, max),
      left: 8,
      bottom: 8,
      calculable: true,
      itemHeight: 120,
      text: ['High', 'Low'],
      textStyle: { fontSize: 11 },
      inRange: { color: ['#22c55e', '#f97316', '#dc2626'] },
    },
    series: [{
      name: 'Litigation',
      type: 'map' as const,
      map: MAP_NAME,
      nameProperty: 'district',
      roam: true,
      zoom: view.zoom,
      center: view.center,
      layoutCenter: ['50%', '50%'],
      layoutSize: '100%',
      scaleLimit: { min: 1, max: 12 },
      selectedMode: 'single' as const,
      label: { show: false },
      itemStyle: { borderColor: '#94a3b8', borderWidth: 0.5, areaColor: NO_DATA },
      emphasis: {
        label: { show: true, fontSize: 10, color: '#0f172a' },
        itemStyle: { borderColor: '#1d4ed8', borderWidth: 1.4 },
      },
      select: {
        label: { show: true, fontSize: 10, fontWeight: 'bold' as const },
        itemStyle: { borderColor: '#1d4ed8', borderWidth: 2.4, shadowBlur: 12, shadowColor: 'rgba(37,99,235,0.9)' },
      },
      data: data.map(d => (selectedName && d.name === selectedName ? { ...d, selected: true } : d)),
    }],
  }), [data, max, view, selectedName]);

  const zoomBy = (factor: number) => {
    const inst = chartRef.current?.getEchartsInstance();
    const series = inst?.getOption()?.series as Array<{ zoom?: number; center?: [number, number] }> | undefined;
    const cur = series?.[0];
    const curZoom = cur?.zoom ?? view.zoom;
    const curCenter = (cur?.center as [number, number]) ?? view.center;
    const next = Math.min(12, Math.max(1, +(curZoom * factor).toFixed(2)));
    setView({ zoom: next, center: curCenter });
  };
  const reset = () => setView({ zoom: DEFAULT_ZOOM, center: DEFAULT_CENTER });

  const onEvents = useMemo(() => ({
    click: (p: { name?: string }) => { if (p?.name) onSelect(p.name); },
  }), [onSelect]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-red-600" /> Tamil Nadu Litigation Heat Map
            </CardTitle>
            <p className="text-xs text-muted-foreground">District boundaries shaded by case load. Hover for details, click to drill down.</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={() => zoomBy(1.4)} aria-label="Zoom in" title="Zoom in"><Plus className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out"><Minus className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={reset} aria-label="Reset view" title="Reset view"><RotateCcw className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading || !mapReady ? (
          <div className="h-[460px] w-full animate-pulse rounded-md bg-muted" />
        ) : (
          <>
            <div className="overflow-hidden rounded-md border bg-slate-50">
              <ReactECharts
                ref={chartRef}
                echarts={echarts}
                option={option}
                onEvents={onEvents}
                notMerge={false}
                lazyUpdate
                style={{ height: 460, width: '100%' }}
              />
            </div>

            {/* Legend */}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="font-medium text-foreground">Litigation</span>
                <span className="inline-flex h-3 w-28 rounded" style={{ background: 'linear-gradient(to right,#22c55e,#f97316,#dc2626)' }} />
                <span>Low</span>
                <span className="ml-auto">High</span>
              </span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: NO_DATA }} /> No cases</span>
              {max > 0 && <span>Peak: <b className="text-foreground">{max}</b> cases</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
