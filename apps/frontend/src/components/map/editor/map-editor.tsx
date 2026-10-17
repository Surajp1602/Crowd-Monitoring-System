"use client";

import { Cctv, MousePointer2, PenLine, Shapes, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FloorPlan, type PlanPoint } from "@/components/map/floor-plan";
import { FloorSetup } from "@/components/map/editor/floor-setup";
import { ZoneDialog } from "@/components/map/editor/zone-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCameras, useUpdateCamera } from "@/hooks/use-cameras";
import { useDeleteZone, useSaveFloor, useZones } from "@/hooks/use-map";
import { ApiError } from "@/lib/api-client";
import type { Building, Camera, Floor, FloorLayout, Wall } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tool = "select" | "zone" | "wall" | "camera";

const TOOLS: { id: Tool; label: string; icon: typeof Shapes; hint: string }[] = [
  { id: "select", label: "Inspect", icon: MousePointer2, hint: "Hover the plan to read positions and density." },
  { id: "zone", label: "Zone", icon: Shapes, hint: "Click to place corners. Double-click or press Enter to finish, Esc to cancel." },
  { id: "wall", label: "Walls", icon: PenLine, hint: "Click to start a wall, click again to end it. Walls chain until you press Esc." },
  { id: "camera", label: "Camera", icon: Cctv, hint: "Pick a camera, click where it is mounted, then set heading and field of view." },
];

const GRID = 0.5;
const snap = (p: PlanPoint): PlanPoint => ({ x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID });

type FloorWithBuilding = Floor & { building: Building | null };
type PlacementField = "map_x" | "map_y" | "map_z" | "orientation_deg" | "fov_deg" | "range_m";

export function MapEditor({
  floor,
  floors,
  onFloorCreated,
}: {
  floor: FloorWithBuilding | null;
  floors: FloorWithBuilding[];
  onFloorCreated: (floorId: string) => void;
}) {
  if (!floor) {
    return <FloorSetup floors={floors} onCreated={onFloorCreated} />;
  }
  return <FloorEditor key={floor.id} floor={floor} floors={floors} onFloorCreated={onFloorCreated} />;
}

