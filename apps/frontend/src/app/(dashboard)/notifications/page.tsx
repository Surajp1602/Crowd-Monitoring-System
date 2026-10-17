"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { InstrumentStrip } from "@/components/dashboard/instrument-strip";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  type Channel,
  type NotificationRules,
  useDeleteSubscription,
  useNotificationHistory,
  useProviderStatus,
  useSaveSetting,
  useSendTest,
  useSetting,
  useSubscriptions,
} from "@/hooks/use-notifications";
import { ApiError } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHANNEL_LABEL: Record<Channel, string> = {
  push: "Push",
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
  public_announcement: "Announcement",
};
const ALL_CHANNELS = Object.keys(CHANNEL_LABEL) as Channel[];
const SEVERITIES = ["low", "medium", "high", "critical", "never"];

const tabClass =
  "rounded-[3px] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-paper-faint transition-colors hover:text-paper data-[state=active]:bg-ink-4 data-[state=active]:text-paper";

function History() {
  const [page, setPage] = useState(1);
  const [channel, setChannel] = useState<Channel | "">("");
  const [status, setStatus] = useState("");
  const { data, isLoading } = useNotificationHistory(page, channel, status);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <CardTitle index="01">Delivery history</CardTitle>
        <div className="flex gap-2">
          <select aria-label="Channel" value={channel} onChange={(e) => { setChannel(e.target.value as Channel | ""); setPage(1); }}
            className="h-8 rounded-md border border-input bg-ink px-2 text-xs">
            <option value="">All channels</option>
            {ALL_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
          </select>
          <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="h-8 rounded-md border border-input bg-ink px-2 text-xs">
            <option value="">All results</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : !data?.items.length ? (
          <p className="py-12 text-center text-sm text-paper-dim">
            Nothing sent yet. High and critical alerts are delivered here as they happen.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Audience</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Alert</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="text-paper-dim">{relativeTime(n.created_at)}</TableCell>
                  <TableCell>{CHANNEL_LABEL[n.channel]}</TableCell>
                  <TableCell className="num text-xs">{n.recipient}</TableCell>
                  <TableCell className="font-mono text-[11px] uppercase text-paper-dim">{String(n.provider_response.audience ?? "—")}</TableCell>
                  <TableCell>
                    <Badge variant={n.status === "sent" ? "success" : n.status === "failed" ? "destructive" : "muted"}
                      title={n.status === "failed" ? JSON.stringify(n.provider_response) : undefined}>
                      {n.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-paper-dim">{n.provider}</TableCell>
                  <TableCell>
                    {n.alert_id ? (
                      <Link className="text-xs text-amber hover:underline" href={`/alerts?focus=${n.alert_id}`}>Open</Link>
                    ) : (
                      <span className="text-xs text-paper-faint">Test</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {pages > 1 && (
          <div className="mt-3 flex items-center justify-between">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="num text-xs text-paper-dim">Page {page} of {pages}</span>
            <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Subscribers() {
  const { data, isLoading } = useSubscriptions();
  const remove = useDeleteSubscription();
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle index="02">Public subscribers</CardTitle>
          <CardDescription className="mt-2">
            People who asked for safety notices near the venue at <Link href="/subscribe" className="text-amber hover:underline">/subscribe</Link>.
            Contacts are masked; subscribers unsubscribe themselves from any message.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !data?.items.length ? (
          <p className="py-10 text-center text-sm text-paper-dim">No subscribers yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead className="text-right">Radius</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Remove</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="num text-xs">{s.display_name ? `${s.display_name} · ` : ""}{s.contact}</TableCell>
                  <TableCell className="text-paper-dim">{s.channels.map((c) => CHANNEL_LABEL[c]).join(", ")}</TableCell>
                  <TableCell className="num text-right">{s.radius_m} m</TableCell>
                  <TableCell className="num text-xs text-paper-dim">{s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}</TableCell>
                  <TableCell className="text-paper-dim">{relativeTime(s.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" aria-label={`Remove subscriber ${s.contact}`}
                      onClick={async () => {
                        if (!window.confirm("Remove this subscriber? They will stop receiving notices.")) return;
                        await remove.mutateAsync(s.id);
                        toast.success("Subscriber removed");
                      }}>
                      <Trash2 className="text-paper-faint" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ChannelChecks({ value, onChange, options = ALL_CHANNELS }: { value: Channel[]; onChange: (v: Channel[]) => void; options?: Channel[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((c) => {
        const on = value.includes(c);
        return (
          <button key={c} type="button" aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
            className={cn("rounded-[3px] border px-2.5 py-1 text-xs transition-colors",
              on ? "border-amber/60 bg-amber/10 text-paper" : "border-rule text-paper-faint hover:text-paper")}>
            {CHANNEL_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}

function Routing() {
  const { data: rules, isLoading } = useSetting<NotificationRules>("notifications");
  const save = useSaveSetting<NotificationRules>("notifications");
  const [draft, setDraft] = useState<Partial<NotificationRules>>({});
  if (isLoading || !rules) return <Skeleton className="h-80 w-full" />;
  const r = { ...rules, ...draft } as NotificationRules;
  const dirty = Object.keys(draft).length > 0;
  const set = <K extends keyof NotificationRules>(k: K, v: NotificationRules[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const severityField = (key: "staff_min_severity" | "public_min_severity" | "announcement_min_severity", label: string, hint: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={key}>{label}</Label>
      <select id={key} value={r[key]} onChange={(e) => set(key, e.target.value)} className="h-9 w-full rounded-md border border-input bg-ink px-2 text-sm capitalize">
        {SEVERITIES.map((s) => <option key={s} value={s}>{s === "never" ? "Never" : `${s} and above`}</option>)}
      </select>
      <p className="text-xs text-paper-faint">{hint}</p>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle index="03">Routing rules</CardTitle>
          <CardDescription className="mt-2">Who hears about which alerts. Changes apply to the next alert; no restart needed.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm text-paper">Enabled channels</p>
          <ChannelChecks value={r.enabled_channels} onChange={(v) => set("enabled_channels", v)} />
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {severityField("staff_min_severity", "Staff", "Admins, supervisors and security officers who have not opted out.")}
          {severityField("public_min_severity", "Public subscribers", "People who subscribed within the alert's radius.")}
          {severityField("announcement_min_severity", "Public announcement", "Triggers the PA / signage webhook for the zone.")}
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm text-paper">Staff channels</p>
            <ChannelChecks value={r.staff_channels} onChange={(v) => set("staff_channels", v)} options={["email", "sms", "whatsapp"]} />
          </div>
          <div className="space-y-2">
            <p className="text-sm text-paper">Public channels</p>
            <ChannelChecks value={r.public_channels} onChange={(v) => set("public_channels", v)} options={["push", "sms", "whatsapp", "email"]} />
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cooldown">Per-recipient cooldown (seconds)</Label>
            <Input id="cooldown" type="number" min={0} max={3600} value={r.recipient_cooldown_s}
              onChange={(e) => set("recipient_cooldown_s", Number(e.target.value))} />
            <p className="text-xs text-paper-faint">The same person gets at most one message per alert type in this window.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="radius">Default subscription radius (m)</Label>
            <Input id="radius" type="number" min={25} max={5000} value={r.default_geofence_radius_m}
              onChange={(e) => set("default_geofence_radius_m", Number(e.target.value))} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-rule pt-4">
          <Button variant="ghost" disabled={!dirty} onClick={() => setDraft({})}>Discard</Button>
          <Button disabled={!dirty || save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync(draft);
                setDraft({});
                toast.success("Routing rules saved");
              } catch (err) {
                toast.error(err instanceof ApiError ? err.message : "Could not save");
              }
            }}>
            Save rules
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Channels() {
  const { data } = useProviderStatus();
  const send = useSendTest();
  const [channel, setChannel] = useState<Channel>("email");
  const [recipient, setRecipient] = useState("");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle index="04">Providers</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-rule">
            {ALL_CHANNELS.map((c) => {
              const s = data?.channels[c];
              return (
                <li key={c} className="flex items-center justify-between gap-3 py-2.5">
                  <span>
                    <span className="text-sm text-paper">{CHANNEL_LABEL[c]}</span>
                    {s?.error && <span className="block text-xs text-severity-high">{s.error}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-paper-dim">{s?.provider ?? "unknown"}</span>
                    <Badge variant={s?.ready ? "success" : s?.provider === "noop" ? "muted" : "destructive"}>
                      {s?.ready ? "Ready" : s?.provider === "noop" ? "Off" : "Not ready"}
                    </Badge>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-paper-faint">
            Providers are configured on the worker through environment variables (see .env.example). Console logs
            messages instead of sending them.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle index="05">Send a test</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            try {
              await send.mutateAsync({ channel, recipient });
              toast.success("Queued. It appears in history once the worker sends it.");
            } catch (err) {
              toast.error(err instanceof ApiError ? err.message : "Could not queue the test");
            }
          }}>
            <div className="space-y-1.5">
              <Label htmlFor="test-channel">Channel</Label>
              <select id="test-channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}
                className="h-9 w-full rounded-md border border-input bg-ink px-2 text-sm">
                {ALL_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="test-recipient">Recipient</Label>
              <Input id="test-recipient" required value={recipient} onChange={(e) => setRecipient(e.target.value)}
                placeholder={channel === "email" ? "you@organisation.com" : channel === "push" ? "Device token" : channel === "public_announcement" ? "Zone or speaker group" : "+919812345678"} />
            </div>
            <Button type="submit" disabled={send.isPending || !data?.worker_online}>
              {data?.worker_online ? "Send test" : "Worker offline"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function NotificationsPage() {
  const status = useProviderStatus();
  const subs = useSubscriptions();
  const ready = Object.values(status.data?.channels ?? {}).filter((c) => c?.ready).length;
  const w = status.data?.worker;
  return (
    <div className="space-y-4">
      <PageHeader
        index="07"
        eyebrow="Operate"
        title="Notifications"
        description="How alerts reach people: staff by role and severity, the public by distance from the incident, and public-address systems."
      />
      <InstrumentStrip
        loading={status.isLoading}
        readouts={[
          { label: "Dispatcher", value: status.data?.worker_online ? "Online" : "Offline", tone: status.data?.worker_online ? "ok" : "critical", detail: w ? `consumer ${w.consumer}` : "No heartbeat" },
          { label: "Channels ready", value: `${ready}/${ALL_CHANNELS.length}`, detail: "Configured on the worker" },
          { label: "Sent", value: w?.sent ?? 0, detail: "Since the worker started" },
          { label: "Failed", value: w?.failed ?? 0, tone: (w?.failed ?? 0) > 0 ? "amber" : "default", detail: "After retries" },
          { label: "Subscribers", value: subs.data?.total ?? 0, detail: "Active public subscriptions" },
        ]}
      />
      <Tabs.Root defaultValue="history" className="space-y-4">
        <Tabs.List aria-label="Notification views" className="flex w-fit flex-wrap gap-1 rounded-[4px] border border-rule p-0.5">
          <Tabs.Trigger value="history" className={tabClass}>History</Tabs.Trigger>
          <Tabs.Trigger value="subscribers" className={tabClass}>Subscribers</Tabs.Trigger>
          <Tabs.Trigger value="routing" className={tabClass}>Routing</Tabs.Trigger>
          <Tabs.Trigger value="channels" className={tabClass}>Channels</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="history"><History /></Tabs.Content>
        <Tabs.Content value="subscribers"><Subscribers /></Tabs.Content>
        <Tabs.Content value="routing"><Routing /></Tabs.Content>
        <Tabs.Content value="channels"><Channels /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
