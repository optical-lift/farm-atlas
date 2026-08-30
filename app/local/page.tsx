import AskElm from "./ask-elm";
import DiscoveryPage from "./discovery-page";

export const dynamic = "force-dynamic";

type DiscoveryProps = Parameters<typeof DiscoveryPage>[0];

export default function ElmLocalPage(props: DiscoveryProps) {
  return (
    <>
      <section className="elm-local-ask-home" id="ask-elm">
        <div className="elm-local-ask-home__topline">
          <div>
            <p className="elm-local-kicker">Elm Local</p>
            <p className="elm-local-place">Marshfield + surrounding communities</p>
          </div>
          <a className="elm-local-submit-link" href="#submit-event">Submit an Event</a>
        </div>

        <div className="elm-local-ask-home__copy">
          <p className="elm-local-kicker">Ask Elm</p>
          <h1>What are you looking for?</h1>
          <p>Ask normally. Elm interprets the question, searches governed local reality, and tells you when it does—or doesn’t—have fresh evidence.</p>
        </div>

        <AskElm />
      </section>

      <DiscoveryPage {...props} />
    </>
  );
}
