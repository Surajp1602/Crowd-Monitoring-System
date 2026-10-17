"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSaveSetting, useSetting } from "@/hooks/use-notifications";
import { ApiError } from "@/lib/api-client";
import { Perm } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";

interface Field {
  key: string;
  label: string;
  help: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

interface Section {
  key: string;
  title: string;
  description: string;
  fields: Field[];
}

const SECTIONS: Section[] = [
  {
    key: "anomaly",
    title: "Anomaly detection",
    description: "When the detectors raise an alert. Applied to the next frame; no restart.",
    fields: [
      { key: "min_confidence", label: "Minimum confidence", help: "Alerts below this confidence are discarded.", min: 0.3, max: 0.99, step: 0.01 },
      { key: "running_speed_mps", label: "Running speed", help: "Sustained speed that counts as running.", min: 1.5, max: 6, step: 0.1, unit: "m/s" },
      { key: "panic_speed_mps", label: "Panic speed", help: "Speed that escalates a group of runners to critical.", min: 2, max: 8, step: 0.1, unit: "m/s" },
      { key: "congestion_density_per_sqm", label: "Congestion density", help: "Local density held for 10 s that raises congestion.", min: 1, max: 8, step: 0.1, unit: "p/m²" },
      { key: "stampede_density_per_sqm", label: "Stampede density", help: "Density at which fast movement becomes a stampede risk.", min: 2, max: 10, step: 0.1, unit: "p/m²" },
      { key: "counter_flow_angle_deg", label: "Counter-flow angle", help: "How far against the dominant flow counts as counter-flow.", min: 90, max: 180, step: 5, unit: "°" },
      { key: "abnormal_stop_s", label: "Abnormal stop", help: "How long an isolated person may stand still in a moving crowd.", min: 15, max: 600, step: 5, unit: "s" },
      { key: "loitering_dwell_s", label: "Loitering", help: "Time spent within a few metres before it counts as loitering.", min: 30, max: 1800, step: 10, unit: "s" },
    ],
  },
  {
    key: "yolo",
    title: "Detection",
    description: "Person detector settings. Per-camera overrides on the Cameras page take precedence.",
    fields: [
      { key: "confidence_threshold", label: "Detection confidence", help: "Lower finds more people and more false positives.", min: 0.1, max: 0.9, step: 0.01 },
      { key: "iou_threshold", label: "Overlap suppression (IoU)", help: "How much two boxes may overlap before one is dropped.", min: 0.2, max: 0.9, step: 0.01 },
      { key: "frame_skip", label: "Process every Nth frame", help: "Raise to save GPU at the cost of temporal resolution.", min: 1, max: 10, step: 1 },
      { key: "input_size", label: "Input size", help: "Model input resolution; larger finds smaller people, slower.", min: 320, max: 1280, step: 32, unit: "px" },
    ],
  },
  {
    key: "tracking",
    title: "Tracking",
    description: "DeepSORT parameters. Take effect when a camera worker next starts.",
    fields: [
      { key: "max_age", label: "Track memory", help: "Frames a lost person is remembered before their track ends.", min: 5, max: 300, step: 1, unit: "frames" },
      { key: "n_init", label: "Confirmation frames", help: "Detections needed before a track is trusted.", min: 1, max: 10, step: 1 },
      { key: "max_cosine_distance", label: "Appearance match", help: "Lower is stricter when re-matching a person by appearance.", min: 0.05, max: 0.8, step: 0.01 },
    ],
  },
  {
    key: "heatmap",
    title: "Heatmap",
    description: "How the density field is built and how quickly it fades.",
    fields: [
      { key: "decay_seconds", label: "Fade time", help: "A departed crowd's heat falls to about 5% in this time.", min: 1, max: 60, step: 1, unit: "s" },
      { key: "grid_resolution_m", label: "Grid resolution", help: "Cell size; smaller is sharper and costs more.", min: 0.25, max: 2, step: 0.25, unit: "m" },
    ],
  },
];

function SettingSection({ section }: { section: Section }) {
  const { data, isLoading } = useSetting<Record<string, number>>(section.key);
  const save = useSaveSetting<Record<string, number>>(section.key);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const dirty = Object.keys(draft).length > 0;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{section.title}</CardTitle>
          <CardDescription className="mt-2">{section.description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
            {section.fields.map((f) => {
              const value = draft[f.key] ?? data[f.key] ?? f.min;
              const changed = f.key in draft;
              return (
                <div key={f.key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor={`${section.key}-${f.key}`} className="text-sm text-paper">{f.label}</label>
                    <span className={changed ? "num text-sm text-amber" : "num text-sm text-paper"}>
                      {value}{f.unit ? ` ${f.unit}` : ""}
                    </span>
                  </div>
                  <input id={`${section.key}-${f.key}`} type="range" min={f.min} max={f.max} step={f.step} value={value}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: Number(e.target.value) }))}
                    className="w-full accent-[var(--amber)]" />
                  <p className="text-xs text-paper-faint">{f.help}</p>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-6 flex justify-end gap-2 border-t border-rule pt-4">
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft({})}>Discard</Button>
          <Button disabled={!dirty || save.isPending} onClick={async () => {
            try {
              await save.mutateAsync(draft);
              setDraft({});
              toast.success(`${section.title} saved`);
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : "Could not save");
            }
          }}>
            Save {section.title.toLowerCase()}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const canEdit = useAuthStore((s) => s.permissions.includes(Perm.AI_CONFIG_MANAGE));
  return (
    <div className="space-y-4">
      <PageHeader
        index="09"
        eyebrow="Operate"
        title="AI settings"
        description="Thresholds the detection pipeline reads live from the database. Every change is applied without a redeploy."
      />
      {!canEdit && (
        <p className="panel px-4 py-3 text-sm text-paper-dim">You can view these settings; changing them needs the AI configuration permission.</p>
      )}
      {SECTIONS.map((s) => <SettingSection key={s.key} section={s} />)}
    </div>
  );
}
