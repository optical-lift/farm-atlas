import {
  CATEGORIES,
  DATE_BADGE_DAY,
  DATE_BADGE_MONTH,
  DATE_HEADING,
  SHORT_DATE,
  addDays,
  categoryLabel,
  costLabel,
  discoveryIdentity,
  eventDetail,
  eventHref,
  firstParam,
  loadEvents,
  localDateKey,
  seriesHref,
  timeLabel,
  weekendRange,
  type CalendarEvent,
} from "./public-events";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type ViewKey = "today" | "tomorrow" | "weekend" | "next7" | "all";

type SeriesGroup = {
  key: string;
  title: string;
  summary: string | null;
  events: CalendarEvent[];
};

function normalizedView(value: string | string[] | undefined, hasFilters: boolean): ViewKey {
  const candidate = firstParam(value);
  if (candidate === "today" || candidate === "tomorrow" || candidate === "weekend" || candidate === "next7" || candidate === "all") {
    return candidate;
  }
  return hasFilters ? "all" : "next7";
}

function viewRange(view: ViewKey, today: string) {
  if (view === "today") return { start: today, end: today };
  if (view === "tomorrow") {
    const tomorrow = addDays(today, 1);
    return { start: tomorrow, end: tomorrow };
  }
  if (view === "weekend") return weekendRange(today);
  if (view === "next7") return { start: today, end: addDays(today, 6) };
  return { start: today, end: addDays(today, 90) };
}

