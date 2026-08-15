import { createFileRoute } from "@tanstack/react-router";

const cloudUrl = import.meta.env["VITE_SUPABASE_URL"]?.replace(/\/$/, "") ?? "";
const publishableKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "";
const expoPushUrl = "https://exp.host/--/api/v2/push/send";

interface MeetingDelivery {
  delivery_id: string;
  expo_push_token: string;
  platform: "ios" | "android";
  stage: "pre10" | "pre2" | "escalation";
  title: string;
  body: string;
  meeting_url: string | null;
  occurrence_id: string;
  starts_at: string;
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
}

interface ExpoResponse {
  data?: ExpoTicket | ExpoTicket[];
  errors?: Array<{ code?: string; message?: string }>;
}

export const Route = createFileRoute("/api/meeting-notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => handleMeetingNotifications(request),
    },
  },
});

async function handleMeetingNotifications(request: Request) {
  const bridgeToken = request.headers.get("x-monie-automation-token")?.trim() ?? "";
  if (!bridgeToken) return json({ ok: false, error: "unauthorized" }, 401);
  if (!cloudUrl || !publishableKey) {
    return json({ ok: false, error: "cloud_not_configured" }, 503);
  }

  try {
    const deliveries = await rpc<MeetingDelivery[]>("meeting_claim_notifications", {
      p_token: bridgeToken,
    });

    let sent = 0;
    let failed = 0;

    for (const delivery of deliveries) {
      try {
        const ticket = await sendExpoNotification(delivery);
        const isOk = ticket.status === "ok";
        const deviceNotRegistered = ticket.details?.error === "DeviceNotRegistered";

        await rpc("meeting_complete_notification", {
          p_token: bridgeToken,
          p_delivery_id: delivery.delivery_id,
          p_status: isOk ? "sent" : "failed",
          p_ticket_id: ticket.id ?? null,
          p_error: ticket.message ?? ticket.details?.error ?? null,
          p_disable_device: deviceNotRegistered,
        });

        if (isOk) sent += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        const message = safeMessage(error);
        try {
          await rpc("meeting_complete_notification", {
            p_token: bridgeToken,
            p_delivery_id: delivery.delivery_id,
            p_status: "failed",
            p_ticket_id: null,
            p_error: message,
            p_disable_device: false,
          });
        } catch (markError) {
          console.error("Unable to mark failed meeting notification", {
            deliveryId: delivery.delivery_id,
            error: safeMessage(markError),
          });
        }
      }
    }

    return json(
      {
        ok: true,
        claimed: deliveries.length,
        sent,
        failed,
      },
      202,
    );
  } catch (error) {
    const message = safeMessage(error);
    const unauthorized = message.toLowerCase().includes("invalid automation token");
    console.error("Meeting notification worker failed", { error: message });
    return json(
      { ok: false, error: unauthorized ? "unauthorized" : "notification_worker_failed" },
      unauthorized ? 401 : 502,
    );
  }
}

async function sendExpoNotification(delivery: MeetingDelivery) {
  const isEscalation = delivery.stage === "escalation";
  const payload = {
    to: delivery.expo_push_token,
    title: delivery.title,
    body: delivery.body,
    sound: "meeting-bing.wav",
    priority: "high",
    channelId: isEscalation ? "meeting-alarms" : "meeting-reminders",
    categoryId: "MEETING_JOIN_ACK",
    interruptionLevel: "time-sensitive",
    ttl: isEscalation ? 180 : 900,
    data: {
      type: "meeting_reminder",
      stage: delivery.stage,
      occurrenceId: delivery.occurrence_id,
      startsAt: delivery.starts_at,
      meetingUrl: delivery.meeting_url,
    },
  };

  const response = await fetch(expoPushUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Expo push service returned HTTP ${response.status}.`);
  }

  const result = (await response.json()) as ExpoResponse;
  const ticket = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!ticket) {
    throw new Error(result.errors?.[0]?.message ?? "Expo push service returned no ticket.");
  }
  return ticket;
}

async function rpc<T = unknown>(name: string, payload: unknown) {
  const response = await fetch(`${cloudUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Cloud RPC ${name} failed with status ${response.status}.`);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function safeMessage(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "Unknown notification worker failure.";
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
