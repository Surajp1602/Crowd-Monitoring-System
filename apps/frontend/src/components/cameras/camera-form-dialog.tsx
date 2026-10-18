"use client";

import { useState } from "react";
import { toast } from "sonner";
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
import { useCreateCamera, useUpdateCamera } from "@/hooks/use-cameras";
import { useAllFloors } from "@/hooks/use-map";
import { ApiError } from "@/lib/api-client";
import type { Camera, CameraCreateInput, StreamType } from "@/lib/types";

const STREAM_TYPES: { value: StreamType; label: string; url: string }[] = [
  { value: "rtsp", label: "RTSP", url: "rtsp://192.168.1.10:554/stream1" },
  { value: "http", label: "HTTP / MJPEG", url: "http://192.168.1.10/video.mjpg" },
  { value: "onvif", label: "ONVIF", url: "rtsp://192.168.1.10:554/onvif1" },
  { value: "usb", label: "USB", url: "0" },
  { value: "webcam", label: "Webcam", url: "0" },
  { value: "file", label: "Video file", url: "/data/media/samples/concourse.mp4" },
  { value: "simulated", label: "Simulated crowd (demo)", url: "simulated://demo" },
];

const NETWORK: StreamType[] = ["rtsp", "http", "onvif"];

function initialForm(camera?: Camera | null) {
  return {
    code: camera?.code ?? "",
    name: camera?.name ?? "",
    description: camera?.description ?? "",
    stream_type: (camera?.stream_type ?? "rtsp") as StreamType,
    stream_url: camera?.stream_url ?? "",
    stream_username: camera?.stream_username ?? "",
    stream_password: "",
    floor_id: camera?.floor_id ?? "",
    latitude: camera?.latitude != null ? String(camera.latitude) : "",
    longitude: camera?.longitude != null ? String(camera.longitude) : "",
    confidence: camera?.config?.confidence_threshold != null ? String(camera.config.confidence_threshold) : "",
    frame_skip: camera?.config?.frame_skip != null ? String(camera.config.frame_skip) : "",
    is_active: camera?.is_active ?? true,
  };
}

