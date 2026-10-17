"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, apiFetch } from "@/lib/api-client";
import { relativeTime } from "@/lib/format";
import type { Page, User } from "@/lib/types";

type StaffUser = User & { phone_number: string | null; notify_enabled: boolean };

const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  supervisor: "Supervisor",
  security_officer: "Security officer",
  viewer: "Viewer",
};
const ASSIGNABLE = ["supervisor", "security_officer", "viewer"];

function useUsers() {
  return useQuery({ queryKey: ["users"], queryFn: () => apiFetch<Page<StaffUser>>("/api/v1/users?page_size=100") });
}

function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Record<string, unknown> }) =>
      apiFetch<StaffUser>(`/api/v1/users/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

function UserDialog({ user, open, onOpenChange }: { user: StaffUser | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const update = useUpdateUser();
  const editing = Boolean(user);
  const [form, setForm] = useState({
    full_name: user?.full_name ?? "",
    email: user?.email ?? "",
    password: "",
    role_name: (user?.role?.name ?? "security_officer") as string,
    phone_number: user?.phone_number ?? "",
    notify_enabled: user?.notify_enabled ?? true,
  });
  const create = useMutation({
    mutationFn: () =>
      apiFetch<StaffUser>("/api/v1/auth/register", {
        method: "POST",
        body: { email: form.email, password: form.password, full_name: form.full_name, role_name: form.role_name, phone_number: form.phone_number || null },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
  const isAdmin = user?.role?.name === "admin";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${user!.full_name}` : "Add a user"}</DialogTitle>
          <DialogDescription>
            Staff with a phone number receive SMS or WhatsApp alerts when routing allows it.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (user) {
              await update.mutateAsync({
                id: user.id,
                input: {
                  full_name: form.full_name,
                  ...(isAdmin ? {} : { role_name: form.role_name }),
                  phone_number: form.phone_number || null,
                  notify_enabled: form.notify_enabled,
                  ...(form.password ? { password: form.password } : {}),
                },
              });
              toast.success("User saved");
            } else {
              await create.mutateAsync();
              toast.success(`${form.full_name} added`);
            }
            onOpenChange(false);
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : "Could not save the user");
          }
        }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="u-name">Full name</Label>
              <Input id="u-name" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-email">Email</Label>
              <Input id="u-email" type="email" required disabled={editing} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-role">Role</Label>
              <select id="u-role" disabled={isAdmin} value={form.role_name} onChange={(e) => setForm({ ...form, role_name: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-ink px-2 text-sm">
                {(isAdmin ? ["admin"] : ASSIGNABLE).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-phone">Mobile (international)</Label>
              <Input id="u-phone" type="tel" placeholder="+919812345678" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-pass">{editing ? "New password" : "Password"}</Label>
              <Input id="u-pass" type="password" autoComplete="new-password" minLength={8} required={!editing}
                placeholder={editing ? "Unchanged" : "At least 8 characters"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-paper-dim">
            <input type="checkbox" checked={form.notify_enabled} onChange={(e) => setForm({ ...form, notify_enabled: e.target.checked })} className="size-4 accent-[var(--amber)]" />
            Receive alert notifications
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={update.isPending || create.isPending}>{editing ? "Save" : "Add user"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const { data, isLoading } = useUsers();
  const update = useUpdateUser();
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <PageHeader
        index="10"
        eyebrow="Operate"
        title="Users"
        description="Who can sign in, what they can do, and who gets alerted."
        actions={<Button onClick={() => setCreating(true)}><Plus /> Add user</Button>}
      />
      <Card>
        <CardContent className="pt-3">
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Alerts</TableHead>
                  <TableHead>Last sign-in</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.items ?? []).map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <p className="text-paper">{u.full_name}</p>
                      <p className="text-xs text-paper-faint">{u.email}</p>
                    </TableCell>
                    <TableCell className="text-paper-dim">{ROLE_LABEL[u.role?.name ?? ""] ?? u.role?.name ?? "—"}</TableCell>
                    <TableCell className="num text-xs text-paper-dim">{u.phone_number ?? "—"}</TableCell>
                    <TableCell>{u.notify_enabled ? <Badge variant="success">On</Badge> : <Badge variant="muted">Off</Badge>}</TableCell>
                    <TableCell className="text-paper-dim">{relativeTime(u.last_login_at)}</TableCell>
                    <TableCell>{u.is_active ? <Badge variant="outline">Active</Badge> : <Badge variant="muted">Disabled</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Edit</Button>
                      {u.role?.name !== "admin" && (
                        <Button size="sm" variant="ghost" onClick={async () => {
                          try {
                            await update.mutateAsync({ id: u.id, input: { is_active: !u.is_active } });
                            toast.success(u.is_active ? `${u.full_name} disabled` : `${u.full_name} enabled`);
                          } catch (err) {
                            toast.error(err instanceof ApiError ? err.message : "Could not update");
                          }
                        }}>
                          {u.is_active ? "Disable" : "Enable"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {(creating || editing) && (
        <UserDialog key={editing?.id ?? "new"} user={editing} open onOpenChange={(o) => { if (!o) { setEditing(null); setCreating(false); } }} />
      )}
    </div>
  );
}
