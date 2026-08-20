import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const farmRound = read("app/owner/task-card-lab/FarmRoundCardSpecimen.tsx");
const farmRoundCss = read("app/owner/task-card-lab/farm-round-card-specimen.module.css");

test("Farm Round literally reuses the Venue station and local-rail visual grammar", () => {
  assert.match(farmRound, /venue-card-specimen\.module\.css/);
  assert.match(farmRound, /venue-local-rail\.module\.css/);
  assert.match(farmRound, /venueStyles\.rowKey/);
  assert.match(farmRound, /venueStyles\.stations/);
  assert.match(farmRound, /venueStyles\.station/);
  assert.match(farmRound, /localStyles\.localStation/);
  assert.match(farmRound, /venueStyles\.stationHeader/);
  assert.match(farmRound, /venueStyles\.resourceList/);
  assert.match(farmRound, /venueStyles\.reminderRow/);
  assert.match(farmRound, /localStyles\.localReminderRow/);
  assert.match(farmRound, /venueStyles\.reminderCheck/);
  assert.match(farmRound, /family="Stewardship"/);
  assert.match(farmRound, /title="Farm Round"/);
  assert.match(farmRound, /completion=\{false\}/);
});

test("Farm Round remains one priority object with the recurring stewardship rows visible inside it", () => {
  assert.match(farmRound, /Sweep porches/);
  assert.match(farmRound, /Trash to street/);
  assert.match(farmRound, /Chicken chore/);
  assert.match(farmRound, /Water outdoor plants/);
  assert.match(farmRound, /place: "House"/);
  assert.match(farmRound, /place: "Farmyard"/);
  assert.match(farmRound, /place: "Gardens \+ Grounds"/);
  assert.match(farmRound, /Round complete/);
  assert.match(farmRound, /items due/);
});

test("future Day overview must expose the actual due Farm Round rows in miniature", () => {
  assert.match(farmRound, /Day overview contract · owner-only note/);
  assert.match(farmRound, /collapsed Day-feed Farm Round must expose the actual due stewardship rows in miniature/);
  assert.match(farmRound, /Do not collapse this to only a title or an item count/);
  assert.match(farmRound, /Future Day-feed Farm Round miniature preview/);
  assert.match(farmRound, /dueItems\.map/);
  assert.match(farmRoundCss, /\.dayPreviewMock/);
});