/** Create a camera, or edit one when `camera` is given. Placement lives on the facility map. */
export function CameraFormDialog({
  open,
  onOpenChange,
  camera,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  camera?: Camera | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {open && <CameraForm key={camera?.id ?? "new"} camera={camera} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function CameraForm({ camera, onDone }: { camera?: Camera | null; onDone: () => void }) {
  const editing = Boolean(camera);
  const [form, setForm] = useState(() => initialForm(camera));
  const createCamera = useCreateCamera();
  const updateCamera = useUpdateCamera();
  const { floors } = useAllFloors();
  const pending = createCamera.isPending || updateCamera.isPending;
  const typeInfo = STREAM_TYPES.find((t) => t.value === form.stream_type)!;
  const isNetwork = NETWORK.includes(form.stream_type);

  function update<K extends keyof ReturnType<typeof initialForm>>(key: K, value: ReturnType<typeof initialForm>[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const floor = floors.find((f) => f.id === form.floor_id);
    const config: Record<string, unknown> = { ...(camera?.config ?? {}) };
    if (form.confidence) config.confidence_threshold = Number(form.confidence);
    else delete config.confidence_threshold;
    if (form.frame_skip) config.frame_skip = Number(form.frame_skip);
    else delete config.frame_skip;

    const input: Partial<CameraCreateInput> = {
      name: form.name,
      description: form.description || undefined,
      stream_type: form.stream_type,
      stream_url: form.stream_url || typeInfo.url,
      stream_username: isNetwork ? form.stream_username || undefined : undefined,
      stream_password: isNetwork ? form.stream_password || undefined : undefined,
      floor_id: floor?.id,
      building_id: floor?.building_id,
      latitude: form.latitude ? Number(form.latitude) : undefined,
      longitude: form.longitude ? Number(form.longitude) : undefined,
      config,
      is_active: form.is_active,
    };

    try {
      if (camera) {
        await updateCamera.mutateAsync({ id: camera.id, input });
        toast.success(`Saved ${form.name}`);
      } else {
        await createCamera.mutateAsync({ ...input, code: form.code } as CameraCreateInput);
        toast.success(`Added ${form.name}. Place it on the facility map to set its view.`);
      }
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save the camera");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editing ? `Edit ${camera!.name}` : "Add a camera"}</DialogTitle>
        <DialogDescription>
          Stream passwords are encrypted at rest and never sent back to the browser. Position, heading and
          field of view are set on the facility map.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="code">Code</Label>
            <Input id="code" required disabled={editing} value={form.code}
              onChange={(e) => update("code", e.target.value)} placeholder="CAM-L0-ENT" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="Main entrance" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <fieldset className="grid grid-cols-1 gap-3 border-t border-rule pt-4 sm:grid-cols-2">
          <legend className="eyebrow mb-2">Source</legend>
          <div className="space-y-1.5">
            <Label htmlFor="stream_type">Type</Label>
            <select id="stream_type" value={form.stream_type}
              onChange={(e) => update("stream_type", e.target.value as StreamType)}
              className="h-9 w-full rounded-md border border-input bg-ink px-2 text-sm">
              {STREAM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stream_url">{form.stream_type === "usb" || form.stream_type === "webcam" ? "Device index" : "URL"}</Label>
            <Input id="stream_url" value={form.stream_url} required={form.stream_type !== "simulated"}
              onChange={(e) => update("stream_url", e.target.value)} placeholder={typeInfo.url} />
          </div>
          {isNetwork && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="stream_username">Username</Label>
                <Input id="stream_username" autoComplete="off" value={form.stream_username}
                  onChange={(e) => update("stream_username", e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stream_password">Password</Label>
                <Input id="stream_password" type="password" autoComplete="new-password" value={form.stream_password}
                  onChange={(e) => update("stream_password", e.target.value)}
                  placeholder={editing ? "Unchanged unless you type a new one" : "Optional"} />
              </div>
            </>
          )}
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-3 border-t border-rule pt-4 sm:grid-cols-2">
          <legend className="eyebrow mb-2">Location</legend>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="floor_id">Floor</Label>
            <select id="floor_id" value={form.floor_id} onChange={(e) => update("floor_id", e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-ink px-2 text-sm">
              <option value="">Not on a floor plan yet</option>
              {floors.map((f) => (
                <option key={f.id} value={f.id}>{f.building?.name} · {f.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="latitude">Latitude</Label>
            <Input id="latitude" type="number" step="any" value={form.latitude} onChange={(e) => update("latitude", e.target.value)}
              placeholder="For geofenced alerts" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="longitude">Longitude</Label>
            <Input id="longitude" type="number" step="any" value={form.longitude} onChange={(e) => update("longitude", e.target.value)} />
          </div>
        </fieldset>

        <fieldset className="grid grid-cols-1 gap-3 border-t border-rule pt-4 sm:grid-cols-3">
          <legend className="eyebrow mb-2">Detection overrides</legend>
          <div className="space-y-1.5">
            <Label htmlFor="confidence">Confidence threshold</Label>
            <Input id="confidence" type="number" min={0.05} max={0.95} step={0.05} value={form.confidence}
              onChange={(e) => update("confidence", e.target.value)} placeholder="Global" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="frame_skip">Process every Nth frame</Label>
            <Input id="frame_skip" type="number" min={1} max={30} step={1} value={form.frame_skip}
              onChange={(e) => update("frame_skip", e.target.value)} placeholder="Global" />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-paper-dim">
            <input type="checkbox" checked={form.is_active} onChange={(e) => update("is_active", e.target.checked)}
              className="size-4 accent-[var(--amber)]" />
            Active
          </label>
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save changes" : "Add camera"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
