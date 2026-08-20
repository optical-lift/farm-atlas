import { NextResponse } from "next/server";

import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function publicJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const offering = text(url.searchParams.get("offering"));
  if (!offering) return publicJson({ error: "Registration offering is required." }, 400);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("get_public_registration_offering_v1", {
    p_stable_key: offering,
  });

  if (error) return publicJson({ error: "Registration could not be loaded." }, 500);
  if (!data) return publicJson({ error: "Registration is not currently open." }, 404);
  return publicJson({ offering: data });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicJson({ error: "Registration request is invalid." }, 400);
  }

  // Honeypot: browsers leave this empty; simple form bots often fill it.
  if (text(body.website)) {
    return publicJson({ ok: true, message: "Registration received." });
  }

  const offering = text(body.offering);
  const primaryName = text(body.primaryName);
  const primaryEmail = text(body.primaryEmail);
  const primaryPhone = text(body.primaryPhone);
  const householdName = text(body.householdName);
  const termsAccepted = body.termsAccepted === true;
  const participantNames = Array.isArray(body.participantNames)
    ? body.participantNames.map(text).filter(Boolean).slice(0, 40)
    : [];

  if (!offering || !primaryName || !primaryEmail || !termsAccepted) {
    return publicJson({ error: "Name, email, and participation agreement are required." }, 400);
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("submit_public_household_registration_v1", {
    p_offering_key: offering,
    p_primary_name: primaryName,
    p_primary_email: primaryEmail,
    p_primary_phone: primaryPhone || null,
    p_household_name: householdName || null,
    p_participant_names: participantNames,
    p_terms_accepted: true,
  });

  if (error) {
    const status = error.code === "23505" ? 409 : error.code === "P0002" ? 404 : error.code === "22023" ? 400 : 500;
    const message = status === 500 ? "Registration could not be saved. Please try again." : error.message;
    return publicJson({ error: message }, status);
  }

  return publicJson(data, 201);
}
