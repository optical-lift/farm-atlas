import { Source_Sans_3 } from "next/font/google";

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

export default function AnnaPage() {
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
            <h1 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Tuesday, September 8, 2026
            </h1>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={taskTextStyle}>Weed and then spray remaining BW crescent moon</div>
              <div style={taskTextStyle}>Measure + stake/string U-Pick Beds 1–4</div>
              <div style={taskTextStyle}>Edge garden beds with weed whacker</div>
              <div style={taskTextStyle}>String fishing line in FR11–14 — take it down where harvests are finished and reuse posts</div>
              <div style={taskTextStyle}>Spray BB10 and BB walkways</div>
            </div>
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Wednesday, September 9, 2026
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={taskTextStyle}>Weed MG8</div>
              <div style={taskTextStyle}>Measure + stake/string U-Pick Beds 5–8</div>
              <div>
                <div style={taskTextStyle}>Prep paid Thursday evening at Elm</div>
                <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 28 }}>
                  <li>Tidy guest spaces: entry, kitchen, conference room, library</li>
                  <li>Make cold brew</li>
                  <li>Check coffee bar supplies: milk, flavored syrup, paper cups</li>
                  <li>Check water dispenser + clear cups</li>
                  <li>Set 3 tables + chairs</li>
                  <li>Set seed-saving + jar arrangement at each table</li>
                  <li>Harvest and condition flowers for the Thursday evening flower bar</li>
                </ul>
              </div>
              <div style={taskTextStyle}>Put EB mulch on MG front perennial strip</div>
              <div style={taskTextStyle}>Stain upper cabinets in the kitchen</div>
            </div>
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Thursday, September 10, 2026
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={taskTextStyle}>Weed MG10</div>
              <div>
                <div style={taskTextStyle}>Florist route — Thursday morning</div>
                <div style={{ ...detailTextStyle, marginTop: 5 }}>
                  Start and end at Elm. Take the flower inventory and prices supplied at departure and report the result of every stop.
                </div>
              </div>
              <div>
                <div style={taskTextStyle}>Finish paid Thursday evening prep + host</div>
                <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 28 }}>
                  <li>Finish flower-bar setup and condition any last stems</li>
                  <li>Fill water dispenser</li>
                  <li>Set coffee bar + pastry/snack</li>
                  <li>Turn on the ice maker</li>
                  <li>Turn on the OPEN sign</li>
                  <li>Open the yellow door</li>
                  <li>Host the paid ticketed Thursday evening</li>
                </ul>
              </div>
            </div>
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Friday, September 11, 2026
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={taskTextStyle}>Weed Berry Walk Spiral Path</div>
              <div style={taskTextStyle}>Measure + stake/string U-Pick Beds 9–12</div>
              <div>
                <div style={taskTextStyle}>Pick up hair</div>
                <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 28 }}>
                  <li>Harvey&apos;s Barber Shop</li>
                  <li>Jagged Edge Salon Featuring B&apos;s Esthetics</li>
                </ul>
              </div>
              <div style={taskTextStyle}>Paint 2 exterior house doors purple — coat 1</div>
              <div style={taskTextStyle}>Put EB mulch around mailbox</div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
