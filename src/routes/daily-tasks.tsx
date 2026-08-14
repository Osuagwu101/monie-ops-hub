import { createFileRoute } from "@tanstack/react-router";
import { ListTodo } from "lucide-react";

export const Route = createFileRoute("/daily-tasks")({
  head: () => ({
    meta: [
      { title: "Daily Tasks — Moniepoint BRM Operations" },
      { name: "description", content: "Daily tasks for Moniepoint BRM operations." },
      { property: "og:title", content: "Daily Tasks — Moniepoint BRM Operations" },
      { property: "og:description", content: "Daily tasks for Moniepoint BRM operations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DailyTasksPage,
});

function DailyTasksPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <ListTodo className="h-8 w-8 text-primary" />
      </div>
      <h1 className="mt-4 text-2xl font-semibold text-foreground">Daily Tasks</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This page will show the full daily task queue with filters and bulk actions.
      </p>
    </div>
  );
}
