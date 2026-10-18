"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { PlanPoint } from "@/components/map/floor-plan";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSaveZone } from "@/hooks/use-map";
import { ApiError } from "@/lib/api-client";
import type { ZoneType } from "@/lib/types";

const ZONE_TYPES: { value: ZoneType; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "open_space", label: "Open space" },
  { value: "corridor", label: "Corridor" },
  { value: "entrance", label: "Entrance" },
  { value: "exit", label: "Exit" },
  { value: "assembly_point", label: "Assembly point" },
  { value: "restricted", label: "Restricted" },
];

const SWATCHES = ["#38bdf8", "#22c55e", "#eab308", "#a78bfa", "#2dd4bf", "#f97316", "#f472b6", "#ef4444"];

function polygonArea(points: PlanPoint[]) {
  let total = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!;
    total += p.x * q.y - q.x * p.y;
  });
  return Math.abs(total) / 2;
}

export function ZoneDialog({
  open,
  onOpenChange,
  floorId,
  polygon,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  floorId: string;
  polygon: PlanPoint[];
  onSaved: () => void;
}) {
  const saveZone = useSaveZone();
  const [name, setName] = useState("");
  const [zoneType, setZoneType] = useState<ZoneType>("public");
  const [capacity, setCapacity] = useState("");
  const [color, setColor] = useState(SWATCHES[0]!);
  const area = polygonArea(polygon);
  const restricted = zoneType === "restricted";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Name this zone</DialogTitle>
          <DialogDescription>
            <span className="num">{area.toFixed(1)} m²</span> across {polygon.length} corners. A safe planning
            figure is about 2 people/m², so roughly <span className="num">{Math.floor(area * 2)}</span> people.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await saveZone.mutateAsync({
                input: {
                  floor_id: floorId,
                  name,
                  zone_type: zoneType,
                  polygon,
                  color: restricted ? "#ef4444" : color,
                  capacity_threshold: capacity ? Number(capacity) : null,
                  is_restricted: restricted,
                },
              });
              toast.success(`Zone "${name}" created`);
              setName("");
              setCapacity("");
              onSaved();
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : "Could not save zone");
            }
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="zone-name">Name</Label>
            <Input id="zone-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="zone-type">Type</Label>
              <select
                id="zone-type"
                value={zoneType}
                onChange={(e) => setZoneType(e.target.value as ZoneType)}
                className="h-9 w-full rounded-md border border-input bg-ink px-2 text-sm"
              >
                {ZONE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="zone-capacity">Capacity (people)</Label>
              <Input
                id="zone-capacity"
                type="number"
                min={0}
                placeholder={String(Math.floor(area * 2))}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </div>
          </div>
          {restricted ? (
            <p className="text-xs text-severity-critical">
              Anyone detected inside a restricted zone raises an intrusion alert.
            </p>
          ) : (
            <fieldset className="space-y-1.5">
              <legend className="text-xs text-paper-dim">Colour</legend>
              <div className="flex gap-2">
                {SWATCHES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-label={`Colour ${s}`}
                    aria-pressed={color === s}
                    onClick={() => setColor(s)}
                    className="size-6 rounded-[3px] ring-offset-2 ring-offset-ink aria-pressed:ring-2 aria-pressed:ring-amber"
                    style={{ background: s }}
                  />
                ))}
              </div>
            </fieldset>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Keep drawing
            </Button>
            <Button type="submit" disabled={saveZone.isPending || !name}>
              Create zone
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
