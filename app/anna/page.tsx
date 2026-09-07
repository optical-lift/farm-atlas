import { Source_Sans_3 } from "next/font/google";

import AnnaWorkerDayClient from "@/app/anna/AnnaWorkerDayClient";
import { getAnnaPilotEditState } from "@/lib/anna-worker-day-pilot";
import {
  formatElmDay,
  getAnnaWorkerDelivery,
  getWorkerDelivery,
} from "@/lib/worker-delivery";
import { getCurrentWorkerSessionContext } from "@/lib/worker-session";

export const dynamic = "force-dynamic";

const sourceSans = Source_Sans_3({ subsets: ["latin"] });

const employerPocketItems = [
  {
    label: "Schedule",
    title: "Thursday at Elm",
    detail: "6:30–8:30 p.m.",
  },
  {
    label: "Note",
    title: "Leave flowers for Thursday evening",
    detail: "Keep 1–3 beds unharvested Thursday morning.",
  },
  {
    label: "Reference",
    title: "DIY bucket prep",
    detail: "Harvest and prepare stems the same way we do for Thursdays at Elm.",
  },
];

export default async function AnnaPage() {
  const workerContext = await getCurrentWorkerSessionContext();
  const [delivery, pilot] = await Promise.all([
    workerContext ? getWorkerDelivery(workerContext) : getAnnaWorkerDelivery(),
    getAnnaPilotEditState(),
  ]);

  return (
    <>
      <style>{`
        html, body {
          background: #fff !important;
          min-height: 100%;
        }
        body {
          margin: 0;
        }
        .elm-pocket {
          position: fixed;
          z-index: 40;
          left: 50%;
          bottom: 0;
          transform: translateX(-50%);
          width: min(680px, 100%);
          max-height: 58px;
          overflow: hidden;
          box-sizing: border-box;
          background: #faf9f6;
          border: 1px solid #ded9d0;
          border-bottom: 0;
          border-radius: 16px 16px 0 0;
          box-shadow: 0 -5px 18px rgba(24, 22, 19, 0.045);
          transition: max-height 180ms ease, box-shadow 180ms ease;
        }
        .elm-pocket[open] {
          max-height: min(68dvh, 560px);
          overflow: auto;
          box-shadow: 0 -14px 38px rgba(24, 22, 19, 0.08);
        }
        .elm-pocket summary {
          list-style: none;
          min-height: 58px;
          box-sizing: border-box;
          padding: 8px 18px 11px;
          cursor: pointer;
          user-select: none;
        }
        .elm-pocket summary::-webkit-details-marker {
          display: none;
        }
        .elm-pocket-handle {
          display: block;
          width: 36px;
          height: 2px;
          margin: 0 auto 8px;
          background: #bdb7ae;
          border-radius: 999px;
        }
        .elm-pocket-heading {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 16px;
        }
        .elm-pocket-body {
          border-top: 1px solid #e5e1da;
          padding: 6px 18px calc(26px + env(safe-area-inset-bottom));
        }
        .elm-pocket-row {
          padding: 18px 0 17px;
          border-bottom: 1px solid #e5e1da;
        }
        .elm-pocket-row:last-child {
          border-bottom: 0;
        }
        .elm-pocket-label {
          margin-bottom: 5px;
          font-size: 10px;
          line-height: 1.2;
          font-weight: 600;
          letter-spacing: 0.09em;
          text-transform: uppercase;
          color: #777168;
        }
        .elm-pocket-title {
          font-size: 15px;
          line-height: 1.35;
          color: #171614;
        }
        .elm-pocket-detail {
          margin-top: 4px;
          font-size: 13px;
          line-height: 1.4;
          color: #666159;
        }
      `}</style>

      <main
        className={sourceSans.className}
        style={{
          minHeight: "100dvh",
          width: "100%",
          background: "#fff",
          color: "#111",
        }}
      >
        <div
          style={{
            width: "min(680px, calc(100% - 32px))",
            maxWidth: "100%",
            margin: "0 auto",
            padding: "28px 0 calc(96px + env(safe-area-inset-bottom))",
            boxSizing: "border-box",
          }}
        >
          <section>
            <div
              style={{
                marginBottom: 5,
                fontSize: 12,
                lineHeight: 1.2,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: "#6f6f6f",
              }}
            >
              Elm
            </div>
            <h1
              style={{
                fontSize: 22,
                lineHeight: 1.25,
                fontWeight: 600,
                margin: "0 0 18px",
                overflowWrap: "anywhere",
              }}
            >
              {formatElmDay(delivery.date)}
            </h1>

            <AnnaWorkerDayClient
              items={delivery.items}
              extras={delivery.extras}
              canEdit={pilot.canEdit}
            />
          </section>
        </div>

        <details className="elm-pocket">
          <summary aria-label="Open items from Elm">
            <span className="elm-pocket-handle" aria-hidden="true" />
            <span className="elm-pocket-heading">
              <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.01em" }}>
                From Elm
              </span>
              <span style={{ fontSize: 12, color: "#777168" }}>
                {employerPocketItems.length}
              </span>
            </span>
          </summary>

          <div className="elm-pocket-body">
            {employerPocketItems.map((item) => (
              <div className="elm-pocket-row" key={`${item.label}-${item.title}`}>
                <div className="elm-pocket-label">{item.label}</div>
                <div className="elm-pocket-title">{item.title}</div>
                <div className="elm-pocket-detail">{item.detail}</div>
              </div>
            ))}
          </div>
        </details>
      </main>
    </>
  );
}
