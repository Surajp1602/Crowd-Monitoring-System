"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ContourField } from "@/components/brand/contour-field";
import { Wordmark } from "@/components/brand/mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Channel = "sms" | "whatsapp" | "email";

const CHANNELS: { id: Channel; label: string }[] = [
  { id: "sms", label: "SMS" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "email", label: "Email" },
];

function Unsubscribe({ token }: { token: string }) {
  const [state, setState] = useState<"working" | "done" | "missing" | "error">("working");
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    apiFetch<void>(`/api/v1/notifications/subscriptions/unsubscribe?token=${encodeURIComponent(token)}`, {
      method: "POST",
      skipAuth: true,
    })
      .then(() => setState("done"))
      .catch((err) => setState(err instanceof ApiError && err.status === 404 ? "missing" : "error"));
  }, [token]);
  return (
    <div className="space-y-3" aria-live="polite">
      <h1 className="display text-4xl text-paper">
        {state === "working" ? "Unsubscribing…" : state === "done" ? "You're unsubscribed." : state === "missing" ? "Already unsubscribed." : "Something went wrong."}
      </h1>
      <p className="text-paper-dim">
        {state === "done" || state === "missing"
          ? "You will not receive further safety notices for this venue."
          : state === "error"
            ? "Please try the link again in a moment."
            : ""}
      </p>
    </div>
  );
}

function SubscribeForm() {
  const [coords, setCoords] = useState<{ lat: string; lon: string }>({ lat: "", lon: "" });
  const [locating, setLocating] = useState(false);
  const [radius, setRadius] = useState(300);
  const [channels, setChannels] = useState<Channel[]>(["sms"]);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ token: string; contact: string } | null>(null);

  function locate() {
    if (!navigator.geolocation) {
      setError("Your browser cannot share location. Enter coordinates instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude.toFixed(6), lon: pos.coords.longitude.toFixed(6) });
        setLocating(false);
      },
      () => {
        setError("Location was not shared. Enter coordinates instead.");
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<{ unsubscribe_token: string; contact: string }>("/api/v1/notifications/subscriptions", {
        method: "POST",
        skipAuth: true,
        body: {
          display_name: name || undefined,
          latitude: Number(coords.lat),
          longitude: Number(coords.lon),
          radius_m: radius,
          channels,
          phone_number: channels.some((c) => c !== "email") ? phone : undefined,
          email: channels.includes("email") ? email : undefined,
        },
      });
      setDone({ token: result.unsubscribe_token, contact: result.contact });
    } catch (err) {
      const detail = err instanceof ApiError ? (err.detail as { detail?: unknown })?.detail : null;
      setError(
        Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg?.replace("Value error, ", "")).join(" ")
          : err instanceof ApiError
            ? err.message
            : "Could not subscribe. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    const link = typeof window !== "undefined" ? `${window.location.origin}/subscribe?unsubscribe=${done.token}` : "";
    return (
      <div className="space-y-4" aria-live="polite">
        <h1 className="display text-4xl text-paper">You&apos;re subscribed.</h1>
        <p className="text-paper-dim">
          Safety notices for incidents within <span className="num text-paper">{radius} m</span> will go to{" "}
          <span className="num text-paper">{done.contact}</span>. Every message includes a link to stop them.
        </p>
        <div className="panel p-4">
          <p className="eyebrow mb-2">Your unsubscribe link</p>
          <p className="num break-all text-xs text-paper">{link}</p>
        </div>
      </div>
    );
  }

  const needsPhone = channels.some((c) => c !== "email");
  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <p className="eyebrow mb-3">
          <span className="text-amber">01</span>
          <span className="mx-1.5 opacity-60">—</span>Public safety notices
        </p>
        <h1 className="display text-[clamp(2.2rem,4vw,3.4rem)] text-paper">Know before you go.</h1>
        <p className="mt-3 max-w-[48ch] text-paper-dim">
          Get a short message when this venue&apos;s safety system detects a dangerous crowd, an emergency
          evacuation or an area to avoid near you. No marketing, ever.
        </p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm text-paper">Where</legend>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="lat">Latitude</Label>
            <Input id="lat" required inputMode="decimal" value={coords.lat} onChange={(e) => setCoords({ ...coords, lat: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lon">Longitude</Label>
            <Input id="lon" required inputMode="decimal" value={coords.lon} onChange={(e) => setCoords({ ...coords, lon: e.target.value })} />
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={locate} disabled={locating}>
          {locating ? "Locating…" : "Use my location"}
        </Button>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <Label htmlFor="radius">Notify me within</Label>
            <span className="num text-sm text-paper">{radius} m</span>
          </div>
          <input id="radius" type="range" min={100} max={2000} step={50} value={radius} onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full accent-[var(--amber)]" />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm text-paper">How</legend>
        <div className="flex gap-2">
          {CHANNELS.map((c) => {
            const on = channels.includes(c.id);
            return (
              <button key={c.id} type="button" aria-pressed={on}
                onClick={() => setChannels((cur) => (on ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}
                className={cn("rounded-[4px] border px-3 py-2 text-sm transition-colors",
                  on ? "border-amber/70 bg-amber/10 text-paper" : "border-rule text-paper-dim hover:text-paper")}>
                {c.label}
              </button>
            );
          })}
        </div>
        {needsPhone && (
          <div className="space-y-1.5">
            <Label htmlFor="phone">Mobile number</Label>
            <Input id="phone" type="tel" autoComplete="tel" required placeholder="+91 98123 45678" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        )}
        {channels.includes("email") && (
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="name">Name (optional)</Label>
          <Input id="name" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </fieldset>

      <label className="flex items-start gap-3 text-sm text-paper-dim">
        <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-[var(--amber)]" />
        I agree to receive safety notices for this venue. My contact details are used only for these notices and I
        can unsubscribe from any message.
      </label>

      {error && <p role="alert" className="text-sm text-severity-critical">{error}</p>}

      <Button type="submit" size="lg" disabled={submitting || channels.length === 0}>
        {submitting ? "Subscribing…" : "Subscribe"}
      </Button>
    </form>
  );
}

function SubscribeView() {
  const params = useSearchParams();
  const token = params.get("unsubscribe");
  return token ? <Unsubscribe token={token} /> : <SubscribeForm />;
}

export default function SubscribePage() {
  return (
    <div className="grid min-h-screen bg-ink lg:grid-cols-12">
      <section className="grain relative hidden overflow-hidden border-r border-rule lg:col-span-5 lg:block">
        <ContourField className="absolute inset-0 h-full w-full" />
        <div className="relative p-10">
          <Wordmark />
        </div>
      </section>
      <main className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:col-span-7 lg:px-20">
        <div className="mb-10 lg:hidden">
          <Wordmark />
        </div>
        <div className="w-full max-w-xl">
          <Suspense fallback={null}>
            <SubscribeView />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
