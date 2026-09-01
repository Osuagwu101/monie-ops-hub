import { createFileRoute } from "@tanstack/react-router";
import { BellRing, Download, ShieldCheck, Smartphone } from "lucide-react";

import { MonieBrmMark } from "@/components/monie-brm-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const ANDROID_APK_URL =
  "https://github.com/Osuagwu101/monie-ops-hub/releases/download/android-v1.2.2-login-resilience/monie-ops-hub-android-v1.2.2-login-resilience.apk";
const ANDROID_APK_SHA256 = "f9e1895eca3dac776c12be4730f9dd09da2d19b90f630a1024a5e4f0b0f7d947";

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
            <strong className="text-foreground">Android installer ready.</strong> This is the
            installable internal BRM build produced from the audited mobile source and connected to
            the same secured production backend as the website. Android may ask you to allow app
            installation from your browser before installing the APK.
          </div>

          <Button className="w-full gap-2" asChild>
            <a href={ANDROID_APK_URL}>
              <Download className="h-4 w-4" />
              Download Android APK · 76 MB
            </a>
          </Button>

          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <div className="font-semibold text-foreground">APK integrity · SHA-256</div>
            <code className="mt-1 block break-all">{ANDROID_APK_SHA256}</code>
          </div>

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
