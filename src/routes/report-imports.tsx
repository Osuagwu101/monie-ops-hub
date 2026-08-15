import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileCheck2,
  FileUp,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Target,
} from "lucide-react";
import { useMemo, useState, type ChangeEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { loadAssistantProfile } from "@/lib/assistant-data";
import { useAuth } from "@/lib/auth-context";
import {
  parseMoniepointReport,
  sha256File,
  type ParsedMoniepointReport,
} from "@/lib/moniepoint-report-parser";
import {
  ingestParsedReport,
  loadRecentReportImports,
  reconcileReport,
  uploadReportSource,
  type ReportIngestResult,
} from "@/lib/report-data";

export const Route = createFileRoute("/report-imports")({
  head: () => ({
    meta: [
      { title: "Official Reports — Monie Ops Hub" },
      {
        name: "description",
        content: "Director-only Moniepoint PDF report ingestion and Tunde reconciliation.",
      },
    ],
  }),
  component: ReportImportsPage,
});

interface ParsedFileState {
  file: File;
  sha256: string;
  report: ParsedMoniepointReport;
}

function ReportImportsPage() {
  const { session, user } = useAuth();
  const queryClient = useQueryClient();
  const [parsed, setParsed] = useState<ParsedFileState | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportIngestResult | null>(null);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: () => loadAssistantProfile(user!.id, session!.access_token),
    enabled: Boolean(user?.id && session?.access_token),
  });

  const isDirector = profileQuery.data?.role === "director";
  const importsQuery = useQuery({
    queryKey: ["recent-report-imports", user?.id],
    queryFn: () => loadRecentReportImports(session!.access_token),
    enabled: Boolean(isDirector && session?.access_token),
  });

  const rollingTargetMet = useMemo(
    () => parsed?.report.rollingRows.filter((row) => row.officialTargetMet).length ?? 0,
    [parsed],
  );

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setParsed(null);
    setResult(null);
    setError(null);
    if (!file) return;

    setParsing(true);
    try {
      const [report, sha256] = await Promise.all([parseMoniepointReport(file), sha256File(file)]);
      setParsed({ file, report, sha256 });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The PDF could not be parsed.");
    } finally {
      setParsing(false);
      event.target.value = "";
    }
  }

  async function handleImport() {
    if (!parsed || !session?.access_token || !parsed.report.canImport) return;
    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const source = await uploadReportSource(
        parsed.report,
        parsed.file,
        parsed.sha256,
        session.access_token,
      );
      const imported = await ingestParsedReport(
        parsed.report,
        parsed.file,
        parsed.sha256,
        source.path,
        session.access_token,
      );
      setResult(imported);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["recent-report-imports"] }),
        queryClient.invalidateQueries({ queryKey: ["portfolio-performance"] }),
        queryClient.invalidateQueries({ queryKey: ["assistant-tasks"] }),
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The report import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function handleReconcile(reportId: string) {
    if (!session?.access_token) return;
    setReconcilingId(reportId);
    setError(null);
    try {
      await reconcileReport(reportId, session.access_token);
      await queryClient.invalidateQueries({ queryKey: ["assistant-tasks"] });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Tunde reconciliation failed.");
    } finally {
      setReconcilingId(null);
    }
  }

  if (profileQuery.isLoading) {
    return <LoadingState label="Checking Director access…" />;
  }

  if (!isDirector) {
    return (
      <div className="mx-auto max-w-3xl py-8">
        <Alert variant="destructive">
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Director access only</AlertTitle>
          <AlertDescription>
            Raw Moniepoint reports and report-import controls are not exposed to the Human
            Operations Assistant.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge>Phase 3</Badge>
          <Badge variant="outline">Official source intake</Badge>
          <Badge variant="secondary">Director only</Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Moniepoint Report Engine</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Upload the official BRM Daily Report PDF. The engine validates the report before import,
          preserves the original PDF as immutable evidence, normalises terminal data, and hands the
          official rolling result to Tunde.
        </p>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Phase 3 import issue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>
            {result.duplicate ? "Report already exists" : "Official report imported"}
          </AlertTitle>
          <AlertDescription>
            {result.duplicate
              ? `The same report source was already ingested for ${result.reportDate}. No duplicate rows were created.`
              : `${result.rowsImported ?? 0} source rows were stored. Tunde reconciled ${result.reconciliation?.tasksReconciled ?? 0} TA tasks.`}
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileUp className="h-5 w-5 text-primary" /> Import official PDF
            </CardTitle>
            <CardDescription>
              Maximum 15 MB. The parser will refuse import if the terminal sections do not reconcile
              with the report summary.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center transition-colors hover:bg-muted/30">
              <FileCheck2 className="h-8 w-8 text-primary" />
              <span className="mt-3 text-sm font-semibold">Choose Moniepoint BRM Daily Report</span>
              <span className="mt-1 text-xs text-muted-foreground">
                PDF only · source file remains immutable
              </span>
              <input
                className="sr-only"
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFile}
                disabled={parsing || importing}
              />
            </label>

            {parsing && (
              <div className="space-y-2 rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" /> Reading official PDF…
                </div>
                <Progress value={55} />
                <p className="text-xs text-muted-foreground">
                  Extracting summary, daily transactions, rolling 7-day transactions and
                  non-transacting terminals.
                </p>
              </div>
            )}

            {parsed && (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{parsed.file.name}</span>
                  <Badge variant={parsed.report.canImport ? "secondary" : "destructive"}>
                    {parsed.report.canImport ? "Validated" : "Blocked"}
                  </Badge>
                </div>
                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>
                    Report date:{" "}
                    <strong className="text-foreground">{parsed.report.reportDate}</strong>
                  </div>
                  <div>
                    BRM: <strong className="text-foreground">{parsed.report.brmName}</strong>
                  </div>
                  <div>
                    Pages: <strong className="text-foreground">{parsed.report.pageCount}</strong>
                  </div>
                  <div>
                    SHA-256:{" "}
                    <strong className="font-mono text-foreground">
                      {parsed.sha256.slice(0, 12)}…
                    </strong>
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={handleImport}
                  disabled={!parsed.report.canImport || importing}
                >
                  {importing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Database className="mr-2 h-4 w-4" />
                  )}
                  Preserve source & import official data
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" /> Parser validation
            </CardTitle>
            <CardDescription>
              Moniepoint's own Target Met flag is retained exactly. Internal checks only detect
              extraction errors; they do not rewrite official outcomes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!parsed ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Choose a report to see the Source-of-Truth validation checks.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MiniMetric
                    label="Terminal activity"
                    value={`${parsed.report.summary.terminalActivityRate}%`}
                  />
                  <MiniMetric
                    label="Assigned terminals"
                    value={`${parsed.report.summary.assignedTerminalCount}`}
                  />
                  <MiniMetric label="Daily rows" value={`${parsed.report.dailyRows.length}`} />
                  <MiniMetric label="Rolling Target Met" value={`${rollingTargetMet}`} />
                </div>

                <div className="space-y-2">
                  {parsed.report.checks.map((check, index) => (
                    <div
                      key={`${check.message}-${index}`}
                      className="flex gap-3 rounded-lg border p-3 text-sm"
                    >
                      {check.level === "pass" ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      )}
                      <div>
                        <Badge
                          variant={check.level === "error" ? "destructive" : "outline"}
                          className="mb-1"
                        >
                          {check.level}
                        </Badge>
                        <p className="leading-5 text-muted-foreground">{check.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Recent official imports</CardTitle>
          <CardDescription>
            Import history is append-only. A newer report never overwrites the evidence from an
            earlier import.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {importsQuery.isLoading ? (
            <LoadingState label="Loading report history…" compact />
          ) : importsQuery.data?.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report date</TableHead>
                    <TableHead>BRM</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Rows</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Tunde</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importsQuery.data.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell className="font-medium">{report.report_date}</TableCell>
                      <TableCell>{report.brm_name ?? "—"}</TableCell>
                      <TableCell className="max-w-[240px] truncate" title={report.source_filename}>
                        {report.source_filename}
                      </TableCell>
                      <TableCell>{report.row_count ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            report.processing_status === "processed" ? "secondary" : "outline"
                          }
                        >
                          {report.processing_status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            report.processing_status !== "processed" || reconcilingId === report.id
                          }
                          onClick={() => handleReconcile(report.id)}
                        >
                          {reconcilingId === report.id ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          )}
                          Recheck
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No official report has been imported yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

function LoadingState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center gap-2 text-sm text-muted-foreground ${compact ? "py-6" : "min-h-[240px]"}`}
    >
      <Loader2 className="h-4 w-4 animate-spin text-primary" /> {label}
    </div>
  );
}
