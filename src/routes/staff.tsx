import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadAssistantProfile } from "@/lib/assistant-data";
import { createStaffAccount, loadStaffAccounts } from "@/lib/admin-users";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/staff")({
  head: () => ({
    meta: [
      { title: "Staff Accounts — Monie Ops Hub" },
      { name: "description", content: "Admin-only staff account provisioning." },
    ],
  }),
  component: StaffAccountsPage,
});

function StaffAccountsPage() {
  const { session, user } = useAuth();
  const queryClient = useQueryClient();
  const accessToken = session?.access_token ?? "";
  const [notice, setNotice] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => loadAssistantProfile(user!.id, accessToken),
    enabled: Boolean(user?.id && accessToken),
  });
  const isDirector = profileQuery.data?.role === "director";

  const staffQuery = useQuery({
    queryKey: ["staff-accounts"],
    queryFn: () => loadStaffAccounts(accessToken),
    enabled: Boolean(isDirector && accessToken),
  });

  const createMutation = useMutation({
    mutationFn: (input: { fullName: string; email: string; password?: string }) =>
      createStaffAccount(input, accessToken),
    onSuccess: async (result) => {
      setNotice(
        result.mode === "invited"
          ? "Staff account created. The staff member can set their password from the generated recovery link."
          : "Staff account created successfully.",
      );
      await queryClient.invalidateQueries({ queryKey: ["staff-accounts"] });
    },
  });

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    const form = new FormData(event.currentTarget);
    createMutation.mutate({
      fullName: String(form.get("fullName") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? "") || undefined,
    });
    event.currentTarget.reset();
  }

  if (profileQuery.isLoading) {
    return <LoadingState label="Checking Admin access…" />;
  }

  if (!isDirector) {
    return (
      <Alert variant="destructive" className="mx-auto max-w-3xl">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Admin access required</AlertTitle>
        <AlertDescription>Only the Admin can create or review staff accounts.</AlertDescription>
      </Alert>
    );
  }

  const error = createMutation.error instanceof Error ? createMutation.error.message : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge>Admin only</Badge>
          <Badge variant="outline">No public signup</Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Staff Accounts</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Staff Support Agent accounts are created here by the Admin. The public login screen does
          not offer account registration, and direct public signup is blocked at the Auth database
          boundary.
        </p>
      </section>

      {notice && (
        <Alert>
          <UserPlus className="h-4 w-4" />
          <AlertTitle>Staff account ready</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Unable to create staff account</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" /> Create Staff Support Agent
            </CardTitle>
            <CardDescription>
              Create the current support person now; add more staff later from the same Admin page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleCreate}>
              <Field label="Full name" name="fullName" autoComplete="name" />
              <Field label="Email" name="email" type="email" autoComplete="email" />
              <div className="space-y-2">
                <Label htmlFor="password">Temporary password (optional)</Label>
                <Input id="password" name="password" type="password" minLength={8} />
                <p className="text-xs leading-5 text-muted-foreground">
                  Leave this blank if the staff member should set their own password. The account is
                  still created by Admin; it is not a public signup.
                </p>
              </div>
              <Button disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create staff account
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersRound className="h-5 w-5 text-primary" /> Staff Support Agents
            </CardTitle>
            <CardDescription>Current and future staff accounts created by Admin.</CardDescription>
          </CardHeader>
          <CardContent>
            {staffQuery.isLoading ? (
              <LoadingState compact label="Loading staff…" />
            ) : staffQuery.data?.length ? (
              <div className="space-y-3">
                {staffQuery.data.map((staff) => (
                  <div key={staff.id} className="flex items-center justify-between gap-3 rounded-lg border p-4">
                    <div>
                      <div className="font-medium">{staff.full_name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Staff Support Agent · Created {new Date(staff.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge variant={staff.is_active ? "secondary" : "outline"}>
                      {staff.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No staff account exists yet. Create the first Staff Support Agent when ready.
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} autoComplete={autoComplete} required />
    </div>
  );
}

function LoadingState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center gap-2 text-sm text-muted-foreground ${compact ? "py-8" : "min-h-[280px]"}`}
    >
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}
