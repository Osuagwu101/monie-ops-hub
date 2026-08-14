import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  FileText,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { dashboardStats, todaysTasks, type Task } from "@/data/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — Moniepoint BRM Operations" },
      { name: "description", content: "Overview dashboard for Moniepoint BRM operations." },
      { property: "og:title", content: "Overview — Moniepoint BRM Operations" },
      { property: "og:description", content: "Overview dashboard for Moniepoint BRM operations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OverviewPage,
});

function OverviewPage() {
  const [tasks, setTasks] = useState<Task[]>(todaysTasks);
  const [dailyNote, setDailyNote] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleStatusToggle = (taskId: string) => {
    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId
          ? { ...task, status: task.status === "Pending" ? "Verified" : "Pending" }
          : task,
      ),
    );
  };

  const handleSubmitNote = () => {
    // In a real app, this would send the note to a backend.
    // eslint-disable-next-line no-console
    console.log("Daily note submitted:", dailyNote);
    setDailyNote("");
    setIsDialogOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Quick snapshot of today&apos;s BRM operations.
          </p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Daily Notes
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Submit Daily Work Notes</DialogTitle>
              <DialogDescription>
                Share a summary of what you worked on today. This will be logged for review.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={dailyNote}
              onChange={(e) => setDailyNote(e.target.value)}
              placeholder="e.g. Verified 12 terminals, followed up on 3 loan applications..."
              className="min-h-[120px] resize-none"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmitNote} disabled={!dailyNote.trim()}>
                Submit Note
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Active Terminals"
          value={dashboardStats.activeTerminals.toString()}
          description="Terminals live on the network"
          icon={CreditCard}
        />
        <StatCard
          title="Daily Volume Target"
          value={dashboardStats.dailyVolumeTarget}
          description="Target transaction volume today"
          icon={CircleDollarSign}
        />
        <StatCard
          title="Pending Tasks"
          value={tasks.filter((t) => t.status === "Pending").length.toString()}
          description="Tasks awaiting verification"
          icon={Activity}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <CardTitle>Today&apos;s Tasks</CardTitle>
          </div>
          <CardDescription>
            Merchant tasks assigned for today. Click a status badge to toggle verification.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[160px]">Merchant Name</TableHead>
                  <TableHead className="min-w-[130px]">Phone Number</TableHead>
                  <TableHead className="min-w-[110px]">Terminal ID</TableHead>
                  <TableHead className="min-w-[80px]">Task Type</TableHead>
                  <TableHead className="min-w-[200px]">Human Notes</TableHead>
                  <TableHead className="min-w-[90px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="font-medium">{task.merchantName}</TableCell>
                    <TableCell className="text-muted-foreground">{task.phoneNumber}</TableCell>
                    <TableCell className="font-mono text-xs">{task.terminalId}</TableCell>
                    <TableCell>
                      <Badge variant={task.taskType === "TA" ? "default" : "secondary"}>
                        {task.taskType}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {task.humanNotes}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => handleStatusToggle(task.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
                          task.status === "Verified"
                            ? "border-transparent bg-green-100 text-green-700 hover:bg-green-200"
                            : "border-transparent bg-amber-100 text-amber-700 hover:bg-amber-200",
                        )}
                        aria-label={`Mark ${task.merchantName} as ${task.status === "Pending" ? "Verified" : "Pending"}`}
                      >
                        {task.status === "Verified" ? (
                          <>
                            <CheckCircle2 className="h-3 w-3" />
                            Verified
                          </>
                        ) : (
                          <>
                            <Activity className="h-3 w-3" />
                            Pending
                          </>
                        )}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardDescription className="text-sm font-medium">{title}</CardDescription>
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold tracking-tight text-foreground">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
