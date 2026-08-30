import AskElm from "./ask-elm";
import DiscoveryPage from "./discovery-page";
import {
  DATE_HEADING,
  addDays,
  costLabel,
  eventHref,
  loadEvents,
  localDateKey,
  timeLabel,
  type CalendarEvent,
} from "./public-events";

export const dynamic = "force-dynamic";

type DiscoveryProps = Parameters<typeof DiscoveryPage>[0];

const BROWSE_KEYS = new Set(["q", "city", "category", "view", "submitted", "error"]);

function groupCalendar(events: CalendarEvent[], start: string, end: string) {
  const upcoming = events
    .filter((event) => {
      const key = localDateKey(new Date(event.starts_at));
      return key >= start && key <= end;
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  const groups = new Map<string, CalendarEvent[]>();
  for (const event of upcoming) {
    const key = localDateKey(new Date(event.starts_at));
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  return [...groups.entries()];
}

function CalendarRow({ event }: { event: CalendarEvent }) {
  const place = [event.venue_name || event.host_name, event.city].filter(Boolean).join(" · ");
  const cost = costLabel(event);

  return (
    <article className="elm-local-town-event">
      <div className="elm-local-town-event__time">
        <span>{timeLabel(event)}</span>
        {cost ? <small>{cost}</small> : null}
      </div>
      <div className="elm-local-town-event__body">
        <h3><a href={eventHref(event)}>{event.title}</a></h3>
        {place ? <p>{place}</p> : null}
      </div>
    </article>
  );
}

export default async function ElmLocalPage(props: DiscoveryProps) {
  const searchParams = await props.searchParams;
  const browseMode = Object.keys(searchParams).some((key) => BROWSE_KEYS.has(key));

  // Keep the existing deep discovery surface available when someone explicitly
  // asks to browse it, while the public front page stays Ask-first and editorial.
  if (browseMode) return <DiscoveryPage {...props} />;

  const today = localDateKey(new Date());
  const through = addDays(today, 6);
  const { events, error } = await loadEvents(14);
  const calendarGroups = groupCalendar(events, today, through);

  return (
    <main className="elm-local-page elm-local-front-door">
      <section className="elm-local-ask-home" id="ask-elm">
        <header className="elm-local-masthead">
          <p className="elm-local-masthead__name">Elm Local</p>
          <p className="elm-local-masthead__place">Marshfield + surrounding communities</p>
        </header>

        <section className="elm-local-ask-lead" aria-labelledby="ask-elm-title">
          <p className="elm-local-kicker">Ask Elm</p>
          <h1 id="ask-elm-title">What are you looking for?</h1>
          <AskElm />
        </section>

        <section className="elm-local-town-calendar" aria-labelledby="town-calendar-title">
          <div className="elm-local-town-calendar__heading">
            <div>
              <p className="elm-local-kicker">Around town</p>
              <h2 id="town-calendar-title">Town Calendar</h2>
            </div>
            <a href="/local?view=next7#calendar">Full calendar →</a>
          </div>

          {error ? (
            <p className="elm-local-town-calendar__empty">The town calendar is unavailable right now.</p>
          ) : calendarGroups.length ? (
            <div className="elm-local-town-calendar__days">
              {calendarGroups.map(([dateKey, dayEvents]) => (
                <section className="elm-local-town-day" key={dateKey}>
                  <h3>{DATE_HEADING.format(new Date(`${dateKey}T12:00:00-05:00`))}</h3>
                  <div className="elm-local-town-day__events">
                    {dayEvents.map((event) => <CalendarRow key={event.public_id} event={event} />)}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="elm-local-town-calendar__empty">Nothing is on the calendar for the next few days yet.</p>
          )}
        </section>

        <nav className="elm-local-front-door__links" aria-label="More from Elm Local">
          <a href="/local?view=next7#calendar">Browse local events</a>
          <a href="/local?view=next7#submit-event">Submit an event</a>
        </nav>
      </section>

      <footer className="elm-local-front-door__footer">
        Maintained by Elm Farm for the local community.
      </footer>
    </main>
  );
}
