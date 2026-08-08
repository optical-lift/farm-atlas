import { Body, GeoVector, Ecliptic, MoonPhase } from "npm:astronomy-engine@2.1.19";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST required", { status: 405 });
  const body = await req.json();
  const at = new Date(body.utc ?? new Date().toISOString());
  if (Number.isNaN(at.getTime())) return new Response("invalid utc", { status: 400 });
  const moon = Ecliptic(GeoVector(Body.Moon, at, false));
  const phase = ((MoonPhase(at) % 360) + 360) % 360;
  const moonLon = ((moon.elon % 360) + 360) % 360;
  const sunLon = ((moonLon - phase) % 360 + 360) % 360;
  return new Response(
    JSON.stringify({
      utc: at.toISOString(),
      moon_longitude_deg: moonLon,
      sun_longitude_deg: sunLon,
      phase_angle_deg: phase,
      source: "Astronomy Engine 2.1.19",
      interpretation_prohibited: true,
    }),
    { headers: { "content-type": "application/json" } },
  );
});
