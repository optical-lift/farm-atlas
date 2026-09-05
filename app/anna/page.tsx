import { Source_Sans_3 } from "next/font/google";

import { formatElmDay, getAnnaWorkerDelivery } from "@/lib/worker-delivery";

export const dynamic = "force-dynamic";

const sourceSans = Source_Sans_3({ subsets: ["latin"] });

const taskTextStyle = {
  fontSize: 16,
  lineHeight: 1.45,
  overflowWrap: "anywhere",
} as const;

const detailTextStyle = {
  fontSize: 13,
  lineHeight: 1.45,
  color: "#4a4a4a",
  overflowWrap: "anywhere",
} as const;

export default async function AnnaPage() {
  const delivery = await getAnnaWorkerDelivery();

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

            <div style={{ display: "grid", gap: 12 }}>
              {delivery.items.map((item) => (
                <div key={item.key} data-anna-task-key={item.key} data-worker-projection-id={item.id}>
                  <div
                    style={{
                      ...taskTextStyle,
                      display: "grid",
                      gridTemplateColumns: "20px minmax(0, 1fr)",
                      columnGap: 8,
                      alignItems: "start",
                    }}
                  >
                    <span aria-hidden="true" style={{ lineHeight: 1.45 }}>
                      {item.completed ? "●" : "○"}
                    </span>
                    <span>{item.title}</span>
                  </div>

                  {item.details.length > 0 ? (
                    <ul
                      style={{
                        ...detailTextStyle,
                        margin: "5px 0 0 28px",
                        paddingLeft: 20,
                      }}
                    >
                      {item.details.map((detail, index) => (
                        <li key={`${item.key}-detail-${index}`}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
