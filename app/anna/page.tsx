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
              Monday, Sept. 7
            </h1>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={taskTextStyle}>Harvest for 2 DIY Buckets (I&apos;l send the recipe, harvest everything you can find like Thursdays)</div>
              <div style={taskTextStyle}>Spray BB10 and BB walkways</div>
              <div style={taskTextStyle}>Weed and then spray remaining BW Crescent Moon</div>
              <div style={taskTextStyle}>String fishing line in FR11–14</div>
              <div style={taskTextStyle}>Put EB mulch around mailbox</div>
              <div style={taskTextStyle}>Wipe down upper cabinets in the kitchen</div>
              <div style={taskTextStyle}>Deliver DIY buckets and all harvest to Springfield at 5pm (arrival time)</div>
            </div>
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Tuesday, Sept. 8
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={taskTextStyle}>Measure + stake/string <strong>U-Pick Beds 1 + 2</strong></div>
              <div style={taskTextStyle}>Edge garden beds with weed whacker</div>
              <div style={taskTextStyle}>Put EB mulch on MG front perennial strip</div>
              <div>
                <div style={taskTextStyle}><strong>Plant fall transplants:</strong></div>
                <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 28 }}>
                  <li>MG1: Cabbage + 3 Rainbow Swiss chard + 3 little clumps of thyme</li>
                  <li>MG2: Onion + kale + 3 Rainbow Swiss chard + 3 little clumps of thyme</li>
                  <li>MG4 : Cabbage + 3 little clumps of thyme</li>
                  <li>MG7: Onion mix + kale + 3 Rainbow Swiss chard + 3 little clumps of thyme</li>
                  <li>MG8: Cabbage + 3 little clumps of thyme</li>
                  <li>MG10: Onion + kale + 3 little clumps of thyme</li>
                </ul>
              </div>
              <div style={taskTextStyle}>Stain upper cabinets in the kitchen</div>
            </div>
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Wednesday, Sept. 9
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={taskTextStyle}>Weed <strong>Berry Walk Spiral planting pockets (beside walkway)</strong></div>
              <div style={taskTextStyle}>Spray Berry Walk Spiral Path if it&apos;s regrowing.</div>
              <div style={taskTextStyle}>Measure + stake/string <strong>U-Pick Beds 3 + 4</strong></div>
              <div style={taskTextStyle}>Pot up Shasta Daisy</div>
              <div>
                <div style={taskTextStyle}><strong>Prep Thursday evening at Elm</strong></div>
                <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 28 }}>
                  <li>Theme: learn how to harvest your backyard garden flowers, strip/condition, arrange in jar to take home. So the only prep is a strip bucket, snips and jars. Everything else comes in from outside with the ladies. You can start bundling that morning&apos;s harvest that&apos;s obviously not being used while they make jars.</li>
                  <li>Make cold brew + lemonade</li>
                </ul>
              </div>
              <div style={taskTextStyle}><strong>Move mulch from EB beds to BB beds that are done producing (pull any burmuda first)</strong></div>
            </div>
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Thursday, Sept. 10
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={taskTextStyle}>Harvest stems (harvest the goldenrod, hyacinth, olive branches, basil, sunflowers, etc like normal for bundling but leave the zinnias and celosia for the event and have the attendees harvest it all themselves along with the other fillers across the property)</div>
              <div style={taskTextStyle}>Bundle everything you harvested; they&apos;re going to harvest everything they use for the event themselves (which is why you&apos;re leaving a little in the field that we don&apos;t have much of like zinnias).</div>
              <div>
                <div style={taskTextStyle}><strong>Thursday evening prep + host</strong></div>
                <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 28 }}>
                  <li>Set coffee bar + clean acrylic pastry box</li>
                  <li>Turn on ice maker</li>
                  <li>Turn on signs + lamp</li>
                  <li>Open yellow door</li>
                  <li>Hang purses/jackets on hooks in entryway</li>
                </ul>
              </div>
            </div>
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Friday, Sept. 11
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={taskTextStyle}><strong>Weed EB10</strong></div>
              <div style={taskTextStyle}>Deliver Thursday&apos;s bundles to Springfield by 10am (arrival)</div>
              <div style={taskTextStyle}>Measure + stake/string <strong>U-Pick Beds 5 + 6</strong></div>
              <div style={taskTextStyle}>Pot up echinacea purple + white</div>
              <div>
                <div style={taskTextStyle}><strong>Pick up hair</strong></div>
                <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 28 }}>
                  <li>Harvey’s Barber Shop</li>
                  <li>Jagged Edge Salon Featuring B’s Esthetics</li>
                </ul>
              </div>
              <div style={taskTextStyle}>Paint <strong>2 exterior house doors with first coat of purple</strong></div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
