import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Loader2, LockKeyhole, ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth-context";
import { getCloudConfigurationStatus } from "@/lib/cloud-api";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Team Login — Monie Ops Hub" },
      { name: "description", content: "Secure team access to Monie Ops Hub." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { session, loading, signIn, signUp } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState("sign-in");
  const cloud = getCloudConfigurationStatus();

  useEffect(() => {
    if (!loading && session) void navigate({ to: "/daily-tasks", replace: true });
  }, [loading, navigate, session]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);

    try {
      await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
      await navigate({ to: "/daily-tasks", replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);

    try {
      const result = await signUp(
        String(form.get("email") ?? ""),
        String(form.get("password") ?? ""),
        String(form.get("fullName") ?? ""),
      );

      if (result === "signed_in") {
        await navigate({ to: "/daily-tasks", replace: true });
      } else {
        setNotice("Account created. Check your email to confirm it, then return here to sign in.");
        setMode("sign-in");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border bg-background shadow-xl lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-foreground/15 text-lg font-bold">
              M
            </div>
            <h1 className="mt-8 text-3xl font-bold tracking-tight">Monie Ops Hub</h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-primary-foreground/80">
              A focused workspace for merchant calls, terminal recovery and accountable follow-through.
            </p>
          </div>

          <div className="space-y-4 text-sm">
            <TrustPoint text="Only assigned merchant work is visible to assistants." />
            <TrustPoint text="Human completion never becomes official verification by itself." />
            <TrustPoint text="Every task outcome is recorded for the audit trail." />
          </div>
        </section>

        <section className="p-5 sm:p-8 lg:p-10">
          <div className="mb-7 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary lg:hidden">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Team access</h2>
              <p className="text-sm text-muted-foreground">Use your Monie Ops Hub account.</p>
            </div>
          </div>

          {!cloud.configured && (
            <Alert variant="destructive" className="mb-5">
              <AlertTitle>Cloud configuration missing</AlertTitle>
              <AlertDescription>
                This build does not have the Lovable Cloud environment variables required for sign-in.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive" className="mb-5">
              <AlertTitle>Unable to continue</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {notice && (
            <Alert className="mb-5">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Account created</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}

          <Tabs value={mode} onValueChange={setMode}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="sign-in">Sign in</TabsTrigger>
              <TabsTrigger value="create">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="sign-in" className="mt-6">
              <Card className="border-0 shadow-none">
                <CardHeader className="px-0 pt-0">
                  <CardTitle className="text-lg">Welcome back</CardTitle>
                  <CardDescription>Sign in with your assigned team credentials.</CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                  <form className="space-y-4" onSubmit={handleSignIn}>
                    <Field label="Email" name="email" type="email" autoComplete="email" />
                    <Field
                      label="Password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                    />
                    <Button className="w-full" disabled={submitting || !cloud.configured}>
                      {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Sign in
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="create" className="mt-6">
              <Card className="border-0 shadow-none">
                <CardHeader className="px-0 pt-0">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <UserPlus className="h-4 w-4" /> Create team account
                  </CardTitle>
                  <CardDescription>
                    New registrations always start with Assistant permissions. Director access cannot be self-selected.
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                  <form className="space-y-4" onSubmit={handleSignUp}>
                    <Field label="Full name" name="fullName" autoComplete="name" />
                    <Field label="Email" name="email" type="email" autoComplete="email" />
                    <Field
                      label="Password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                    />
                    <Button className="w-full" disabled={submitting || !cloud.configured}>
                      {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create assistant account
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="mt-6 flex items-start gap-2 rounded-lg bg-muted p-3 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Access is enforced by database Row Level Security, not by hidden buttons or browser-only checks.
          </div>
        </section>
      </div>
    </div>
  );
}

function TrustPoint({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="text-primary-foreground/85">{text}</span>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  minLength,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        minLength={minLength}
        required
      />
    </div>
  );
}
