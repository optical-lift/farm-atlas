import AskElm from "./ask-elm";
import DiscoveryPage from "./discovery-page";

export const dynamic = "force-dynamic";

type DiscoveryProps = Parameters<typeof DiscoveryPage>[0];

const BROWSE_KEYS = new Set(["q", "city", "category", "view", "submitted", "error"]);

export default async function ElmLocalPage(props: DiscoveryProps) {
  const searchParams = await props.searchParams;
  const browseMode = Object.keys(searchParams).some((key) => BROWSE_KEYS.has(key));

  // Keep the existing calendar/discovery surface available when someone explicitly
  // asks to browse it, but do not make the public front door carry the whole directory.
  if (browseMode) return <DiscoveryPage {...props} />;

  return (
    <main className="elm-local-page elm-local-front-door">
      <section className="elm-local-ask-home" id="ask-elm">
        <div className="elm-local-ask-home__topline">
          <div>
            <p className="elm-local-kicker">Elm Local</p>
            <p className="elm-local-place">Marshfield + surrounding communities</p>
          </div>
        </div>

        <div className="elm-local-ask-home__copy">
          <p className="elm-local-kicker">Ask Elm</p>
          <h1>What are you looking for?</h1>
        </div>

        <AskElm />

        <nav className="elm-local-front-door__links" aria-label="More from Elm Local">
          <a href="/local?view=next7#calendar">Browse local events →</a>
          <a href="/local?view=next7#submit-event">Submit an event →</a>
        </nav>
      </section>

      <footer className="elm-local-front-door__footer">
        Maintained by Elm Farm for the local community.
      </footer>
    </main>
  );
}
