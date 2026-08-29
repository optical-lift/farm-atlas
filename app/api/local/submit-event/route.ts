import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { getAtlasSupabaseConfig } from "@/lib/supabase/config";

function text(form: FormData, key: string, maxLength: number) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeUrl(value: string) {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function redirect(request: Request, state: "submitted" | "error") {
  const url = new URL("/local", request.url);
  url.searchParams.set(state, "1");
  url.hash = state === "submitted" ? "calendar" : "submit-event";
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return redirect(request, "error");

  // Honeypot: real visitors never fill this field.
  if (text(form, "company", 200)) return redirect(request, "submitted");

  const eventName = text(form, "eventName", 180);
  const eventDate = text(form, "eventDate", 40);
  const eventTime = text(form, "eventTime", 80);
  const hostName = text(form, "hostName", 180);
  const venueName = text(form, "venueName", 180);
  const address = text(form, "address", 240);
  const city = text(form, "city", 100) || "Marshfield";
  const description = text(form, "description", 2000);
  const publicUrl = safeUrl(text(form, "publicUrl", 1000));
  const submitterName = text(form, "submitterName", 160);
  const submitterEmail = text(form, "submitterEmail", 320);

  if (!eventName || !eventDate || !hostName || !venueName) {
    return redirect(request, "error");
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return redirect(request, "error");

  const { url } = getAtlasSupabaseConfig();
  const supabase = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    db: { schema: "local_intel" },
  });

  const body = [
    `Event: ${eventName}`,
    `Date: ${eventDate}`,
    eventTime ? `Time: ${eventTime}` : null,
    `Host: ${hostName}`,
    `Venue: ${venueName}`,
    address ? `Address: ${address}` : null,
    `City: ${city}`,
    publicUrl ? `Public URL: ${publicUrl}` : null,
    description ? `Description: ${description}` : null,
    submitterName ? `Submitted by: ${submitterName}` : null,
    submitterEmail ? `Submitter email: ${submitterEmail}` : null,
  ].filter(Boolean).join("\n");

  const { error } = await supabase.from("provider_messages").insert({
    channel_id: null,
    channel_type: "public_web_form",
    sender_identifier: submitterEmail || "anonymous-public-web",
    body,
    processing_state: "received",
    raw_payload: {
      event_name: eventName,
      event_date: eventDate,
      event_time: eventTime || null,
      host_name: hostName,
      venue_name: venueName,
      address: address || null,
      city,
      public_url: publicUrl || null,
      description: description || null,
      submitter_name: submitterName || null,
      submitter_email: submitterEmail || null,
    },
    metadata: {
      submission_kind: "community_event",
      source_surface: "elm_local_public_calendar",
      review_required: true,
      auto_publish: false,
    },
  });

  return error ? redirect(request, "error") : redirect(request, "submitted");
}
