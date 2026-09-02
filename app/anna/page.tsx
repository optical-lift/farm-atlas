const taskTextStyle = {
  fontSize: 16,
  lineHeight: 1.45,
} as const;

const detailTextStyle = {
  fontSize: 13,
  lineHeight: 1.45,
  color: "#4a4a4a",
} as const;

export default function AnnaPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        width: "100%",
        background: "#fff",
        color: "#111",
        fontFamily: "var(--font-geist-sans), sans-serif",
      }}
    >
      <div
        style={{
          width: "min(680px, calc(100% - 40px))",
          margin: "0 auto",
          padding: "36px 0 64px",
        }}
      >
        <section>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 18px" }}>
            Wednesday, September 2, 2026
          </h1>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={taskTextStyle}>Put EB mulch on MG front perennial strip</div>
            <div style={taskTextStyle}>Harden off · Chantilly series mixed trays · Overwinter 2026</div>
            <div style={taskTextStyle}>Harden off · First Lady Mixed Colors · Overwinter 2026</div>
            <div style={taskTextStyle}>Harden off · Potomac Berry Blend F1 · Overwinter 2026</div>
            <div style={taskTextStyle}>Harden off · Rocket Mix F1 · Overwinter 2026</div>

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
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 18px" }}>
            Thursday, September 3, 2026
          </h2>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={taskTextStyle}>Harvest Stems</div>
            <div>
              <div style={taskTextStyle}>Host Community Thursday</div>
              <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 30 }}>
                <li>Turn on the ice maker</li>
                <li>Turn on the OPEN sign</li>
                <li>Open the yellow door</li>
              </ul>
            </div>
            <div style={taskTextStyle}>Pot up · Tetra feverfew</div>
            <div style={taskTextStyle}>Bundle stems for orders</div>
            <div style={taskTextStyle}>Weed MG4</div>
          </div>
        </section>

        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 18px" }}>
            Friday, September 4, 2026
          </h2>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={taskTextStyle}>Pot up · oregano</div>
            <div style={taskTextStyle}>Put EB mulch around mailbox</div>
            <div style={taskTextStyle}>Weed Oasis Iris Grove</div>
          </div>
        </section>
      </div>
    </main>
  );
}
