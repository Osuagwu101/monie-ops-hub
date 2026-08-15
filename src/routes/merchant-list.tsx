import { createFileRoute } from "@tanstack/react-router";
import { Link2, Store, TabletSmartphone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const Route = createFileRoute("/merchant-list")({
  head: () => ({
    meta: [
      { title: "Merchants — Monie Ops Hub" },
      { name: "description", content: "Merchant and terminal operating model." },
    ],
  }),
  component: MerchantListPage,
});

function MerchantListPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section>
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline">Phase 1</Badge>
          <Badge variant="secondary">Canonical model ready</Badge>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Merchants & Terminals
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          The database now treats a merchant and a terminal as separate entities. TA performance is
          measured per terminal, even when one merchant operates multiple terminals.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="h-4 w-4 text-primary" /> Merchant
            </CardTitle>
            <CardDescription>Relationship-level record</CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Stores the business identity and approved contact details without using the merchant as
            the TA unit.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TabletSmartphone className="h-4 w-4 text-primary" /> Terminal
            </CardTitle>
            <CardDescription>TA measurement unit</CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Stores Terminal ID, serial number, assignment relationship and operational flags
            independently.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Link2 className="h-4 w-4 text-primary" /> Performance snapshots
            </CardTitle>
            <CardDescription>Official evidence history</CardDescription>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            Daily and rolling seven-day report values attach to the terminal and retain the source
            report that produced them.
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Live merchant table</CardTitle>
          <CardDescription>
            Intentionally unavailable until the Supabase project is connected and the official
            report ingestion phase is enabled.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No fake merchant rows are displayed. Phase 3 will populate this view from official
            Moniepoint report data.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
