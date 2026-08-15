import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Phone, Store, TabletSmartphone } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadAssistantTasks, localDateKey } from "@/lib/assistant-data";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/merchant-list")({
  head: () => ({
    meta: [
      { title: "Merchants — Monie Ops Hub" },
      {
        name: "description",
        content: "Merchants and terminals linked to assigned operations work.",
      },
    ],
  }),
  component: MerchantListPage,
});

function MerchantListPage() {
  const { session, user } = useAuth();
  const date = localDateKey();
  const tasksQuery = useQuery({
    queryKey: ["assistant-tasks", date, user?.id],
    queryFn: () => loadAssistantTasks(date, session!.access_token),
    enabled: Boolean(session?.access_token),
  });

  const tasks = tasksQuery.data ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline">Phase 2</Badge>
          <Badge variant="secondary">Least-privilege merchant view</Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Assigned Merchants</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Assistants only receive merchant and terminal details connected to work assigned to them.
          Director access remains portfolio-wide.
        </p>
      </section>

      {tasksQuery.isLoading && (
        <div className="flex items-center gap-2 rounded-lg border p-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Loading assigned merchants…
        </div>
      )}

      {tasksQuery.isError && (
        <Alert variant="destructive">
          <AlertTitle>Unable to load merchants</AlertTitle>
          <AlertDescription>
            {tasksQuery.error instanceof Error
              ? tasksQuery.error.message
              : "Secure data request failed."}
          </AlertDescription>
        </Alert>
      )}

      {!tasksQuery.isLoading && !tasksQuery.isError && tasks.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No merchant is linked to today's assigned queue yet.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {tasks.map((task) => (
          <Card key={task.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Store className="h-4 w-4 text-primary" />
                    {task.merchant?.business_name ?? "Assigned merchant"}
                  </CardTitle>
                  <CardDescription className="mt-1">{task.reason}</CardDescription>
                </div>
                <Badge variant={task.task_type === "TA" ? "default" : "secondary"}>
                  {task.task_type}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <TabletSmartphone className="h-3.5 w-3.5" /> Terminal ID
                  </div>
                  <div className="mt-1 font-semibold">
                    {task.terminal?.terminal_id ?? "Not linked"}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Serial number</div>
                  <div className="mt-1 font-semibold">{task.terminal?.serial_number ?? "—"}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <div className="text-sm text-muted-foreground">
                  {task.merchant?.phone_number ?? "No phone number stored"}
                </div>
                {task.merchant?.phone_number ? (
                  <Button asChild size="sm">
                    <a href={`tel:${task.merchant.phone_number}`}>
                      <Phone className="mr-2 h-4 w-4" /> Call
                    </a>
                  </Button>
                ) : (
                  <Button size="sm" disabled>
                    <Phone className="mr-2 h-4 w-4" /> Call
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
