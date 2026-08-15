import { createFileRoute } from "@tanstack/react-router";
import { BellRing, Download, ShieldCheck, Smartphone } from "lucide-react";

import { MonieBrmMark } from "@/components/monie-brm-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/app-download")({
  head: () => ({
    meta: [
      { title: "Download Moniepoint BRM App" },
      {
        name: "description",
        content:
          "Download the Moniepoint BRM mobile companion for synchronized operations and meeting alerts.",
      },
    ],
  }),
  component: AppDownloadPage,
});

function AppDownloadPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <Card className="w-full max-w-xl rounded-2xl shadow-xl">
        <CardHeader className="space-y-4">
          <div className="w-fit rounded-2xl border bg-white p-3">
            <MonieBrmMark />
          </div>
          <div>
            <CardTitle className="text-2xl sm:text-3xl">Moniepoint BRM App</CardTitle>
            <CardDescription className="mt-2 text-sm leading-6">
              The mobile companion stays synchronized with Monie Ops Hub and adds native meeting
              reminders and alerts.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Feature icon={Smartphone} text="Shared portal data" />
            <Feature icon={BellRing} text="Meeting alerts" />
            <Feature icon={ShieldCheck} text="Same secure backend" />
          </div>

          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm leading-6 text-muted-foreground">
            <strong className="text-foreground">Android installer:</strong> the native app source is
            ready, but the signed APK has not yet been published. This page is the permanent app
            download location and the button below will activate as soon as the installer is
            released.
          </div>

          <Button className="w-full gap-2" disabled>
            <Download className="h-4 w-4" />
            Android APK — preparing for release
          </Button>

          <Button variant="outline" className="w-full" asChild>
            <a href="/">Return to Monie Ops Hub</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Feature({ icon: Icon, text }: { icon: typeof Smartphone; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background p-3 text-xs font-medium text-foreground">
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <span>{text}</span>
    </div>
  );
}