function FloorEditor({
  floor,
  floors,
  onFloorCreated,
}: {
  floor: FloorWithBuilding;
  floors: FloorWithBuilding[];
  onFloorCreated: (floorId: string) => void;
}) {
  const zones = useZones(floor.id);
  const allCameras = useCameras();
  const saveFloor = useSaveFloor();
  const deleteZone = useDeleteZone();
  const updateCamera = useUpdateCamera();

  const [tool, setTool] = useState<Tool>("select");
  const [cursor, setCursor] = useState<PlanPoint | null>(null);
  const [polygon, setPolygon] = useState<PlanPoint[]>([]);
  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);

  const layout = (floor.layout ?? {}) as FloorLayout;
  const [walls, setWalls] = useState<Wall[]>(layout.walls ?? []);
  const [wallStart, setWallStart] = useState<PlanPoint | null>(null);
  const wallsDirty = JSON.stringify(walls) !== JSON.stringify(layout.walls ?? []);

  const [cameraId, setCameraId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<Partial<Pick<Camera, PlacementField>>>({});

  const floorCameras = useMemo(
    () => (allCameras.data?.items ?? []).filter((c) => c.floor_id === floor.id),
    [allCameras.data, floor.id]
  );
  const unplaced = useMemo(
    () => (allCameras.data?.items ?? []).filter((c) => !c.floor_id),
    [allCameras.data]
  );
  const selectedCamera = (allCameras.data?.items ?? []).find((c) => c.id === cameraId) ?? null;
  const previewCameras = useMemo(() => {
    if (!selectedCamera) return floorCameras;
    const merged = { ...selectedCamera, ...placement } as Camera;
    return [...floorCameras.filter((c) => c.id !== selectedCamera.id), merged];
  }, [floorCameras, selectedCamera, placement]);

  const cancelDraft = useCallback(() => {
    setPolygon([]);
    setWallStart(null);
  }, []);

  const finishZone = useCallback(() => {
    if (polygon.length < 3) {
      toast.error("A zone needs at least three corners");
      return;
    }
    setZoneDialogOpen(true);
  }, [polygon.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [role=dialog]")) return;
      if (e.key === "Escape") cancelDraft();
      if (e.key === "Enter" && tool === "zone") finishZone();
      if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) {
        if (tool === "zone") setPolygon((p) => p.slice(0, -1));
        if (tool === "wall") setWalls((w) => w.slice(0, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, cancelDraft, finishZone]);

  function handleClick(raw: PlanPoint) {
    const p = snap(raw);
    if (tool === "zone") setPolygon((pts) => [...pts, p]);
    else if (tool === "wall") {
      if (wallStart && (wallStart.x !== p.x || wallStart.y !== p.y)) {
        setWalls((w) => [...w, { x1: wallStart.x, y1: wallStart.y, x2: p.x, y2: p.y }]);
      }
      setWallStart(p);
    } else if (tool === "camera" && selectedCamera) {
      setPlacement((pl) => ({ ...pl, map_x: p.x, map_y: p.y }));
    }
  }

  async function saveWalls() {
    try {
      await saveFloor.mutateAsync({ id: floor.id, input: { layout: { ...layout, walls } } });
      toast.success("Walls saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save walls");
    }
  }

  async function savePlacement() {
    if (!selectedCamera) return;
    try {
      await updateCamera.mutateAsync({
        id: selectedCamera.id,
        input: {
          ...placement,
          floor_id: floor.id,
          building_id: floor.building_id,
        },
      });
      toast.success(`${selectedCamera.name} placed`);
      setPlacement({});
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not place camera");
    }
  }

  const active = TOOLS.find((t) => t.id === tool)!;
  const cam = selectedCamera ? { ...selectedCamera, ...placement } : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
      <div className="panel flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2">
          <div role="toolbar" aria-label="Editing tools" className="flex gap-1">
            {TOOLS.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={tool === t.id ? "secondary" : "ghost"}
                aria-pressed={tool === t.id}
                onClick={() => {
                  cancelDraft();
                  setTool(t.id);
                }}
                className={cn(tool === t.id && "text-amber")}
              >
                <t.icon />
                {t.label}
              </Button>
            ))}
          </div>
          <p className="ml-auto hidden text-xs text-paper-dim md:block">{active.hint}</p>
        </div>
        <div className="relative h-[calc(100vh-17rem)] min-h-[460px] bg-[#0a0c0b]">
          <FloorPlan
            floor={floor}
            zones={zones.data?.items}
            cameras={previewCameras}
            onFloorClick={tool === "select" ? undefined : handleClick}
            onFloorDoubleClick={tool === "zone" ? () => finishZone() : undefined}
            onHover={(p) => setCursor(p ? snap(p) : null)}
            draft={{
              polygon,
              walls,
              from: tool === "wall" ? wallStart : polygon[polygon.length - 1] ?? null,
              cursor: tool === "select" ? null : cursor,
              selectedCameraId: cameraId,
            }}
          />
          {cursor && tool !== "select" && (
            <span className="num absolute bottom-3 left-3 rounded-[3px] bg-ink/90 px-2 py-1 text-[11px] text-paper-dim">
              {cursor.x.toFixed(1)}, {cursor.y.toFixed(1)} m · snap {GRID} m
            </span>
          )}
        </div>
      </div>

      <aside className="flex flex-col gap-4">
        {tool === "wall" && (
          <Card>
            <CardHeader>
              <CardTitle>Walls</CardTitle>
              <span className="num text-xs text-paper-dim">{walls.length} segments</span>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setWalls((w) => w.slice(0, -1))} disabled={!walls.length}>
                <Undo2 /> Undo
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setWalls(layout.walls ?? [])} disabled={!wallsDirty}>
                Revert
              </Button>
              <Button size="sm" className="ml-auto" onClick={saveWalls} disabled={!wallsDirty || saveFloor.isPending}>
                Save walls
              </Button>
            </CardContent>
          </Card>
        )}

        {tool === "zone" && (
          <Card>
            <CardHeader>
              <CardTitle>New zone</CardTitle>
              <span className="num text-xs text-paper-dim">{polygon.length} corners</span>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setPolygon((p) => p.slice(0, -1))} disabled={!polygon.length}>
                <Undo2 /> Undo
              </Button>
              <Button size="sm" className="ml-auto" onClick={finishZone} disabled={polygon.length < 3}>
                Finish zone
              </Button>
            </CardContent>
          </Card>
        )}

        {tool === "camera" && (
          <Card>
            <CardHeader>
              <CardTitle>Place a camera</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="camera-pick">Camera</Label>
                <select
                  id="camera-pick"
                  value={cameraId ?? ""}
                  onChange={(e) => {
                    setCameraId(e.target.value || null);
                    setPlacement({});
                  }}
                  className="h-9 w-full rounded-md border border-input bg-ink px-2 text-sm"
                >
                  <option value="">Choose…</option>
                  {floorCameras.length > 0 && (
                    <optgroup label="On this floor">
                      {floorCameras.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.code})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {unplaced.length > 0 && (
                    <optgroup label="Not placed yet">
                      {unplaced.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.code})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              {cam && (
                <>
                  <p className="num text-xs text-paper-dim">
                    Mounted at {cam.map_x?.toFixed(1)}, {cam.map_y?.toFixed(1)} m. Click the plan to move it.
                  </p>
                  {(
                    [
                      ["orientation_deg", "Heading", 0, 359, 1, "°"],
                      ["fov_deg", "Field of view", 10, 180, 1, "°"],
                      ["range_m", "Range", 2, 60, 0.5, " m"],
                      ["map_z", "Mount height", 1, 15, 0.5, " m"],
                    ] as const
                  ).map(([key, label, min, max, step, unit]) => (
                    <div key={key} className="space-y-1.5">
                      <div className="flex justify-between">
                        <Label htmlFor={`cam-${key}`}>{label}</Label>
                        <span className="num text-xs text-paper">
                          {Number(cam[key] ?? 0)}
                          {unit}
                        </span>
                      </div>
                      <input
                        id={`cam-${key}`}
                        type="range"
                        min={min}
                        max={max}
                        step={step}
                        value={Number(cam[key] ?? 0)}
                        onChange={(e) => setPlacement((pl) => ({ ...pl, [key]: Number(e.target.value) }))}
                        className="w-full accent-[var(--amber)]"
                      />
                    </div>
                  ))}
                  <Button
                    className="w-full"
                    onClick={savePlacement}
                    disabled={updateCamera.isPending || (Object.keys(placement).length === 0 && cam.floor_id === floor.id)}
                  >
                    Save placement
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Zones</CardTitle>
            <span className="num text-xs text-paper-dim">{zones.data?.items.length ?? 0}</span>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-rule">
              {(zones.data?.items ?? []).map((z) => (
                <li key={z.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: z.color }} />
                    <span className="truncate text-[13px]">{z.name}</span>
                    {z.is_restricted && (
                      <span className="font-mono text-[10px] uppercase text-severity-critical">restricted</span>
                    )}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete zone ${z.name}`}
                    onClick={async () => {
                      if (!window.confirm(`Delete zone "${z.name}"?`)) return;
                      await deleteZone.mutateAsync(z.id);
                      toast.success(`Zone "${z.name}" deleted`);
                    }}
                  >
                    <Trash2 className="text-paper-faint" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <FloorSettings floor={floor} />
        <FloorSetup floors={floors} onCreated={onFloorCreated} compact />
      </aside>

      <ZoneDialog
        open={zoneDialogOpen}
        onOpenChange={setZoneDialogOpen}
        floorId={floor.id}
        polygon={polygon}
        onSaved={() => {
          setPolygon([]);
          setZoneDialogOpen(false);
        }}
      />
    </div>
  );
}

function FloorSettings({ floor }: { floor: Floor }) {
  const saveFloor = useSaveFloor();
  const [form, setForm] = useState({
    name: floor.name,
    width_m: String(floor.width_m),
    depth_m: String(floor.depth_m),
    level_index: String(floor.level_index),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Floor</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await saveFloor.mutateAsync({
                id: floor.id,
                input: {
                  name: form.name,
                  width_m: Number(form.width_m),
                  depth_m: Number(form.depth_m),
                  level_index: Number(form.level_index),
                },
              });
              toast.success("Floor saved");
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : "Could not save floor");
            }
          }}
        >
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="floor-name">Name</Label>
            <Input id="floor-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          {(
            [
              ["width_m", "Width (m)"],
              ["depth_m", "Depth (m)"],
              ["level_index", "Level"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`floor-${key}`}>{label}</Label>
              <Input
                id={`floor-${key}`}
                type="number"
                step={key === "level_index" ? 1 : 0.5}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                required
              />
            </div>
          ))}
          <Button type="submit" size="sm" variant="outline" className="self-end" disabled={saveFloor.isPending}>
            Save floor
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
