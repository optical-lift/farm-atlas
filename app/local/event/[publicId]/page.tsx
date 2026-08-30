import { notFound } from "next/navigation";

import {
  categoryLabel,
  costLabel,
  eventDetail,
  loadEvent,
  loadSeries,
  longDateLabel,
  publicDetailRows,
  seriesHref,
  timeLabel,
  verifiedLabel,
} from "../../public-events";

export const dynamic = "force-dynamic";

export default async function ElmLocalEventPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const { event, error } = await loadEvent(publicId);
  if (!event && !error) notFound();

  if (!event) {
    return (
      <main className="elm-local-page elm-local-detail-page">
        <div className="elm-local-detail-wrap">
          <a className="elm-local-back-link" href="/local">← Elm Local</a>
          <div className="elm-local-notice error">This event is temporarily unavailable. Elm Local will not substitute guessed details.</div>
        </div>
      </main>
    );
  }

  const seriesEvents = event.series_key ? (await loadSeries(event.series_key)).events : [];
  const otherSeriesEvents = seriesEvents.filter((item) => item.public_id !== event.public_id).slice(0, 6);
  const detailRows = publicDetailRows(event);
  const lead = eventDetail(event) ?? event.featured_note ?? null;
  const cost = costLabel(event);
  const verification = verifiedLabel(event);

  return (
    <main className="elm-local-page elm-local-detail-page">
      <div className="elm-local-detail-wrap">
        <header className="elm-local-detail-topbar">
          <a className="elm-local-back-link" href="/local">← Elm Local</a>
          <span>Marshfield + surrounding communities</span>
        </header>

        <article className="elm-local-detail-card">
          <p className="elm-local-kicker">Elm Local event</p>
          <p className="elm-local-detail-date">{longDateLabel(event)}</p>
          <h1>{event.title}</h1>
          {lead ? <p className="elm-local-detail-lead">{lead}</p> : null}

          <div className="elm-local-detail-meta-grid">
            <section>
              <span>When</span>
              <strong>{longDateLabel(event)}</strong>
              <p>{timeLabel(event)}</p>
            </section>
            <section>
              <span>Where</span>
              <strong>{event.venue_name || event.host_name || "Location TBA"}</strong>
              <p>{[event.city, event.state].filter(Boolean).join(", ") || "Location details pending"}</p>
            </section>
            <section>
              <span>Hosted by</span>
              <strong>{event.host_name || "Host not listed"}</strong>
              <p>{cost || "See event details for cost"}</p>
            </section>
          </div>

          {event.categories.length ? (
            <div className="elm-local-detail-tags" aria-label="Event categories">
              {event.categories.map((key) => <span key={key}>{categoryLabel(key)}</span>)}
            </div>
          ) : null}

          {detailRows.length ? (
            <section className="elm-local-detail-facts" aria-labelledby="event-details-heading">
              <h2 id="event-details-heading">What to know.</h2>
              <dl>
                {detailRows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <div className="elm-local-detail-actions">
            {event.public_url ? <a className="elm-local-primary-action" href={event.public_url} target="_blank" rel="noreferrer">Official event page ↗</a> : null}
            <a className="elm-local-secondary-action" href="/local#calendar">Back to calendar</a>
          </div>

          {verification ? <p className="elm-local-verification-note">{verification}. Elm Local keeps the public listing separate from its source record.</p> : null}
        </article>

        {event.series_key && event.series_title ? (
          <aside className="elm-local-series-detail-callout">
            <p className="elm-local-kicker">Part of a recurring series</p>
            <h2><a href={seriesHref(event.series_key)}>{event.series_title}</a></h2>
            {event.series_summary ? <p>{event.series_summary}</p> : null}
            {otherSeriesEvents.length ? (
              <div className="elm-local-other-dates">
                <strong>Other upcoming dates</strong>
                <div>
                  {otherSeriesEvents.map((item) => (
                    <a key={item.public_id} href={`/local/event/${encodeURIComponent(item.public_id)}`}>
                      <span>{longDateLabel(item)}</span>
                      <small>{timeLabel(item)}</small>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
            <a className="elm-local-text-action" href={seriesHref(event.series_key)}>See the whole series →</a>
          </aside>
        ) : null}

        <footer className="elm-local-detail-footer">
          <strong>Elm Local</strong>
          <span>Built at Elm Farm for the community around it.</span>
        </footer>
      </div>
    </main>
  );
}
