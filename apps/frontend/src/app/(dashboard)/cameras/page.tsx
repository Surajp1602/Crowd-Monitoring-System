"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CameraFormDialog } from "@/components/cameras/camera-form-dialog";
import { CameraTable } from "@/components/cameras/camera-table";
import { PageHeader } from "@/components/layout/page-header";
import { Perm } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";

export default function CamerasPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const canManage = useAuthStore((s) => s.hasPermission(Perm.CAMERA_MANAGE));

  return (
    <div>
      <PageHeader
        title="Cameras"
        description="RTSP, HTTP, ONVIF, USB, webcam, and video file sources feeding the detection pipeline."
        actions={
          canManage ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              Add Camera
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-4">
          <CameraTable />
        </CardContent>
      </Card>

      {canManage && <CameraFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
    </div>
  );
}
