"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateCamera } from "@/hooks/use-cameras";
import { ApiError } from "@/lib/api-client";
import type { StreamType } from "@/lib/types";

const STREAM_TYPES: { value: StreamType; label: string }[] = [
  { value: "rtsp", label: "RTSP" },
  { value: "http", label: "HTTP / MJPEG" },
  { value: "onvif", label: "ONVIF" },
  { value: "usb", label: "USB" },
  { value: "file", label: "Video File" },
  { value: "webcam", label: "Webcam" },
  { value: "simulated", label: "Simulated crowd (demo)" },
];

const EMPTY_FORM = {
  code: "",
  name: "",
  description: "",
  stream_type: "rtsp" as StreamType,
  stream_url: "",
  stream_username: "",
  stream_password: "",
  latitude: "",
  longitude: "",
  map_x: "0",
  map_y: "0",
  fov_deg: "90",
  range_m: "15",
};

export function CameraFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const createCamera = useCreateCamera();

  function update<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await createCamera.mutateAsync({
        code: form.code,
        name: form.name,
        description: form.description || undefined,
        stream_type: form.stream_type,
        stream_url: form.stream_url,
        stream_username: form.stream_username || undefined,
        stream_password: form.stream_password || undefined,
        latitude: form.latitude ? Number(form.latitude) : undefined,
        longitude: form.longitude ? Number(form.longitude) : undefined,
        map_x: Number(form.map_x),
        map_y: Number(form.map_y),
        fov_deg: Number(form.fov_deg),
        range_m: Number(form.range_m),
      });
      toast.success(`Camera "${form.name}" added`);
      setForm(EMPTY_FORM);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof ApiError ? String(err.detail ?? err.message) : "Failed to create camera";
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Camera</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="code">Camera Code</Label>
              <Input
                id="code"
                required
                value={form.code}
                onChange={(e) => update("code", e.target.value)}
                placeholder="cam-entrance-01"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Display Name</Label>
              <Input
                id="name"
                required
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Main Entrance"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Stream Type</Label>
              <Select
                value={form.stream_type}
                onValueChange={(v) => update("stream_type", v as StreamType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STREAM_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stream_url">Stream URL / Device Index</Label>
              <Input
                id="stream_url"
                required
                value={form.stream_url}
                onChange={(e) => update("stream_url", e.target.value)}
                placeholder="rtsp://192.168.1.10:554/stream1"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="stream_username">Stream Username</Label>
              <Input
                id="stream_username"
                value={form.stream_username}
                onChange={(e) => update("stream_username", e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stream_password">Stream Password</Label>
              <Input
                id="stream_password"
                type="password"
                value={form.stream_password}
                onChange={(e) => update("stream_password", e.target.value)}
                placeholder="Optional — stored encrypted"
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="latitude">Latitude</Label>
              <Input
                id="latitude"
                type="number"
                step="any"
                value={form.latitude}
                onChange={(e) => update("latitude", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="longitude">Longitude</Label>
              <Input
                id="longitude"
                type="number"
                step="any"
                value={form.longitude}
                onChange={(e) => update("longitude", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fov_deg">Field of View °</Label>
              <Input
                id="fov_deg"
                type="number"
                step="any"
                value={form.fov_deg}
                onChange={(e) => update("fov_deg", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="range_m">Range (m)</Label>
              <Input
                id="range_m"
                type="number"
                step="any"
                value={form.range_m}
                onChange={(e) => update("range_m", e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createCamera.isPending}>
              {createCamera.isPending ? "Adding..." : "Add Camera"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
