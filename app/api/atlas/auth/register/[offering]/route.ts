import { createAtlasServerClient } from "@/lib/supabase/server";

type Context = { params: Promise<{ offering: string }> };
type EventDate = { date: string; start_time: string; end_time: string };
type Offering = {
  stable_key: string;
  title: string;
  fee_amount: number;
  public_description?: string;
  events?: EventDate[];
  public?: { location_label?: string; headline?: string; experience_note?: string; payment_note?: string };
};

type Notice = { kind: "error" | "success"; title: string; body: string; number?: string };

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

function prettyDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function prettyTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 0, 1, hour, minute));
}

async function loadOffering(stableKey: string) {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("get_public_registration_offering_v1", { p_stable_key: stableKey });
  if (error || !data) return null;
  return data as Offering;
}

function page(offering: Offering | null, notice?: Notice) {
  if (!offering) {
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Elm Farm Registration</title></head><body style="font-family:system-ui;padding:40px"><h1>Registration is not open.</h1></body></html>`;
  }
  const events = (offering.events ?? []).map((event) => `<li>${esc(prettyDate(event.date))} · ${esc(prettyTime(event.start_time))}–${esc(prettyTime(event.end_time))}</li>`).join("");
  const noticeHtml = notice ? `<div class="notice ${notice.kind}"><h2>${esc(notice.title)}</h2>${notice.number ? `<p><strong>Registration:</strong> ${esc(notice.number)}</p>` : ""}<p>${esc(notice.body)}</p></div>` : "";
  const form = notice?.kind === "success" ? "" : `<form method="post">
    <h2>Register your family</h2>
    <label>Family / household name<input name="householdName" placeholder="The Miller family"></label>
    <label>Primary adult<input name="primaryName" autocomplete="name" required></label>
    <label>Email<input name="primaryEmail" type="email" autocomplete="email" required></label>
    <label>Phone<input name="primaryPhone" type="tel" autocomplete="tel"></label>
    <label>Who else plans to play?<small>One name per line. No age brackets needed.</small><textarea name="participants" placeholder="Sam&#10;Lucy&#10;Henry"></textarea></label>
    <label class="check"><input name="termsAccepted" type="checkbox" required><span>I understand this is an active family recreation program on a working farm, and our family will follow the host’s on-site safety directions.</span></label>
    <input name="website" tabindex="-1" autocomplete="off" class="trap">
    <button type="submit">Register family · $${Number(offering.fee_amount).toFixed(0)}</button>
    ${offering.public?.payment_note ? `<p class="muted">${esc(offering.public.payment_note)}</p>` : ""}
  </form>`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(offering.title)}</title><style>
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(#f7f3ec,#efe8dc);color:#263026;font-family:system-ui,-apple-system,sans-serif}.page{max-width:760px;margin:auto;padding:32px 18px 56px}.card{background:#fffffff2;border:1px solid #3d49362e;border-radius:28px;padding:clamp(24px,5vw,44px);box-shadow:0 24px 70px #4742321f}.eyebrow{margin:0 0 8px;color:#6d7159;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{margin:0;font-size:clamp(38px,8vw,68px);line-height:.95;letter-spacing:-.045em}.headline{font-size:clamp(18px,4vw,25px);font-weight:800}.muted,p{color:#61675c;line-height:1.6}.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:10px;margin:24px 0}.fact,.dates{background:#f3efe6;border-radius:16px;padding:14px 16px}.fact strong,.fact span{display:block}.fact span{font-size:14px;color:#69695f;margin-top:4px}.dates{background:#faf8f3}.dates ul{line-height:1.8;padding-left:20px}form{display:grid;gap:16px;margin-top:30px;padding-top:28px;border-top:1px solid #ddd7ca}label{display:grid;gap:7px;font-weight:700}small{color:#73776f;font-weight:500}input,textarea{width:100%;border:1px solid #c8c8bd;border-radius:13px;padding:12px 13px;font:inherit}textarea{min-height:108px;resize:vertical}.check{grid-template-columns:22px 1fr;font-weight:500;font-size:14px}.check input{margin-top:4px}.trap{position:absolute;left:-10000px;width:1px;height:1px}button{min-height:52px;border:0;border-radius:15px;background:#47553e;color:white;font:inherit;font-weight:800;cursor:pointer}.notice{margin:26px 0;border-radius:20px;padding:22px}.notice.success{background:#eff4e9}.notice.error{background:#f9e9e9}.notice h2,.notice p{margin:0 0 8px}
  </style></head><body><main class="page"><section class="card"><p class="eyebrow">Elm Farm · Family Field Club</p><h1>${esc(offering.title)}</h1><p class="headline">${esc(offering.public?.headline ?? "Parents play. Kids play.")}</p><p>${esc(offering.public_description)}</p><div class="facts"><div class="fact"><strong>$${Number(offering.fee_amount).toFixed(0)}</strong><span>per family · all six weeks</span></div><div class="fact"><strong>Tuesdays</strong><span>6:00–7:30 p.m.</span></div><div class="fact"><strong>${esc(offering.public?.location_label ?? "Elm Farm")}</strong><span>evenings through sunset</span></div></div><div class="dates"><h2>Six Tuesday evenings</h2><ul>${events}</ul></div>${offering.public?.experience_note ? `<p>${esc(offering.public.experience_note)}</p>` : ""}${noticeHtml}${form}</section></main></body></html>`;
}

export async function GET(_request: Request, context: Context) {
  const { offering } = await context.params;
  const data = await loadOffering(offering);
  return new Response(page(data), { status: data ? 200 : 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: Request, context: Context) {
  const { offering } = await context.params;
  const data = await loadOffering(offering);
  if (!data) return new Response(page(null), { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } });
  const form = await request.formData();
  if (String(form.get("website") ?? "").trim()) return new Response(page(data, { kind: "success", title: "You’re on the list.", body: "Registration received." }), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  const supabase = await createAtlasServerClient();
  const { data: result, error } = await supabase.rpc("submit_public_household_registration_v1", {
    p_offering_key: offering,
    p_primary_name: String(form.get("primaryName") ?? ""),
    p_primary_email: String(form.get("primaryEmail") ?? ""),
    p_primary_phone: String(form.get("primaryPhone") ?? ""),
    p_household_name: String(form.get("householdName") ?? ""),
    p_participant_names: String(form.get("participants") ?? "").split(/\r?\n/).map((v) => v.trim()).filter(Boolean).slice(0, 40),
    p_terms_accepted: form.get("termsAccepted") === "on",
  });
  const payload = result as { registration_number?: string; message?: string } | null;
  const notice: Notice = error
    ? { kind: "error", title: "We couldn’t save that yet.", body: error.code === "23505" ? "That email is already registered for this season." : error.message }
    : { kind: "success", title: "You’re on the list.", body: payload?.message ?? "Registration received.", number: payload?.registration_number };
  return new Response(page(data, notice), { status: error ? 400 : 201, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
