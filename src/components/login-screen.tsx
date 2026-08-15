import {
  CheckCircle2,
  Download,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MonieBrmMark } from "@/components/monie-brm-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth-context";
import { getCloudConfigurationStatus } from "@/lib/cloud-api";

const RESERVED_ADMIN_EMAIL = "nnaemekasolomon31@gmail.com";

export function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState("sign-in");
  const cloud = getCloudConfigurationStatus();

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);

    try {
      await signIn(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdminSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);

    try {
      const result = await signUp(
        RESERVED_ADMIN_EMAIL,
        String(form.get("password") ?? ""),
        String(form.get("fullName") ?? "Nnaemeka Solomon"),
      );

      if (result === "verify_email") {
        setNotice(
          "Admin account created. Check the reserved Admin email to confirm it, then return here to sign in.",
        );
        setMode("sign-in");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to set up the Admin account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border bg-background shadow-xl lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden bg-primary p-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="rounded-xl bg-white p-3">
              <MonieBrmMark />
            </div>
            <h1 className="mt-8 text-3xl font-bold tracking-tight">Monie Ops Hub</h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-primary-foreground/80">
              A focused workspace for merchant calls, terminal recovery and accountable
              follow-through.
            </p>
          </div>

          <div className="space-y-4 text-sm">
            <TrustPoint text="Public account registration is disabled." />
            <TrustPoint text="Staff accounts are provisioned only by the Admin." />
            <TrustPoint text="Every task outcome is recorded for the audit trail." />
          </div>
        </section>

        <section className="p-5 sm:p-8 lg:p-10">
          <div className="mb-7 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary lg:hidden">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Secure access</h2>
              <p className="text-sm text-muted-foreground">Admin and Admin-created staff only.</p>
            </div>
          </div>

          {!cloud.configured && (
            <Alert variant="destructive" className="mb-5">
              <AlertTitle>Cloud configuration missing</AlertTitle>
              <AlertDescription>
                This build does not have the Lovable Cloud environment variables required for
                sign-in.
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
              <AlertTitle>Admin account created</AlertTitle>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}

          <Tabs value={mode} onValueChange={setMode}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="sign-in">Sign in</TabsTrigger>
              <TabsTrigger value="admin-setup">Set up Admin</TabsTrigger>
            </TabsList>

            <TabsContent value="sign-in" className="mt-6">
              <Card className="border-0 shadow-none">
                <CardHeader className="px-0 pt-0">
                  <CardTitle className="text-lg">Welcome back</CardTitle>
                  <CardDescription>
                    Sign in with your Admin or Admin-created staff credentials.
                  </CardDescription>
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

            <TabsContent value="admin-setup" className="mt-6">
              <Card className="border-0 shadow-none">
                <CardHeader className="px-0 pt-0">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <UserRoundCog className="h-4 w-4" /> One-time Admin setup
                  </CardTitle>
                  <CardDescription>
                    This setup is locked to the reserved Admin identity. No other email can register
                    from this screen or directly through Auth.
                  </CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                  <form className="space-y-4" onSubmit={handleAdminSetup}>
                    <Field
                      label="Admin name"
                      name="fullName"
                      autoComplete="name"
                      defaultValue="Nnaemeka Solomon"
                    />
                    <div className="space-y-2">
                      <Label>Reserved Admin email</Label>
                      <Input value={RESERVED_ADMIN_EMAIL} readOnly disabled />
                    </div>
                    <Field
                      label="Create password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                    />
                    <Button className="w-full" disabled={submitting || !cloud.configured}>
                      {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create my Admin account
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <Button variant="outline" className="mt-6 w-full gap-2" asChild>
            <a href="/app-download">
              <Download className="h-4 w-4" />
              Download Moniepoint BRM App
            </a>
          </Button>

          <div className="mt-4 flex items-start gap-2 rounded-lg bg-muted p-3 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Public signup is blocked at the Auth database boundary. Future Staff Support Agents are
            created from the Admin portal only.
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
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
  defaultValue?: string;
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
        defaultValue={defaultValue}
        required
      />
    </div>
  );
}
