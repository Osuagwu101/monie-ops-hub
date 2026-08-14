import { createFileRoute } from "@tanstack/react-router";
import { Bot } from "lucide-react";

export const Route = createFileRoute("/ai-logs")({
  head: () => ({
    meta: [
      { title: "AI Logs — Moniepoint BRM Operations" },
      { name: "description", content: "AI assistant logs for Moniepoint BRM operations." },
      { property: "og:title", content: "AI Logs — Moniepoint BRM Operations" },
      { property: "og:description", content: "AI assistant logs for Moniepoint BRM operations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AiLogsPage,
});

function AiLogsPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-8 w-8 text-primary" />
      </div>
      <h1 className="mt-4 text-2xl font-semibold text-foreground">AI Logs</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This page will show assistant-generated notes, call summaries, and verification history.
      </p>
    </div>
  );
}
