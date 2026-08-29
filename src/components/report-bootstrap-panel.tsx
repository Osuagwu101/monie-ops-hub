import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Contact,
  FileCheck2,
  Loader2,
  PhoneOff,
  PlayCircle,
  SearchCheck,
} from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth-context";
import {
  bootstrapManualReport,
  loadContactResolutions,
  loadManualBootstrapStatus,
  type ContactResolutionRecord,
} from "@/lib/report-bootstrap-data";

const statusLabel: Record<ContactResolutionRecord["resolution_status"], string> = {
  verified: "VERIFIED",
  review: "REVIEW",
  no_contact: "NO CONTACT",
};

export function ReportBootstrapPanel() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const accessToken = session?.access_token;
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["manual-bootstrap-status"],
    queryFn: () => loadManualBootstrapStatus(accessToken!),
    enabled: Boolean(accessToken),
  });

  const status = statusQuery.data;

  const resolutionsQuery = useQuery({
    queryKey: ["contact-resolutions", status?.reportId],
    queryFn: () => loadContactResolutions(status!.reportId!, accessToken!),
    enabled: Boolean(accessToken && status?.reportId),
  });

  const bootstrap = useMutation({
    mutationFn: () => bootstrapManualReport(status!.reportId!, accessToken!),
    onSuccess: async (result) => {
      setError(null);
      setMessage(
        `Bootstrap complete for ${result.reportDate}: ${result.verifiedMatches} verified, ${result.reviewRequired} review, ${result.noContactBlockers} without contact, ${result.tasksCreated} tasks created.`,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["manual-bootstrap-status"] }),
        queryClient.invalidateQueries({ queryKey: ["contact-resolutions"] }),
        queryClient.invalidateQueries({ queryKey: ["assistant-tasks"] }),
      ]);
    },
    onError: (caught: unknown) => {
      setMessage(null);
      setError(caught instanceof Error ? caught.message : "The report bootstrap failed.");
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <SearchCheck className="h-5 w-5 text-primary" /> Manual report bootstrap
            </CardTitle>
            <CardDescription>
              Resolves merchant contacts only where the report terminal ID and serial map to the same
              merchant, then creates the day's tasks from verified rows only.
            </CardDescription>
          </div>
          <Button
            onClick={() => bootstrap.mutate()}
            disabled={!status?.reportId || bootstrap.isPending}
          >
            {bootstrap.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" />
            )}
            Resolve contacts &amp; create tasks
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Bootstrap issue</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {message && !error && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Bootstrap update</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        {statusQuery.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading bootstrap status…
          </div>
        ) : !status?.reportImported ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No processed official report yet. Upload a BRM Daily Report PDF on the Official Reports
            page first.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary">
                <FileCheck2 className="mr-1 h-3 w-3" /> Report imported
              </Badge>
              <span>
                Latest report date:{" "}
                <strong className="text-foreground">{status.latestReportDate}</strong>
              </span>
              {status.sourceFilename && <span>· {status.sourceFilename}</span>}
              {status.lastResolvedAt && (
                <span>· Resolved {new Date(status.lastResolvedAt).toLocaleString()}</span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Metric label="Rows parsed" value={status.rowsParsed} />
              <Metric
                label="Contacts cached"
                value={status.contactsCached}
                icon={<Contact className="h-3.5 w-3.5" />}
              />
              <Metric label="Verified matches" value={status.verifiedMatches} />
              <Metric label="Review required" value={status.reviewRequired} warn />
              <Metric
                label="No-contact blockers"
                value={status.noContactBlockers}
                warn
                icon={<PhoneOff className="h-3.5 w-3.5" />}
              />
              <Metric label="Tasks created" value={status.tasksCreated} />
            </div>

            {resolutionsQuery.data?.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Terminal</TableHead>
                      <TableHead>Business</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead>Task</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resolutionsQuery.data.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs">
                          {row.terminal_external_id}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={row.business_name}>
                          {row.business_name}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.resolution_status === "verified"
                                ? "secondary"
                                : row.resolution_status === "review"
                                  ? "outline"
                                  : "destructive"
                            }
                          >
                            {statusLabel[row.resolution_status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                          {row.resolution_reason}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.phone_number ?? row.account_number ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">{row.task_created ? "Yes" : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Run the bootstrap to resolve contacts for this report.
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  warn = false,
  icon,
}: {
  label: string;
  value: number;
  warn?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div
        className={`mt-1 text-2xl font-bold ${warn && value > 0 ? "text-destructive" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
