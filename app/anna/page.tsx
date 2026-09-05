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

const atlasTaskLinks = {
  "2026-09-07-harvest-diy-buckets": { mode: "schedule-native", refs: "" },
  "2026-09-07-spray-bb10-walkways": { mode: "composite", refs: "task:1405c7a2-270f-494a-8e1c-59884a8b4fc9;task:53590d76-5e63-4c3a-9c58-724639f81067" },
  "2026-09-07-weed-spray-bw-crescent": { mode: "schedule-native", refs: "" },
  "2026-09-07-fishing-line-fr11-14": { mode: "schedule-native", refs: "" },
  "2026-09-07-mulch-mailbox": { mode: "exact", refs: "task:43cbc150-f04a-41ed-8596-719356791c2e" },
  "2026-09-07-wipe-upper-cabinets": { mode: "schedule-native", refs: "" },
  "2026-09-07-deliver-diy-springfield": { mode: "schedule-native", refs: "" },

  "2026-09-08-upick-1-2": { mode: "partial", refs: "task:d6bdf176-5ccd-493a-a983-007df422de2b" },
  "2026-09-08-edge-garden-beds": { mode: "schedule-native", refs: "" },
  "2026-09-08-mulch-mg-front": { mode: "exact", refs: "task:18e31ded-5d9f-475c-bf5b-b07b14045569" },
  "2026-09-08-fall-bed-photos": { mode: "schedule-native", refs: "" },
  "2026-09-08-fall-transplants": { mode: "composite", refs: "task:56fab382-c937-4be1-acc4-c657051a523d;task:6cecda4e-8f55-4ba0-9473-21b03927aaf1;task:44d16fe4-a492-4db6-bf10-576eeaa9736b;task:581eacf6-17ef-480b-ba52-0f68374621e4;crop_cycle:fb93e23e-1f15-4e5e-824f-2773ded728a7;crop_cycle:66339d52-43ff-4d2b-b120-ed6146e8f655" },
  "2026-09-08-stain-upper-cabinets": { mode: "schedule-native", refs: "" },

  "2026-09-09-weed-bw-spiral-pockets": { mode: "schedule-native", refs: "" },
  "2026-09-09-spray-bw-spiral-path": { mode: "schedule-native", refs: "" },
  "2026-09-09-upick-3-4": { mode: "partial", refs: "task:d6bdf176-5ccd-493a-a983-007df422de2b" },
  "2026-09-09-pot-shasta": { mode: "exact", refs: "occurrence:0ff2aaee-3369-415f-a941-faa3756450e7" },
  "2026-09-09-pot-foxglove": { mode: "exact", refs: "occurrence:af608649-9ccb-48f3-b4f0-c728922482a3" },
  "2026-09-09-event-prep": { mode: "exact", refs: "occurrence:a3c215cd-4c90-4a89-933f-38d125629b99" },
  "2026-09-09-move-eb-mulch-to-bb": { mode: "schedule-native", refs: "" },

  "2026-09-10-harvest-stems": { mode: "exact", refs: "occurrence:f160c5cb-8dfa-498c-8fd6-11fdbce36fa0" },
  "2026-09-10-bundle-harvest": { mode: "schedule-native", refs: "" },
  "2026-09-10-pot-salvia": { mode: "exact", refs: "occurrence:da49b391-30a2-4983-a171-08e13acc724d" },
  "2026-09-10-event-host": { mode: "exact", refs: "occurrence:7cbd418d-fab3-4bb6-9a5f-97deab18ae6d" },

  "2026-09-11-weed-eb10": { mode: "schedule-native", refs: "" },
  "2026-09-11-deliver-bundles-springfield": { mode: "schedule-native", refs: "" },
  "2026-09-11-upick-5-6": { mode: "partial", refs: "task:9f4db991-c830-46d4-a314-521664e0ee38" },
  "2026-09-11-pot-echinacea": { mode: "exact", refs: "occurrence:0ef83d10-fdde-4412-b319-ad3f9fea8549" },
  "2026-09-11-pot-yarrow": { mode: "exact", refs: "occurrence:3d3d8c51-efc5-4b4f-bf51-e45a2409611e" },
  "2026-09-11-pick-up-hair": { mode: "partial", refs: "task:ca4a7675-e468-4bfd-be85-058a32dbf8df" },
  "2026-09-11-paint-purple-doors": { mode: "exact", refs: "task:c52997f0-855c-4e2a-81ff-62dec9284e4d" },
} as const;

