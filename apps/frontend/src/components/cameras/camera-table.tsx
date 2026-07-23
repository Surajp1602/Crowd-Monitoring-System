"use client";

import { Trash2, Video } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCameras, useDeleteCamera } from "@/hooks/use-cameras";
import { cameraStatusBadge, relativeTime } from "@/lib/format";
import { Perm } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";

export function CameraTable() {
  const { data, isLoading } = useCameras();
  const deleteCamera = useDeleteCamera();
  const canManage = useAuthStore((s) => s.hasPermission(Perm.CAMERA_MANAGE));
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Remove camera "${name}"? This cannot be undone.`)) return;
    setPendingDeleteId(id);
    try {
      await deleteCamera.mutateAsync(id);
      toast.success(`Camera "${name}" removed`);
    } catch {
      toast.error("Failed to remove camera");
    } finally {
      setPendingDeleteId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <Video className="size-8 text-muted-foreground" />
        <div>
          <p className="font-medium">No cameras yet</p>
          <p className="text-sm text-muted-foreground">
            Add your first camera to start monitoring a zone.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Camera</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>FPS</TableHead>
          <TableHead>Latency</TableHead>
          <TableHead>Last Seen</TableHead>
          {canManage && <TableHead className="text-right">Actions</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.items.map((camera) => {
          const statusBadge = cameraStatusBadge[camera.status];
          return (
            <TableRow key={camera.id}>
              <TableCell>
                <div>
                  <p className="font-medium">{camera.name}</p>
                  <p className="text-xs text-muted-foreground">{camera.code}</p>
                </div>
              </TableCell>
              <TableCell className="uppercase text-xs text-muted-foreground">
                {camera.stream_type}
              </TableCell>
              <TableCell>
                <Badge variant={statusBadge.variant} dot>
                  {statusBadge.label}
                </Badge>
              </TableCell>
              <TableCell>{camera.fps > 0 ? camera.fps.toFixed(1) : "—"}</TableCell>
              <TableCell>{camera.latency_ms > 0 ? `${camera.latency_ms.toFixed(0)}ms` : "—"}</TableCell>
              <TableCell className="text-muted-foreground">
                {relativeTime(camera.last_seen_at)}
              </TableCell>
              {canManage && (
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={pendingDeleteId === camera.id}
                    onClick={() => handleDelete(camera.id, camera.name)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
