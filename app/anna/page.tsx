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
              Wednesday, September 2, 2026
            </h1>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={taskTextStyle}>Weed MG1</div>
              <div style={taskTextStyle}>Put EB mulch on MG front perennial strip</div>

              <div>
                <div style={taskTextStyle}>Harden off</div>
                <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 28 }}>
                  <li>Chantilly series mixed trays</li>
                  <li>First Lady Mixed Colors</li>
                  <li>Potomac Berry Blend F1</li>
                  <li>Rocket Mix F1</li>
                </ul>
              </div>

              <div>
                <div style={taskTextStyle}>Call Marshfield salons &amp; groomers for hair</div>
                <div style={{ ...detailTextStyle, marginTop: 5, paddingLeft: 16 }}>
                  <div>Harvey&apos;s Barber Shop — 417-468-6700</div>
                  <div>House of Mongrels Pet Grooming LLC — 417-233-1138</div>
                  <div>Jagged Edge Salon Featuring B&apos;s Esthetics — 417-859-0041</div>
                  <div style={{ marginTop: 5 }}>
                    Hi, this is Anna with Elm Farm. We use human and pet hair in the gardens as a deer deterrent. Would you be willing to save clean cut hair for us to pick up instead of throwing it away?
                  </div>
                </div>
              </div>

              <div style={taskTextStyle}>Pot up · Sweet William</div>
              <div style={taskTextStyle}>Harvest goldenrod and Russian Olive tree branches</div>
            </div>
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Thursday, September 3, 2026
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={taskTextStyle}>Weed MG4</div>
              <div style={taskTextStyle}>Harvest Stems</div>
              <div>
                <div style={taskTextStyle}>Host Community Thursday</div>
                <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 28 }}>
                  <li>Turn on the ice maker</li>
                  <li>Turn on the OPEN sign</li>
                  <li>Open the yellow door</li>
                </ul>
              </div>
              <div style={taskTextStyle}>Pot up · Tetra feverfew</div>
              <div style={taskTextStyle}>Bundle stems for orders</div>
              <div style={taskTextStyle}>Spray BB10 and BB walkways</div>
            </div>
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Friday, September 4, 2026
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={taskTextStyle}>Weed and then spray remaining BW crescent moon</div>
              <div style={taskTextStyle}>Pot up · oregano</div>
              <div style={taskTextStyle}>Put EB mulch around mailbox</div>
              <div style={taskTextStyle}>Edge FR garden beds</div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
