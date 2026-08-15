import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadAssistantProfile } from "@/lib/assistant-data";
import {
  loadAutomationConfig,
  loadAutomationRuns,
  loadAutomationSecretStatus,
  queueAutomationRun,
  rotateAutomationBridgeToken,
  setAutomationSecret,
  updateAutomationConfig,
  type AutomationConfigInput,
  type AutomationRunRecord,
} from "@/lib/automation-data";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/automation")({
  head: () => ({
    meta: [
      { title: "Secure Automation — Monie Ops Hub" },
      {
        name: "description",
        content: "Director-only scheduled Moniepoint report retrieval and automation operations.",
      },
    ],
  }),
  component: AutomationPage,
});

const defaultForm: AutomationConfigInput = {
  enabled: false,
  moniepointLoginUrl: null,
  allowedDomains: [],
  proxyCountryCode: "ng",
  maxSteps: 100,
  maxAttempts: 3,
  retryBackoffMinutes: 10,
  morningAuditTime: "08:30",
  morningRefreshTime: "09:00",
  eveningRefreshTime: "18:00",
};

function AutomationPage() {
  const { session, user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AutomationConfigInput>(defaultForm);
  const [domainsText, setDomainsText] = useState("");
  const [browserUseKey, setBrowserUseKey] = useState("");
  const [moniepointUsername, setMoniepointUsername] = useState("");
  const [moniepointPassword, setMoniepointPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => loadAssistantProfile(user!.id, session!.access_token),
    enabled: Boolean(user?.id && session?.access_token),
  });
  const isDirector = profileQuery.data?.role === "director";

  const configQuery = useQuery({
    queryKey: ["automation-config"],
    queryFn: () => loadAutomationConfig(session!.access_token),
    enabled: Boolean(isDirector && session?.access_token),
  });
  const secretQuery = useQuery({
    queryKey: ["automation-secret-status"],
    queryFn: () => loadAutomationSecretStatus(session!.access_token),
    enabled: Boolean(isDirector && session?.access_token),
  });
  const runsQuery = useQuery({
    queryKey: ["automation-runs"],
    queryFn: () => loadAutomationRuns(session!.access_token),
    enabled: Boolean(isDirector && session?.access_token),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    const config = configQuery.data;
    if (!config) return;
    setForm({
      enabled: config.enabled,
      moniepointLoginUrl: config.moniepoint_login_url,
      allowedDomains: config.allowed_domains,
      proxyCountryCode: config.proxy_country_code,
      maxSteps: config.max_steps,
      maxAttempts: config.max_attempts,
      retryBackoffMinutes: config.retry_backoff_minutes,
      morningAuditTime: config.morning_audit_time.slice(0, 5),
      morningRefreshTime: config.morning_refresh_time.slice(0, 5),
      eveningRefreshTime: config.evening_refresh_time.slice(0, 5),
    });
    setDomainsText(config.allowed_domains.join(", "));
  }, [configQuery.data]);

  const secretsReady = Boolean(
    secretQuery.data?.browserUseApiKeyConfigured &&
    secretQuery.data?.moniepointUsernameConfigured &&
    secretQuery.data?.moniepointPasswordConfigured &&
    secretQuery.data?.bridgeConfigured,
  );
  const activeRun = useMemo(
    () =>
      runsQuery.data?.find((run) =>
        ["queued", "dispatching", "browser_running", "polling", "retry_wait"].includes(run.status),
      ) ?? null,
    [runsQuery.data],
  );

  const saveConfigMutation = useMutation({
    mutationFn: () => {
      if (!session?.access_token) throw new Error("Session expired.");
      const domains = domainsText
        .split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean);
      return updateAutomationConfig({ ...form, allowedDomains: domains }, session.access_token);
    },
    onSuccess: async () => {
      setError(null);
      setMessage("Automation configuration saved. Cron schedules were refreshed.");
      await queryClient.invalidateQueries({ queryKey: ["automation-config"] });
    },
    onError: (caught) => setError(errorText(caught)),
  });

  const secretMutation = useMutation({
    mutationFn: async () => {
      if (!session?.access_token) throw new Error("Session expired.");
      const token = session.access_token;
      if (browserUseKey.trim()) {
        await setAutomationSecret("browser_use_api_key", browserUseKey.trim(), token);
      }
      if (moniepointUsername.trim()) {
        await setAutomationSecret("moniepoint_username", moniepointUsername.trim(), token);
      }
      if (moniepointPassword) {
        await setAutomationSecret("moniepoint_password", moniepointPassword, token);
      }
    },
    onSuccess: async () => {
      setBrowserUseKey("");
      setMoniepointUsername("");
      setMoniepointPassword("");
      setError(null);
      setMessage(
        "Secure credentials updated in Vault. Their values are not readable from this portal.",
      );
      await queryClient.invalidateQueries({ queryKey: ["automation-secret-status"] });
    },
    onError: (caught) => setError(errorText(caught)),
  });

  const runMutation = useMutation({
    mutationFn: () => {
      if (!session?.access_token) throw new Error("Session expired.");
      return queueAutomationRun(session.access_token);
    },
    onSuccess: async (result) => {
      setError(null);
      setMessage(
        result.queued
          ? "Manual retrieval queued. The worker will update this page as it progresses."
          : `Retrieval was not queued${result.reason ? `: ${result.reason.replace(/_/g, " ")}` : "."}`,
      );
      await queryClient.invalidateQueries({ queryKey: ["automation-runs"] });
    },
    onError: (caught) => setError(errorText(caught)),
  });

  const rotateMutation = useMutation({
    mutationFn: () => {
      if (!session?.access_token) throw new Error("Session expired.");
      return rotateAutomationBridgeToken(session.access_token);
    },
    onSuccess: async () => {
      setError(null);
      setMessage("Internal worker bridge token rotated.");
      await queryClient.invalidateQueries({ queryKey: ["automation-secret-status"] });
    },
    onError: (caught) => setError(errorText(caught)),
  });

  if (profileQuery.isLoading) return <LoadingState label="Checking Director access…" />;
  if (!isDirector) {
    return (
      <div className="mx-auto max-w-3xl py-8">
        <Alert variant="destructive">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Director access only</AlertTitle>
          <AlertDescription>
            Browser automation, credentials and scheduled report retrieval are not exposed to the
            Human Operations Assistant.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge>Phase 5</Badge>
          <Badge variant="outline">Secure automation</Badge>
          <Badge variant={form.enabled ? "default" : "secondary"}>
            {form.enabled ? "Scheduled retrieval enabled" : "Scheduled retrieval disabled"}
          </Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Secure Report Automation</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
          Schedule official Moniepoint PDF retrieval without exposing your BRM credentials to the
          assistant, browser UI or GitHub. Retrieved PDFs pass through the same immutable Phase 3
          parser and Tunde verification pipeline as manual imports.
        </p>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Automation issue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {message && !error && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Automation update</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <StatusCard
          title="Credential vault"
          value={secretsReady ? "Ready" : "Setup required"}
          detail="Browser Use key + Moniepoint login stay encrypted in Supabase Vault."
          ready={secretsReady}
        />
        <StatusCard
          title="Schedule"
          value={`${form.morningAuditTime} / ${form.morningRefreshTime} / ${form.eveningRefreshTime}`}
          detail="Lagos time: final audit, morning refresh, evening refresh."
          ready={form.enabled}
        />
        <StatusCard
          title="Current worker"
          value={activeRun ? humanize(activeRun.status) : "Idle"}
          detail={
            activeRun
              ? `Attempt ${activeRun.attempt_count} · ${humanize(activeRun.trigger_kind)}`
              : "Only one report retrieval can run at a time."
          }
          ready={!activeRun}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" /> Secure credentials
            </CardTitle>
            <CardDescription>
              Enter only the values you want to change. Saved values are never returned to the
              browser or displayed again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <SecretField
              id="browser-use-key"
              label="Browser Use API key"
              configured={secretQuery.data?.browserUseApiKeyConfigured ?? false}
              value={browserUseKey}
              onChange={setBrowserUseKey}
              type="password"
            />
            <SecretField
              id="moniepoint-username"
              label="Moniepoint username"
              configured={secretQuery.data?.moniepointUsernameConfigured ?? false}
              value={moniepointUsername}
              onChange={setMoniepointUsername}
              type="text"
            />
            <SecretField
              id="moniepoint-password"
              label="Moniepoint password"
              configured={secretQuery.data?.moniepointPasswordConfigured ?? false}
              value={moniepointPassword}
              onChange={setMoniepointPassword}
              type="password"
            />
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                onClick={() => secretMutation.mutate()}
                disabled={
                  secretMutation.isPending ||
                  (!browserUseKey && !moniepointUsername && !moniepointPassword)
                }
              >
                {secretMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save to Vault
              </Button>
              <Button
                variant="outline"
                onClick={() => rotateMutation.mutate()}
                disabled={rotateMutation.isPending}
              >
                <RotateCw className="mr-2 h-4 w-4" /> Rotate worker token
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-primary" /> Retrieval configuration
            </CardTitle>
            <CardDescription>
              Automation remains off until credentials, login scope and schedules are configured.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="automation-enabled">Enable scheduled retrieval</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Manual “Run now” remains Director-controlled.
                </p>
              </div>
              <Switch
                id="automation-enabled"
                checked={form.enabled}
                onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))}
              />
            </div>
            <Field
              id="login-url"
              label="Moniepoint BRM login URL"
              value={form.moniepointLoginUrl ?? ""}
              onChange={(value) =>
                setForm((current) => ({ ...current, moniepointLoginUrl: value || null }))
              }
              placeholder="https://…"
            />
            <Field
              id="allowed-domains"
              label="Allowed login domains (comma separated)"
              value={domainsText}
              onChange={setDomainsText}
              placeholder="portal.example.com, *.identity.example.com"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <TimeField
                label="8:30 audit"
                value={form.morningAuditTime}
                onChange={(value) => setForm((c) => ({ ...c, morningAuditTime: value }))}
              />
              <TimeField
                label="Morning refresh"
                value={form.morningRefreshTime}
                onChange={(value) => setForm((c) => ({ ...c, morningRefreshTime: value }))}
              />
              <TimeField
                label="Evening refresh"
                value={form.eveningRefreshTime}
                onChange={(value) => setForm((c) => ({ ...c, eveningRefreshTime: value }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberField
                label="Max steps"
                value={form.maxSteps}
                min={10}
                max={250}
                onChange={(value) => setForm((c) => ({ ...c, maxSteps: value }))}
              />
              <NumberField
                label="Max attempts"
                value={form.maxAttempts}
                min={1}
                max={5}
                onChange={(value) => setForm((c) => ({ ...c, maxAttempts: value }))}
              />
              <NumberField
                label="Retry backoff (min)"
                value={form.retryBackoffMinutes}
                min={2}
                max={60}
                onChange={(value) => setForm((c) => ({ ...c, retryBackoffMinutes: value }))}
              />
            </div>
            <Field
              id="proxy-country"
              label="Browser proxy country code"
              value={form.proxyCountryCode ?? ""}
              onChange={(value) =>
                setForm((current) => ({ ...current, proxyCountryCode: value || null }))
              }
              placeholder="ng"
            />
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                onClick={() => saveConfigMutation.mutate()}
                disabled={saveConfigMutation.isPending}
              >
                {saveConfigMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save configuration
              </Button>
              <Button
                variant="outline"
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || Boolean(activeRun) || !secretsReady}
              >
                <Play className="mr-2 h-4 w-4" /> Run now
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Workflow className="h-5 w-5 text-primary" /> Retrieval history
              </CardTitle>
              <CardDescription>
                Attempts, retries, failures and successful official imports are retained for audit.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => runsQuery.refetch()}
              disabled={runsQuery.isFetching}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${runsQuery.isFetching ? "animate-spin" : ""}`} />{" "}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {runsQuery.data?.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Trigger</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Report</TableHead>
                  <TableHead>Issue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runsQuery.data.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              No scheduled or manual retrieval attempt has run yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RunRow({ run }: { run: AutomationRunRecord }) {
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-xs">
        {new Date(run.created_at).toLocaleString()}
      </TableCell>
      <TableCell>{humanize(run.trigger_kind)}</TableCell>
      <TableCell>
        <Badge
          variant={
            run.status === "succeeded"
              ? "secondary"
              : run.status === "failed"
                ? "destructive"
                : "outline"
          }
        >
          {humanize(run.status)}
        </Badge>
      </TableCell>
      <TableCell>{run.attempt_count}</TableCell>
      <TableCell className="font-mono text-xs">
        {run.report_id ? `${run.report_id.slice(0, 8)}…` : "—"}
      </TableCell>
      <TableCell className="max-w-sm text-xs text-muted-foreground">
        {run.last_error_message ?? "—"}
      </TableCell>
    </TableRow>
  );
}

function StatusCard({
  title,
  value,
  detail,
  ready,
}: {
  title: string;
  value: string;
  detail: string;
  ready: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="flex items-center gap-2 text-xl">
          {ready ? (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}{" "}
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs leading-5 text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

function SecretField({
  id,
  label,
  configured,
  value,
  onChange,
  type,
}: {
  id: string;
  label: string;
  configured: boolean;
  value: string;
  onChange: (value: string) => void;
  type: "text" | "password";
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Badge variant={configured ? "secondary" : "outline"}>
          {configured ? "Configured" : "Not configured"}
        </Badge>
      </div>
      <Input
        id={id}
        type={type}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={configured ? "Enter a replacement value" : "Enter value"}
      />
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type="time" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function errorText(caught: unknown) {
  return caught instanceof Error ? caught.message : "The automation request failed.";
}
