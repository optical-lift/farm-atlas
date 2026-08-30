import AskElm from "./ask-elm";
import DiscoveryPage from "./discovery-page";
import {
  DATE_HEADING,
  eventHref,
  loadEvents,
  localDateKey,
  timeLabel,
  type CalendarEvent,
} from "./public-events";

export const dynamic = "force-dynamic";

type DiscoveryProps = Parameters<typeof DiscoveryPage>[0];

const BROWSE_KEYS = new Set(["q", "city", "category", "view", "submitted", "error"]);
const HOME_CALENDAR_LIMIT = 4;

function calendarPreview(events: CalendarEvent[], today: string) {
  return events
    .filter((event) => localDateKey(new Date(event.starts_at)) >= today)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, HOME_CALENDAR_LIMIT);
}

function CalendarRow({ event }: { event: CalendarEvent }) {
  const dateKey = localDateKey(new Date(event.starts_at));
  const place = event.venue_name || event.host_name || event.city;

  return (
    <article className="elm-local-town-event">
      <div className="elm-local-town-event__date">
        <span>{DATE_HEADING.format(new Date(`${dateKey}T12:00:00-05:00`))}</span>
      </div>
      <div className="elm-local-town-event__time">{timeLabel(event)}</div>
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

  // Keep the deeper discovery surface available when someone explicitly asks to browse it.
  if (browseMode) return <DiscoveryPage {...props} />;

  const today = localDateKey(new Date());
  const { events, error } = await loadEvents(14);
  const previewEvents = calendarPreview(events, today);

  return (
    <main className="elm-local-page elm-local-front-door">
      <header className="elm-local-shell-header">
        <a className="elm-local-masthead__name" href="/local" aria-label="Elm Local home">elm local</a>
        <nav className="elm-local-site-nav" aria-label="Elm Local navigation">
          <a className="is-active" href="#ask-elm">Ask Elm</a>
          <a href="#town-calendar">Calendar</a>
          <a href="https://www.elmfarm.co">Elm Farm</a>
        </nav>
      </header>

      <section className="elm-local-ask-home" id="ask-elm">
        <section className="elm-local-ask-lead" aria-labelledby="ask-elm-title">
          <h1 id="ask-elm-title">What are you looking for?</h1>
          <AskElm />
        </section>
      </section>

      <section className="elm-local-town-calendar" id="town-calendar" aria-labelledby="town-calendar-title">
        <div className="elm-local-town-calendar__inner">
          <div className="elm-local-town-calendar__heading">
            <h2 id="town-calendar-title">Town Calendar</h2>
          </div>

          {error ? (
            <p className="elm-local-town-calendar__empty">The town calendar is unavailable right now.</p>
          ) : previewEvents.length ? (
            <div className="elm-local-town-calendar__events">
              {previewEvents.map((event) => <CalendarRow key={event.public_id} event={event} />)}
            </div>
          ) : (
            <p className="elm-local-town-calendar__empty">Nothing is on the calendar for the next few days yet.</p>
          )}

          <a className="elm-local-town-calendar__more" href="/local?view=next7#calendar">View full calendar →</a>
        </div>
      </section>
    </main>
  );
}
