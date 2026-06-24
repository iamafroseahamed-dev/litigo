import { useMemo, useState } from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { scaleLinear } from 'd3-scale';
import { Tooltip } from 'react-tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MapPin, Plus, Minus, RotateCcw } from 'lucide-react';
import type { DistrictLitigation, DistrictDetail } from '@/lib/dashboardQueries';

/**
 * Interactive Tamil Nadu district choropleth.
 *
 * Renders true district boundaries from a bundled GeoJSON (no static images),
 * colours each district by total case load (green = lowest → orange → red =
 * highest), supports pan / zoom with on-screen controls and shows a rich hover
 * tooltip. Clicking a district drives the dashboard drill-down.
 */

// Same-origin static asset served from /public.
const GEO_URL = '/tn-districts.geojson';

// Default framing for Tamil Nadu (lon/lat centre + mercator scale).
const DEFAULT_CENTER: [number, number] = [78.4, 11.0];
const DEFAULT_ZOOM = 1;

const NO_DATA = '#e2e8f0';   // slate-200 — districts with no recorded cases
const BORDER = '#94a3b8';    // slate-400

// Normalise a district name so GeoJSON spellings line up with cases.district.
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
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
  kanchipuram: 'kancheepuram',
  kancheepuram: 'kancheepuram',
  thenilgiris: 'nilgiris',
  virudunagar: 'virudhunagar',
  tiruppattur: 'tirupathur',
  thiruvarur: 'thiruvarur',
  nagappattinam: 'nagapattinam',
};

function canon(s: string): string {
  const n = norm(s);
  return ALIASES[n] ?? n;
}

export function TNDistrictMap({
  districts, details, selected, onSelect, loading,
}: {
  districts: DistrictLitigation[];
  details: Record<string, DistrictDetail>;
  selected: string | null;
  onSelect: (district: string) => void;
  loading: boolean;
}) {
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);

  // Build a canonical-name → data lookup so the map can match GeoJSON features.
  const { byCanon, detailByCanon, max } = useMemo(() => {
    const byCanon = new Map<string, DistrictLitigation>();
    let max = 0;
    for (const d of districts) {
      byCanon.set(canon(d.district), d);
      if (d.total > max) max = d.total;
    }
    const detailByCanon = new Map<string, DistrictDetail>();
    for (const key of Object.keys(details)) detailByCanon.set(canon(key), details[key]);
    return { byCanon, detailByCanon, max };
  }, [districts, details]);

  // Green → orange → red choropleth scale.
  const colorScale = useMemo(
    () => scaleLinear<string>()
      .domain([0, Math.max(1, max) / 2, Math.max(1, max)])
      .range(['#22c55e', '#f97316', '#dc2626'])
      .clamp(true),
    [max],
  );

  const zoomIn = () => setZoom(z => Math.min(8, +(z * 1.5).toFixed(2)));
  const zoomOut = () => setZoom(z => Math.max(1, +(z / 1.5).toFixed(2)));
  const reset = () => { setZoom(DEFAULT_ZOOM); setCenter(DEFAULT_CENTER); };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4 text-red-600" /> Tamil Nadu Litigation Map
            </CardTitle>
            <p className="text-xs text-muted-foreground">District boundaries shaded by case load. Hover for details, click to drill down.</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={zoomIn} aria-label="Zoom in" title="Zoom in"><Plus className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={zoomOut} aria-label="Zoom out" title="Zoom out"><Minus className="h-4 w-4" /></Button>
            <Button type="button" size="icon" variant="outline" className="h-7 w-7" onClick={reset} aria-label="Reset view" title="Reset view"><RotateCcw className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-[440px] w-full animate-pulse rounded-md bg-muted" />
        ) : (
          <>
            <div className="relative overflow-hidden rounded-md border bg-slate-50">
              <ComposableMap
                projection="geoMercator"
                projectionConfig={{ center: DEFAULT_CENTER, scale: 4200 }}
                width={800}
                height={620}
                style={{ width: '100%', height: 'auto' }}
              >
                <ZoomableGroup
                  zoom={zoom}
                  center={center}
                  minZoom={1}
                  maxZoom={8}
                  onMoveEnd={({ coordinates, zoom }) => { setCenter(coordinates as [number, number]); setZoom(zoom); }}
                >
                  <Geographies geography={GEO_URL}>
                    {({ geographies }) =>
                      geographies.map(geo => {
                        const name = (geo.properties.district as string) ?? '';
                        const key = canon(name);
                        const d = byCanon.get(key);
                        const det = detailByCanon.get(key);
                        const total = d?.total ?? 0;
                        const isSel = selected != null && canon(selected) === key;
                        const fill = total > 0 ? (colorScale(total) as string) : NO_DATA;
                        const html = `
                          <div style="min-width:170px">
                            <div style="font-weight:700;margin-bottom:4px">${name}</div>
                            <div style="display:flex;justify-content:space-between;gap:16px"><span>Total Cases</span><b>${total}</b></div>
                            <div style="display:flex;justify-content:space-between;gap:16px"><span>Pending</span><b>${d?.pending ?? 0}</b></div>
                            <div style="display:flex;justify-content:space-between;gap:16px"><span>Disposed</span><b>${d?.disposed ?? 0}</b></div>
                            <div style="display:flex;justify-content:space-between;gap:16px"><span>Open Tasks</span><b>${det?.openTasks ?? 0}</b></div>
                            ${total === 0 ? '<div style="margin-top:4px;opacity:.7;font-size:11px">No recorded cases</div>' : '<div style="margin-top:4px;opacity:.7;font-size:11px">Click to drill down</div>'}
                          </div>`;
                        return (
                          <Geography
                            key={geo.rsmKey}
                            geography={geo}
                            onClick={() => onSelect(name)}
                            data-tooltip-id="tn-map-tip"
                            data-tooltip-html={html}
                            style={{
                              default: {
                                fill,
                                stroke: isSel ? '#1d4ed8' : BORDER,
                                strokeWidth: isSel ? 1.6 : 0.5,
                                outline: 'none',
                                cursor: 'pointer',
                              },
                              hover: {
                                fill,
                                stroke: '#1d4ed8',
                                strokeWidth: 1.2,
                                outline: 'none',
                                cursor: 'pointer',
                                filter: 'brightness(0.92)',
                              },
                              pressed: { fill, stroke: '#1d4ed8', strokeWidth: 1.6, outline: 'none' },
                            }}
                          />
                        );
                      })
                    }
                  </Geographies>
                </ZoomableGroup>
              </ComposableMap>
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
        <Tooltip id="tn-map-tip" float className="!rounded-md !bg-slate-900 !px-3 !py-2 !text-xs !text-white !opacity-100 !shadow-lg" />
      </CardContent>
    </Card>
  );
}
