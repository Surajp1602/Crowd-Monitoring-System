"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CameraFormDialog } from "@/components/cameras/camera-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCameras, useDeleteCamera } from "@/hooks/use-cameras";
import { useCamerasLive } from "@/hooks/use-live";
import { useAllFloors } from "@/hooks/use-map";
import { cameraStatusBadge, relativeTime } from "@/lib/format";
import { Perm } from "@/lib/permissions";
import type { Camera } from "@/lib/types";
import { useAuthStore } from "@/stores/auth-store";

export function CameraTable() {
  const { data, isLoading } = useCameras();
  const live = useCamerasLive();
  const { floors } = useAllFloors();
  const deleteCamera = useDeleteCamera();
  const canManage = useAuthStore((s) => s.hasPermission(Perm.CAMERA_MANAGE));
  const [editing, setEditing] = useState<Camera | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function handleDelete(camera: Camera) {
    if (!window.confirm(`Remove camera "${camera.name}"? Its history stays; live monitoring stops.`)) return;
    setPendingDeleteId(camera.id);
    try {
      await deleteCamera.mutateAsync(camera.id);
      toast.success(`Removed ${camera.name}`);
    } catch {
      toast.error("Could not remove the camera");
    } finally {
      setPendingDeleteId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-paper">No cameras yet</p>
        <p className="mt-1 text-sm text-paper-dim">Add a stream, or a simulated feed to try the platform.</p>
      </div>
    );
  }

  const floorName = (id: string | null) => floors.find((f) => f.id === id)?.name ?? "—";

  return (
    <>
      <Table className="table-stack">
        <TableHeader>
          <TableRow>
            <TableHead>Camera</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Floor</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">People</TableHead>
            <TableHead className="text-right">FPS</TableHead>
            <TableHead className="text-right">Latency</TableHead>
            <TableHead>Last seen</TableHead>
            {canManage && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((camera) => {
            const health = live[camera.id]?.health;
            const summary = live[camera.id]?.summary;
            const status = camera.is_active ? (health?.status ?? camera.status) : "disabled";
            const badge = cameraStatusBadge[status];
            const fps = health?.fps ?? camera.fps;
            const latency = health?.latency_ms ?? camera.latency_ms;
            return (
              <TableRow key={camera.id}>
                <TableCell>
                  <p className="text-paper">{camera.name}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-paper-faint">{camera.code}</p>
                </TableCell>
                <TableCell data-label="Source" className="font-mono text-[11px] uppercase text-paper-dim">{camera.stream_type}</TableCell>
                <TableCell data-label="Floor" className="text-paper-dim">{floorName(camera.floor_id)}</TableCell>
                <TableCell data-label="Status">
                  <Badge variant={badge.variant} dot title={health?.error ?? camera.last_error ?? undefined}>
                    {badge.label}
                  </Badge>
                </TableCell>
                <TableCell data-label="People" className="num text-right">{summary ? summary.person_count : "—"}</TableCell>
                <TableCell data-label="FPS" className="num text-right">{fps > 0 ? fps.toFixed(1) : "—"}</TableCell>
                <TableCell data-label="Latency" className="num text-right">{latency > 0 ? `${latency.toFixed(0)} ms` : "—"}</TableCell>
                <TableCell data-label="Last seen" className="num text-xs text-paper-dim">{relativeTime(health?.ts ?? camera.last_seen_at)}</TableCell>
                {canManage && (
                  <TableCell data-label="Actions" className="text-right">
                    <Button variant="ghost" size="icon" aria-label={`Edit ${camera.name}`} onClick={() => setEditing(camera)}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${camera.name}`}
                      disabled={pendingDeleteId === camera.id}
                      onClick={() => handleDelete(camera)}
                    >
                      <Trash2 className="text-severity-critical" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {canManage && (
        <CameraFormDialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)} camera={editing} />
      )}
    </>
  );
}