function eventMatches(event: CalendarEvent, query: string, city: string, category: string) {
  if (city && event.city?.toLowerCase() !== city.toLowerCase()) return false;
  if (category && !event.categories.includes(category)) return false;
  if (!query) return true;

  const haystack = [
    event.title,
    event.series_title,
    event.series_summary,
    event.host_name,
    event.venue_name,
    event.city,
    event.event_kind,
    ...event.categories.map(categoryLabel),
    eventDetail(event),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function eventInRange(event: CalendarEvent, start: string, end: string) {
  const key = localDateKey(new Date(event.starts_at));
  return key >= start && key <= end;
}

function buildHref(
  next: Record<string, string | null>,
  current: { q: string; city: string; category: string; view: ViewKey },
  anchor = "discover",
) {
  const params = new URLSearchParams();
  const merged = {
    q: current.q,
    city: current.city,
    category: current.category,
    view: current.view,
    ...next,
  };
  if (merged.q) params.set("q", merged.q);
  if (merged.city) params.set("city", merged.city);
  if (merged.category) params.set("category", merged.category);
  if (merged.view) params.set("view", merged.view);
  const query = params.toString();
  return `/local${query ? `?${query}` : ""}#${anchor}`;
}

function DateBadge({ event }: { event: CalendarEvent }) {
  const date = new Date(event.starts_at);
  return (
    <div className="elm-local-date-badge" aria-hidden="true">
      <span>{DATE_BADGE_MONTH.format(date)}</span>
      <strong>{DATE_BADGE_DAY.format(date)}</strong>
    </div>
  );
}

function EventCard({ event, compact = false, showNote = false }: { event: CalendarEvent; compact?: boolean; showNote?: boolean }) {
  const cost = costLabel(event);
  const detail = eventDetail(event);
  const visibleCategories = event.categories.filter((key) => key !== "free").slice(0, compact ? 1 : 2);

  return (
    <article className={`elm-local-event-card${compact ? " is-compact" : ""}`}>
      <DateBadge event={event} />
      <div className="elm-local-event-card__body">
        <div className="elm-local-event-card__eyebrow">
          <span>{timeLabel(event)}</span>
          {cost ? <span>{cost}</span> : null}
        </div>
        <h3><a className="elm-local-event-card__title-link" href={eventHref(event)}>{event.title}</a></h3>
        <p className="elm-local-event-card__where">
          {event.venue_name || event.host_name || "Location TBA"}
          {event.city ? ` · ${event.city}` : ""}
        </p>
        {showNote && event.featured_note ? <p className="elm-local-event-card__note">{event.featured_note}</p> : null}
        {!compact && detail ? <p className="elm-local-event-card__detail">{detail}</p> : null}
        {!compact && event.series_key && event.series_title ? (
          <a className="elm-local-event-card__series-link" href={seriesHref(event.series_key)}>Part of {event.series_title} →</a>
        ) : null}
        {!compact && visibleCategories.length ? (
          <div className="elm-local-event-card__tags">
            {visibleCategories.map((key) => <span key={key}>{categoryLabel(key)}</span>)}
          </div>
        ) : null}
        <a className="elm-local-event-card__link" href={eventHref(event)}>View event →</a>
      </div>
    </article>
  );
}

function seriesGroups(events: CalendarEvent[]) {
  const groups = new Map<string, SeriesGroup>();
  for (const event of events) {
    if (!event.series_key || !event.series_title) continue;
    const existing = groups.get(event.series_key);
    if (existing) {
      existing.events.push(event);
      continue;
    }
    groups.set(event.series_key, {
      key: event.series_key,
      title: event.series_title,
      summary: event.series_summary,
      events: [event],
    });
  }
  return [...groups.values()]
    .filter((group) => group.events.length > 1)
    .sort((a, b) => a.events[0].starts_at.localeCompare(b.events[0].starts_at));
}

function SeriesCard({ group }: { group: SeriesGroup }) {
  const first = group.events[0];
  const dates = group.events.slice(0, 4).map((event) => SHORT_DATE.format(new Date(event.starts_at)));
  const categoryKeys = [...new Set(group.events.flatMap((event) => event.categories))].filter((key) => key !== "free").slice(0, 2);

  return (
    <article className="elm-local-series-card">
      <div className="elm-local-series-card__eyebrow">
        <span>{group.events.length} upcoming dates</span>
        {costLabel(first) ? <span>{costLabel(first)}</span> : null}
      </div>
      <h3><a href={seriesHref(group.key)}>{group.title}</a></h3>
      {group.summary ? <p>{group.summary}</p> : null}
      <p className="elm-local-series-card__where">
        {first.venue_name || first.host_name || "Location TBA"}{first.city ? ` · ${first.city}` : ""}
      </p>
      <div className="elm-local-series-card__dates">
        {dates.map((date) => <span key={date}>{date}</span>)}
        {group.events.length > dates.length ? <span>+{group.events.length - dates.length} more</span> : null}
      </div>
      {categoryKeys.length ? (
        <div className="elm-local-event-card__tags">
          {categoryKeys.map((key) => <span key={key}>{categoryLabel(key)}</span>)}
        </div>
      ) : null}
      <a className="elm-local-event-card__link" href={seriesHref(group.key)}>See every date →</a>
    </article>
  );
}

export default async function ElmLocalDiscoveryPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = firstParam(params.q).trim();
  const city = firstParam(params.city).trim();
  const category = firstParam(params.category).trim();
  const hasFilters = Boolean(q || city || category);
  const view = normalizedView(params.view, hasFilters);
  const submitted = params.submitted === "1";
  const submissionError = params.error === "1";
  const today = localDateKey(new Date());
  const range = viewRange(view, today);
  const { events, error } = await loadEvents();

  const filteredEvents = events.filter((event) => eventMatches(event, q, city, category));
  const visibleEvents = filteredEvents.filter((event) => eventInRange(event, range.start, range.end));

  const grouped = new Map<string, CalendarEvent[]>();
  for (const event of visibleEvents) {
    const key = localDateKey(new Date(event.starts_at));
    const group = grouped.get(key) ?? [];
    group.push(event);
    grouped.set(key, group);
  }

  const featuredEvents = filteredEvents
    .filter((event) => event.featured_rank !== null && eventInRange(event, today, addDays(today, 60)))
    .sort((a, b) => (a.featured_rank ?? 9999) - (b.featured_rank ?? 9999))
    .slice(0, 4);

  const recurringSeries = seriesGroups(filteredEvents.filter((event) => eventInRange(event, today, addDays(today, 90)))).slice(0, 6);

  const firstWeekend = weekendRange(today);
  const firstWeekendEvents = filteredEvents.filter((event) => eventInRange(event, firstWeekend.start, firstWeekend.end));
  const weekend = firstWeekendEvents.length ? firstWeekend : weekendRange(today, 1);
  const weekendEvents = (firstWeekendEvents.length ? firstWeekendEvents : filteredEvents.filter((event) => eventInRange(event, weekend.start, weekend.end))).slice(0, 8);
  const weekendLabel = weekend.start === firstWeekend.start ? "This weekend" : "Next weekend";

  const cities = [...new Set(events.map((event) => event.city).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));

  const categoryContext = events.filter((event) => eventMatches(event, q, city, ""));
  const categoryIdentitySets = new Map<string, Set<string>>();
  for (const event of categoryContext) {
    for (const key of event.categories) {
      const identities = categoryIdentitySets.get(key) ?? new Set<string>();
      identities.add(discoveryIdentity(event));
      categoryIdentitySets.set(key, identities);
    }
  }
  const categoryCounts = new Map<string, number>();
  for (const [key, identities] of categoryIdentitySets) categoryCounts.set(key, identities.size);
  const activeCategories = CATEGORIES.filter((item) => (categoryCounts.get(item.key) ?? 0) > 0);

  const state = { q, city, category, view };
  const viewFilters: Array<{ key: ViewKey; label: string }> = [
    { key: "today", label: "Today" },
    { key: "tomorrow", label: "Tomorrow" },
    { key: "weekend", label: "This Weekend" },
    { key: "next7", label: "Next 7 Days" },
  ];

  return (
    <main className="elm-local-page">
      <header className="elm-local-hero" id="discover">
        <div className="elm-local-hero__topline">
          <div>
            <p className="elm-local-kicker">Elm Local</p>
            <p className="elm-local-place">Marshfield + surrounding communities</p>
          </div>
          <a className="elm-local-submit-link" href="#submit-event">Submit an Event</a>
        </div>

        <div className="elm-local-hero__copy">
          <h1>What’s happening around here?</h1>
          <p className="elm-local-intro">Find something worth leaving the house for.</p>
        </div>

        <form className="elm-local-search" action="/local#discover" method="get">
          <label className="elm-local-search__query">
            <span className="sr-only">Search events, places, or organizations</span>
            <input name="q" defaultValue={q} placeholder="Search events, places, or organizations…" />
          </label>
          <label className="elm-local-search__city">
            <span className="sr-only">Choose an area</span>
            <select name="city" defaultValue={city}>
              <option value="">All nearby towns</option>
              {cities.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          {category ? <input type="hidden" name="category" value={category} /> : null}
          <input type="hidden" name="view" value={view} />
          <button type="submit">Search</button>
        </form>

        <nav className="elm-local-intent-row" aria-label="When do you want to go?">
          {viewFilters.map((filter) => (
            <a
              key={filter.key}
              href={buildHref({ view: filter.key }, state)}
              className={view === filter.key ? "is-active" : undefined}
              aria-current={view === filter.key ? "page" : undefined}
            >
              {filter.label}
            </a>
          ))}
        </nav>

        {hasFilters ? (
          <div className="elm-local-active-filter">
            <span>
              Showing {q ? `“${q}”` : "events"}
              {category ? ` · ${categoryLabel(category)}` : ""}
              {city ? ` · ${city}` : ""}
            </span>
            <a href="/local#discover">Clear</a>
          </div>
        ) : null}
      </header>

      {submitted ? <p className="elm-local-notice success elm-local-site-notice">Thanks. Your event was sent to Elm Local for review.</p> : null}
      {submissionError ? <p className="elm-local-notice error elm-local-site-notice">That submission didn’t make it through. Please check the required fields and try again.</p> : null}
      {error ? <p className="elm-local-notice error elm-local-site-notice">Elm Local is temporarily unavailable. It will not fill the gap with guessed events.</p> : null}

      {!error && featuredEvents.length ? (
        <section className="elm-local-discovery-section elm-local-featured" aria-labelledby="worth-knowing-title">
          <div className="elm-local-section-heading">
            <div>
              <p className="elm-local-kicker">Elm Local picks</p>
              <h2 id="worth-knowing-title">Worth knowing about.</h2>
            </div>
            <p>A few upcoming things we’d point out if you asked what’s happening.</p>
          </div>
          <div className="elm-local-featured-grid">
            {featuredEvents.map((event) => <EventCard key={event.public_id} event={event} showNote />)}
          </div>
        </section>
      ) : null}

      <section className="elm-local-discovery-section elm-local-categories" aria-labelledby="categories-title">
        <div className="elm-local-section-heading">
          <div>
            <p className="elm-local-kicker">Find your thing</p>
            <h2 id="categories-title">What sounds good?</h2>
          </div>
        </div>
        <div className="elm-local-category-grid">
          {activeCategories.map((item) => {
            const count = categoryCounts.get(item.key) ?? 0;
            return (
              <a
                key={item.key}
                href={buildHref({ category: category === item.key ? null : item.key, view: "all" }, state)}
                className={category === item.key ? "is-active" : undefined}
              >
                <strong>{item.label}</strong>
                <span>{count} {count === 1 ? "thing" : "things"} upcoming</span>
              </a>
            );
          })}
        </div>
      </section>

      {!error && recurringSeries.length ? (
        <section className="elm-local-discovery-section elm-local-series-section" aria-labelledby="series-title">
          <div className="elm-local-section-heading">
            <div>
              <p className="elm-local-kicker">Happens more than once</p>
              <h2 id="series-title">Recurring around here.</h2>
            </div>
            <p>One program, every dependable upcoming date. The calendar below still keeps each occurrence separate.</p>
          </div>
          <div className="elm-local-series-grid">
            {recurringSeries.map((group) => <SeriesCard key={group.key} group={group} />)}
          </div>
        </section>
      ) : null}

      {!error ? (
        <section className="elm-local-discovery-section elm-local-weekend" aria-labelledby="weekend-title">
          <div className="elm-local-section-heading elm-local-weekend-heading">
            <div>
              <p className="elm-local-kicker">Make a plan</p>
              <h2 id="weekend-title">{weekendLabel}.</h2>
            </div>
            <a href={buildHref({ view: "weekend" }, state, "calendar")}>See the weekend →</a>
          </div>
          {weekendEvents.length ? (
            <div className="elm-local-weekend-list">
              {weekendEvents.map((event) => <EventCard key={event.public_id} event={event} compact />)}
            </div>
          ) : (
            <div className="elm-local-empty"><strong>Nothing verified for this weekend yet.</strong><p>Elm Local will add it when there’s something dependable to show.</p></div>
          )}
        </section>
      ) : null}

      <section className="elm-local-calendar" id="calendar" aria-labelledby="calendar-title">
        <div className="elm-local-section-heading elm-local-calendar-heading">
          <div>
            <p className="elm-local-kicker">Browse everything</p>
            <h2 id="calendar-title">The full local calendar.</h2>
          </div>
          <p>Verified happenings across the Elm Local region, in date order. Recurring series remain occurrence-by-occurrence here.</p>
        </div>

        <nav className="elm-local-filter-row" aria-label="Calendar range">
          {[...viewFilters, { key: "all" as ViewKey, label: "All Events" }].map((filter) => (
            <a
              key={filter.key}
              href={buildHref({ view: filter.key }, state, "calendar")}
              className={view === filter.key ? "is-active" : undefined}
              aria-current={view === filter.key ? "page" : undefined}
            >
              {filter.label}
            </a>
          ))}
        </nav>

        {!error && grouped.size === 0 ? (
          <div className="elm-local-empty">
            <strong>Nothing verified for this search yet.</strong>
            <p>Try another date, category, or nearby town—or send Elm Local an event below.</p>
          </div>
        ) : null}

        <div className="elm-local-day-list">
          {[...grouped.entries()].map(([dateKey, dayEvents]) => (
            <section className="elm-local-day" key={dateKey}>
              <h3>{DATE_HEADING.format(new Date(dayEvents[0].starts_at))}</h3>
              <div className="elm-local-event-list">
                {dayEvents.map((event) => <EventCard key={event.public_id} event={event} />)}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="elm-local-submit" id="submit-event" aria-labelledby="submit-event-title">
        <div className="elm-local-section-heading">
          <p className="elm-local-kicker">Know about something?</p>
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
