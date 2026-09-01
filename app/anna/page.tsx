const wednesdayTasks = [
  "Put EB mulch on MG front perennial strip",
  "Harden off · Chantilly series mixed trays · Overwinter 2026",
  "Harden off · First Lady Mixed Colors · Overwinter 2026",
  "Harden off · Potomac Berry Blend F1 · Overwinter 2026",
  "Harden off · Rocket Mix F1 · Overwinter 2026",
  "Call Marshfield salons & groomers for hair",
  "Pot up · Sweet William",
];

export default function AnnaPage() {
  return (
    <main
      style={{
        width: "min(680px, calc(100% - 40px))",
        margin: "0 auto",
        padding: "48px 0 72px",
        fontFamily: "Arial, Helvetica, sans-serif",
        color: "#111",
        lineHeight: 1.5,
      }}
    >
      <section>
        <h1 style={{ fontSize: 28, margin: "0 0 20px" }}>Wednesday, September 2, 2026</h1>
        <ol style={{ margin: 0, paddingLeft: 28, fontSize: 20 }}>
          {wednesdayTasks.map((task) => (
            <li key={task} style={{ marginBottom: 12 }}>
              {task}
            </li>
          ))}
        </ol>
      </section>

      <section style={{ marginTop: 48 }}>
        <h2 style={{ fontSize: 28, margin: 0 }}>Thursday, September 3, 2026</h2>
      </section>
    </main>
  );
}
