import { createClient } from "@supabase/supabase-js";

import { getAtlasSupabaseConfig } from "@/lib/supabase/config";

type CalendarEvent = {
  public_id: string;
  source_system: "atlas" | "local_intel";
  is_elm_owned: boolean;
  title: string;
  event_kind: string | null;
  starts_at: string;
  ends_at: string | null;
  time_precision: "exact" | "date_only" | "conditional";
  host_name: string | null;
  venue_name: string | null;
  city: string | null;
  state: string | null;
  cost: Record<string, unknown> | null;
  audience: Record<string, unknown> | null;
  public_url: string | null;
  details: Record<string, unknown> | null;
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type ViewKey = "today" | "weekend" | "week" | "all";

const DATE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DATE_HEADING = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  weekday: "long",
  month: "long",
  day: "numeric",
});

const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  month: "short",
  day: "numeric",
});

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  hour: "numeric",
  minute: "2-digit",
});

function localDateKey(value: Date) {
  const parts = DATE_PARTS.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "00";
  const day = parts.find((part) => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function addDays(dateKey: string, amount: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

function dayOfWeek(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function normalizedView(value: string | string[] | undefined): ViewKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === "today" || candidate === "weekend" || candidate === "week" || candidate === "all") {
    return candidate;
  }
  return "week";
}

function viewRange(view: ViewKey, today: string) {
  if (view === "today") return { start: today, end: today };
  if (view === "week") {
    const weekday = dayOfWeek(today);
    return { start: today, end: weekday === 0 ? today : addDays(today, 7 - weekday) };
  }
  if (view === "weekend") {
    const weekday = dayOfWeek(today);
    if (weekday === 6) return { start: today, end: addDays(today, 1) };
    if (weekday === 0) return { start: addDays(today, -1), end: today };
    const daysToSaturday = 6 - weekday;
    const saturday = addDays(today, daysToSaturday);
    return { start: saturday, end: addDays(saturday, 1) };
  }
  return { start: today, end: addDays(today, 90) };
}

function timeLabel(event: CalendarEvent) {
  if (event.time_precision === "date_only") return "Time TBA";
  if (event.time_precision === "conditional") return "Conditional timing";

  const startDate = new Date(event.starts_at);
  const start = TIME_FORMAT.format(startDate);
  if (!event.ends_at) return start;

  const endDate = new Date(event.ends_at);
  if (localDateKey(startDate) !== localDateKey(endDate)) {
    return `${SHORT_DATE.format(startDate)}–${SHORT_DATE.format(endDate)}`;
  }

  return `${start}–${TIME_FORMAT.format(endDate)}`;
}

function costLabel(event: CalendarEvent) {
  if (event.event_kind === "free_community_morning") return "Free";
  const amount = event.cost?.amount;
  if (typeof amount === "number") {
    const unit = typeof event.cost?.unit === "string" ? `/${event.cost.unit}` : "";
    return `$${amount}${unit}`;
  }
  if (event.cost && "ticket_types" in event.cost) return "Ticketed";
  if (event.event_kind === "ticketed_seasonal_evening") return "Ticketed";
  return null;
}

function eventDetail(event: CalendarEvent) {
  const detail = event.details?.program_detail;
  return typeof detail === "string" ? detail : null;
}

async function loadEvents() {
  const { url, publishableKey } = getAtlasSupabaseConfig();
  const supabase = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const lowerBound = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();
  const upperBound = new Date(Date.now() + 100 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("elm_local_calendar_events_v1")
    .select("public_id,source_system,is_elm_owned,title,event_kind,starts_at,ends_at,time_precision,host_name,venue_name,city,state,cost,audience,public_url,details")
    .gte("starts_at", lowerBound)
    .lte("starts_at", upperBound)
    .order("starts_at", { ascending: true });

  return { events: (data ?? []) as CalendarEvent[], error: error?.message ?? null };
}

export const dynamic = "force-dynamic";

export default async function ElmLocalPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const view = normalizedView(params.view);
  const submitted = params.submitted === "1";
  const submissionError = params.error === "1";
  const today = localDateKey(new Date());
  const range = viewRange(view, today);
  const { events, error } = await loadEvents();

  const visibleEvents = events.filter((event) => {
    const key = localDateKey(new Date(event.starts_at));
    return key >= range.start && key <= range.end;
  });

  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of visibleEvents) {
    const key = localDateKey(new Date(event.starts_at));
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }

  const filters: Array<{ key: ViewKey; label: string }> = [
    { key: "today", label: "Today" },
    { key: "weekend", label: "This Weekend" },
    { key: "week", label: "This Week" },
    { key: "all", label: "All Events" },
  ];

  return (
    <main className="elm-local-page">
      <header className="elm-local-hero">
        <div className="elm-local-hero__topline">
          <div>
            <p className="elm-local-kicker">Elm Local</p>
            <p className="elm-local-place">Marshfield + surrounding communities</p>
          </div>
          <a className="elm-local-submit-link" href="#submit-event">+ Submit an Event</a>
        </div>
        <h1>What’s happening around here?</h1>
        <p className="elm-local-intro">A community calendar for Marshfield and the towns around it.</p>
      </header>

      <section className="elm-local-calendar" id="calendar" aria-labelledby="calendar-title">
        <div className="elm-local-section-heading elm-local-calendar-heading">
          <div>
            <p className="elm-local-kicker">Community Calendar</p>
            <h2 id="calendar-title">Find something to do.</h2>
          </div>
          <p>Verified community happenings from around the region, with public Elm events included when they belong.</p>
        </div>

        <nav className="elm-local-filter-row" aria-label="Calendar range">
          {filters.map((filter) => (
            <a
              key={filter.key}
              href={`/local?view=${filter.key}#calendar`}
              className={view === filter.key ? "is-active" : undefined}
              aria-current={view === filter.key ? "page" : undefined}
            >
              {filter.label}
            </a>
          ))}
        </nav>

        {submitted ? <p className="elm-local-notice success">Thanks. Your event was sent to Elm Local for review.</p> : null}
        {submissionError ? <p className="elm-local-notice error">That submission didn’t make it through. Please check the required fields and try again.</p> : null}
        {error ? <p className="elm-local-notice error">The calendar is temporarily unavailable. Elm Local did not publish guessed backup data.</p> : null}

        {!error && grouped.size === 0 ? (
          <div className="elm-local-empty">
            <strong>Nothing verified in this window yet.</strong>
            <p>Know about something? Send it to Elm Local below.</p>
          </div>
        ) : null}

        <div className="elm-local-day-list">
          {[...grouped.entries()].map(([dateKey, dayEvents]) => (
            <section className="elm-local-day" key={dateKey}>
              <h3>{DATE_HEADING.format(new Date(dayEvents[0].starts_at))}</h3>
              <div className="elm-local-event-list">
                {dayEvents.map((event) => {
                  const cost = costLabel(event);
                  const detail = eventDetail(event);
                  return (
                    <article className={`elm-local-event ${event.is_elm_owned ? "is-elm" : "is-community"}`} key={event.public_id}>
                      <div className="elm-local-event__meta">
                        <span className="elm-local-badge">{event.is_elm_owned ? "At Elm" : "Around town"}</span>
                        <span>{timeLabel(event)}</span>
                        {cost ? <span>{cost}</span> : null}
                      </div>
                      <h4>{event.title}</h4>
                      <p className="elm-local-event__where">
                        {event.host_name && event.host_name !== event.venue_name ? `${event.host_name} · ` : ""}
                        {event.venue_name || event.host_name || "Location TBA"}
                        {event.city ? ` · ${event.city}` : ""}
                      </p>
                      {detail ? <p className="elm-local-event__detail">{detail}</p> : null}
                      {event.public_url ? (
                        <a className="elm-local-event__link" href={event.public_url} target="_blank" rel="noreferrer">Event details ↗</a>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="elm-local-submit" id="submit-event" aria-labelledby="submit-event-title">
        <div className="elm-local-section-heading">
          <p className="elm-local-kicker">Add to the calendar</p>
          <h2 id="submit-event-title">Tell Elm Local what’s happening.</h2>
          <p>Submissions are reviewed before they appear. Sending the form does not automatically publish an event.</p>
        </div>
        <form action="/api/local/submit-event" method="post" className="elm-local-form">
          <div className="elm-local-form-grid">
            <label><span>Event name *</span><input name="eventName" required maxLength={180} /></label>
            <label><span>Date *</span><input name="eventDate" type="date" required /></label>
            <label><span>Time</span><input name="eventTime" placeholder="6:30–8 p.m. or all day" maxLength={80} /></label>
            <label><span>Host / organization *</span><input name="hostName" required maxLength={180} /></label>
            <label><span>Venue / place *</span><input name="venueName" required maxLength={180} /></label>
            <label><span>City</span><input name="city" placeholder="Marshfield, Strafford, Nixa…" maxLength={100} /></label>
            <label className="wide"><span>Address</span><input name="address" maxLength={240} /></label>
            <label className="wide"><span>Event or registration link</span><input name="publicUrl" type="url" placeholder="https://" maxLength={1000} /></label>
            <label className="wide"><span>Anything people should know</span><textarea name="description" rows={4} maxLength={2000} /></label>
            <label><span>Your name</span><input name="submitterName" maxLength={160} /></label>
            <label><span>Your email</span><input name="submitterEmail" type="email" maxLength={320} /></label>
            <label className="elm-local-honeypot" aria-hidden="true"><span>Company</span><input name="company" tabIndex={-1} autoComplete="off" /></label>
          </div>
          <button type="submit">Send event to Elm Local</button>
        </form>
      </section>

      <footer className="elm-local-footer">
        <strong>Elm Local</strong>
        <span>Built at Elm Farm for the community around it.</span>
      </footer>
    </main>
  );
}