function atlasAttrs(key: keyof typeof atlasTaskLinks) {
  const link = atlasTaskLinks[key];
  return {
    "data-anna-task-key": key,
    "data-atlas-link-mode": link.mode,
    "data-atlas-refs": link.refs,
  };
}

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
              <div {...atlasAttrs("2026-09-07-harvest-diy-buckets")} style={taskTextStyle}>Harvest for 2 DIY Buckets (I&apos;l send the recipe, harvest everything you can find like Thursdays)</div>
              <div {...atlasAttrs("2026-09-07-spray-bb10-walkways")} style={taskTextStyle}>Spray BB10 and BB walkways</div>
              <div {...atlasAttrs("2026-09-07-weed-spray-bw-crescent")} style={taskTextStyle}>Weed and then spray remaining BW Crescent Moon</div>
              <div {...atlasAttrs("2026-09-07-fishing-line-fr11-14")} style={taskTextStyle}>String fishing line in FR11–14</div>
              <div {...atlasAttrs("2026-09-07-mulch-mailbox")} style={taskTextStyle}>Put EB mulch around mailbox</div>
              <div {...atlasAttrs("2026-09-07-wipe-upper-cabinets")} style={taskTextStyle}>Wipe down upper cabinets in the kitchen</div>
              <div {...atlasAttrs("2026-09-07-deliver-diy-springfield")} style={taskTextStyle}>Deliver DIY buckets and all harvest to Springfield at 5pm (arrival time)</div>
            </div>
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Tuesday, Sept. 8
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div {...atlasAttrs("2026-09-08-upick-1-2")} style={taskTextStyle}>Measure + stake/string <strong>U-Pick Beds 1 + 2</strong></div>
              <div {...atlasAttrs("2026-09-08-edge-garden-beds")} style={taskTextStyle}>Edge garden beds with weed whacker</div>
              <div {...atlasAttrs("2026-09-08-mulch-mg-front")} style={taskTextStyle}>Put EB mulch on MG front perennial strip</div>
              <div {...atlasAttrs("2026-09-08-fall-bed-photos")}>
                <div style={taskTextStyle}><strong>Upload bed photos for fall planting</strong></div>
                <div style={{ ...detailTextStyle, marginTop: 5 }}>Upload a clear photo of each bed to iCloud and add a note with which bed it is (swipe up to find note).</div>
                <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 28 }}>
                  <li>BW1</li>
                  <li>BW2</li>
                  <li>BW3</li>
                  <li>BW4</li>
                  <li>BB1</li>
                  <li>BB2</li>
                  <li>BB3</li>
                  <li>BB4</li>
                  <li>BB5</li>
                  <li>BB6</li>
                  <li>BB7</li>
                </ul>
              </div>
              <div {...atlasAttrs("2026-09-08-fall-transplants")}>
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
              <div {...atlasAttrs("2026-09-08-stain-upper-cabinets")} style={taskTextStyle}>Stain upper cabinets in the kitchen</div>
            </div>
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Wednesday, Sept. 9
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div {...atlasAttrs("2026-09-09-weed-bw-spiral-pockets")} style={taskTextStyle}>Weed <strong>Berry Walk Spiral planting pockets (beside walkway)</strong></div>
              <div {...atlasAttrs("2026-09-09-spray-bw-spiral-path")} style={taskTextStyle}>Spray Berry Walk Spiral Path if it&apos;s regrowing.</div>
              <div {...atlasAttrs("2026-09-09-upick-3-4")} style={taskTextStyle}>Measure + stake/string <strong>U-Pick Beds 3 + 4</strong></div>
              <div {...atlasAttrs("2026-09-09-pot-shasta")} style={taskTextStyle}>Pot up Shasta Daisy → plant in MG nursery Sept. 22</div>
              <div {...atlasAttrs("2026-09-09-pot-foxglove")} style={taskTextStyle}>Pot up Sutton’s Apricot foxglove → plant in MG nursery Sept. 24</div>
              <div {...atlasAttrs("2026-09-09-event-prep")}>
                <div style={taskTextStyle}><strong>Prep Thursday evening at Elm</strong></div>
                <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 28 }}>
                  <li>Theme: learn how to harvest your backyard garden flowers, strip/condition, arrange in jar to take home. So the only prep is a strip bucket, snips and jars. Everything else comes in from outside with the ladies. You can start bundling that morning&apos;s harvest that&apos;s obviously not being used while they make jars.</li>
                  <li>Make cold brew + lemonade</li>
                </ul>
              </div>
              <div {...atlasAttrs("2026-09-09-move-eb-mulch-to-bb")} style={taskTextStyle}><strong>Move mulch from EB beds to BB beds that are done producing (pull any burmuda first)</strong></div>
            </div>
          </section>

          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 22, lineHeight: 1.25, fontWeight: 600, margin: "0 0 18px", overflowWrap: "anywhere" }}>
              Thursday, Sept. 10
            </h2>
            <div style={{ display: "grid", gap: 12 }}>
              <div {...atlasAttrs("2026-09-10-harvest-stems")} style={taskTextStyle}>Harvest stems (harvest the goldenrod, hyacinth, olive branches, basil, sunflowers, etc like normal for bundling but leave the zinnias and celosia for the event and have the attendees harvest it all themselves along with the other fillers across the property)</div>
              <div {...atlasAttrs("2026-09-10-bundle-harvest")} style={taskTextStyle}>Bundle everything you harvested; they&apos;re going to harvest everything they use for the event themselves (which is why you&apos;re leaving a little in the field that we don&apos;t have much of like zinnias).</div>
              <div {...atlasAttrs("2026-09-10-pot-salvia")} style={taskTextStyle}>Pot up Violet salvia → plant in MG nursery Sept. 24</div>
              <div {...atlasAttrs("2026-09-10-event-host")}>
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
              <div {...atlasAttrs("2026-09-11-weed-eb10")} style={taskTextStyle}><strong>Weed EB10</strong></div>
              <div {...atlasAttrs("2026-09-11-deliver-bundles-springfield")} style={taskTextStyle}>Deliver Thursday&apos;s bundles to Springfield by 10am (arrival)</div>
              <div {...atlasAttrs("2026-09-11-upick-5-6")} style={taskTextStyle}>Measure + stake/string <strong>U-Pick Beds 5 + 6</strong></div>
              <div {...atlasAttrs("2026-09-11-pot-echinacea")} style={taskTextStyle}>Pot up echinacea purple + white → plant in MG nursery Sept. 25</div>
              <div {...atlasAttrs("2026-09-11-pot-yarrow")} style={taskTextStyle}>Pot up golden yarrow → plant in MG nursery Sept. 25</div>
              <div {...atlasAttrs("2026-09-11-pick-up-hair")}>
                <div style={taskTextStyle}><strong>Pick up hair</strong></div>
                <ul style={{ ...detailTextStyle, margin: "5px 0 0", paddingLeft: 28 }}>
                  <li>Harvey’s Barber Shop</li>
                  <li>Jagged Edge Salon Featuring B’s Esthetics</li>
                </ul>
              </div>
              <div {...atlasAttrs("2026-09-11-paint-purple-doors")} style={taskTextStyle}>Paint <strong>2 exterior house doors with first coat of purple</strong></div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
