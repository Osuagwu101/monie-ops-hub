import { createFileRoute } from "@tanstack/react-router";
import { Store } from "lucide-react";

export const Route = createFileRoute("/merchant-list")({
  head: () => ({
    meta: [
      { title: "Merchant List — Moniepoint BRM Operations" },
      { name: "description", content: "Merchant list for Moniepoint BRM operations." },
      { property: "og:title", content: "Merchant List — Moniepoint BRM Operations" },
      { property: "og:description", content: "Merchant list for Moniepoint BRM operations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MerchantListPage,
});

function MerchantListPage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
        <Store className="h-8 w-8 text-primary" />
      </div>
      <h1 className="mt-4 text-2xl font-semibold text-foreground">Merchant List</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        This page will list all onboarded merchants with contact and terminal details.
      </p>
    </div>
  );
}
