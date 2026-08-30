import { notFound } from "next/navigation";

import {
  categoryLabel,
  costLabel,
  eventHref,
  loadSeries,
  longDateLabel,
  timeLabel,
} from "../../public-events";

export const dynamic = "force-dynamic";

export default async function ElmLocalSeriesPage({ params }: { params: Promise<{ seriesKey: string }> }) {
  const { seriesKey } = await params;
  const { events, error } = await loadSeries(seriesKey);
  if (!events.length && !error) notFound();

  if (!events.length) {
    return (
      <main className="elm-local-page elm-local-detail-page">
        <div className="elm-local-detail-wrap">
          <a className="elm-local-back-link" href="/local">← Elm Local</a>
          <div className="elm-local-notice error">This series is temporarily unavailable. Elm Local will not substitute guessed dates.</div>
        </div>
      </main>
    );
  }

  const first = events[0];
  const title = first.series_title || first.title;
  const summary = first.series_summary;
  const categories = [...new Set(events.flatMap((event) => event.categories))];
  const location = first.venue_name || first.host_name || "Location TBA";

  return (
    <main className="elm-local-page elm-local-detail-page">
      <div className="elm-local-detail-wrap">
        <header className="elm-local-detail-topbar">
          <a className="elm-local-back-link" href="/local">← Elm Local</a>
          <span>Marshfield + surrounding communities</span>
        </header>

        <section className="elm-local-series-hero">
          <p className="elm-local-kicker">Recurring around here</p>
          <h1>{title}</h1>
          {summary ? <p className="elm-local-detail-lead">{summary}</p> : null}
          <div className="elm-local-series-hero__meta">
            <span>{events.length} upcoming dates</span>
            <span>{location}{first.city ? ` · ${first.city}` : ""}</span>
            {costLabel(first) ? <span>{costLabel(first)}</span> : null}
          </div>
          {categories.length ? (
            <div className="elm-local-detail-tags">
              {categories.map((key) => <span key={key}>{categoryLabel(key)}</span>)}
            </div>
          ) : null}
        </section>

        <section className="elm-local-series-dates" aria-labelledby="series-dates-heading">
          <div className="elm-local-section-heading">
            <div>
              <p className="elm-local-kicker">Every occurrence</p>
              <h2 id="series-dates-heading">Choose a date.</h2>
            </div>
            <p>Each date stays its own canonical event, even though Elm Local presents the recurring program once in discovery.</p>
          </div>

          <div className="elm-local-series-date-list">
            {events.map((event) => (
              <article key={event.public_id}>
                <div>
                  <strong>{longDateLabel(event)}</strong>
                  <span>{timeLabel(event)}</span>
                </div>
                <div>
                  <h3>{event.title}</h3>
                  <p>{event.venue_name || event.host_name || "Location TBA"}{event.city ? ` · ${event.city}` : ""}</p>
                </div>
                <a href={eventHref(event)}>View event →</a>
              </article>
            ))}
          </div>
        </section>

        <footer className="elm-local-detail-footer">
          <strong>Elm Local</strong>
          <span>Built at Elm Farm for the community around it.</span>
        </footer>
      </div>
    </main>
  );
}
