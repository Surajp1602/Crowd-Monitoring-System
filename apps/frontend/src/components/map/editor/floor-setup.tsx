"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBuildings, useSaveBuilding, useSaveFloor } from "@/hooks/use-map";
import { ApiError } from "@/lib/api-client";
import type { Floor } from "@/lib/types";

/** Creates a floor, and the building it belongs to when there is none yet. */
export function FloorSetup({
  floors,
  onCreated,
  compact,
}: {
  floors: Floor[];
  onCreated: (floorId: string) => void;
  compact?: boolean;
}) {
  const buildings = useBuildings();
  const saveBuilding = useSaveBuilding();
  const saveFloor = useSaveFloor();
  const existing = buildings.data?.items ?? [];
  const [buildingId, setBuildingId] = useState<string>("");
  const [buildingName, setBuildingName] = useState("");
  const [form, setForm] = useState({ name: "", width_m: "60", depth_m: "40" });
  const [open, setOpen] = useState(!compact);

  const targetBuilding = buildingId || existing[0]?.id || "";
  const nextLevel =
    Math.max(-1, ...floors.filter((f) => f.building_id === targetBuilding).map((f) => f.level_index)) + 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      let bId = targetBuilding;
      if (!bId) {
        const building = await saveBuilding.mutateAsync({ input: { name: buildingName || "Main building" } });
        bId = building.id;
      }
      const floor = await saveFloor.mutateAsync({
        input: {
          building_id: bId,
          name: form.name,
          level_index: nextLevel,
          width_m: Number(form.width_m),
          depth_m: Number(form.depth_m),
          layout: { wall_height_m: 4, walls: [] },
        },
      });
      toast.success(`Floor "${floor.name}" created`);
      setForm({ name: "", width_m: form.width_m, depth_m: form.depth_m });
      onCreated(floor.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create floor");
    }
  }

  if (compact && !open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        Add another floor
      </Button>
    );
  }

  return (
    <Card className={compact ? undefined : "mx-auto max-w-lg"}>
      <CardHeader>
        <div>
          <CardTitle>{existing.length ? "Add a floor" : "Set up your first floor"}</CardTitle>
          {!compact && (
            <CardDescription className="mt-2">
              Give the floor its real dimensions. Walls, zones and cameras are drawn on it next.
            </CardDescription>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form className="grid grid-cols-2 gap-3" onSubmit={submit}>
          {existing.length === 0 ? (
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="building-name">Building</Label>
              <Input
                id="building-name"
                placeholder="e.g. Terminal 2"
                value={buildingName}
                onChange={(e) => setBuildingName(e.target.value)}
                required
              />
            </div>
          ) : (
            existing.length > 1 && (
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="building-pick">Building</Label>
                <select
                  id="building-pick"
                  value={targetBuilding}
                  onChange={(e) => setBuildingId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-ink px-2 text-sm"
                >
                  {existing.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )
          )}
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="new-floor-name">Floor name</Label>
            <Input
              id="new-floor-name"
              placeholder={`Level ${nextLevel}`}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-floor-w">Width (m)</Label>
            <Input id="new-floor-w" type="number" min={1} step={0.5} value={form.width_m}
              onChange={(e) => setForm({ ...form, width_m: e.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-floor-d">Depth (m)</Label>
            <Input id="new-floor-d" type="number" min={1} step={0.5} value={form.depth_m}
              onChange={(e) => setForm({ ...form, depth_m: e.target.value })} required />
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            {compact && (
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={saveFloor.isPending || saveBuilding.isPending}>
              Create floor
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
