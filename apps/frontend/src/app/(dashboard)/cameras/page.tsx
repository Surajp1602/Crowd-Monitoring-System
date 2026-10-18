"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { CameraFormDialog } from "@/components/cameras/camera-form-dialog";
import { CameraTable } from "@/components/cameras/camera-table";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Perm } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";

export default function CamerasPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const canManage = useAuthStore((s) => s.hasPermission(Perm.CAMERA_MANAGE));

  return (
    <div>
      <PageHeader
        index="06"
        eyebrow="Operate"
        title="Cameras"
        description="Every source feeding the detection pipeline: RTSP, HTTP, ONVIF, USB, webcams, video files and simulated feeds."
        actions={
          canManage ? (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus />
              Add camera
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardContent className="pt-3">
          <CameraTable />
        </CardContent>
      </Card>
      {canManage && <CameraFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
    </div>
  );
}
