import { Source_Sans_3 } from "next/font/google";

import AnnaWorkerDayClient from "@/app/anna/AnnaWorkerDayClient";
import { getAnnaPilotEditState } from "@/lib/anna-worker-day-pilot";
import { formatElmDay, getAnnaWorkerDelivery } from "@/lib/worker-delivery";

export const dynamic = "force-dynamic";

const sourceSans = Source_Sans_3({ subsets: ["latin"] });

export default async function AnnaPage() {
  const [delivery, pilot] = await Promise.all([
    getAnnaWorkerDelivery(),
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
            padding: "28px 0 calc(48px + env(safe-area-inset-bottom))",
            boxSizing: "border-box",
          }}
        >
          <section>
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
      </main>
    </>
  );
}
