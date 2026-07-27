"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  growRoomActionLabel,
  growRoomBatchTrail,
  isCanonicalIntakeSource,
  isGrowRoomBatchLocation,
  isGrowRoomRack,
  isGrowRoomStructuralObject,
  type GrowRoomBatch,
  type GrowRoomCropProfile,
  type GrowRoomObject,
  type GrowRoomState,
} from "@/lib/atlas/grow-room";
import styles from "./grow-room.module.css";
import intakeStyles from "./grow-room-intake.module.css";

type GrowRoomResponse = {
  ok: boolean;
  growRoom?: GrowRoomState;
  error?: string;
};

type WriteResponse = {
  ok: boolean;
  error?: string;
};

type StructureKind = "rack" | "shelf" | "hardening_area";

type IntakeFormState = {
  sourceObjectId: string;
  cropProfileId: string;
  cropLabel: string;
  variety: string;
  batchLabel: string;
  containerKind: string;
  trayCount: string;
  liveQuantity: string;
  sownDate: string;
  seedsSown: string;
  condition: string;
  locationObjectId: string;
  destinationObjectId: string;
  note: string;
};

const emptyIntake: IntakeFormState = {
  sourceObjectId: "",
  cropProfileId: "",
  cropLabel: "",
  variety: "",
  batchLabel: "",
  containerKind: "",
  trayCount: "1",
  liveQuantity: "",
  sownDate: "",
  seedsSown: "",
  condition: "seedling_care|",
  locationObjectId: "",
  destinationObjectId: "",
  note: "",
};

function prettyDate(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function quantityLabel(batch: GrowRoomBatch) {
  const quantity = batch.currentQuantity ?? batch.viableSeedlings;
  if (quantity === null) return "Live count not recorded";
  return `${quantity.toLocaleString("en-US")} ${batch.currentUnit || "seedlings"}`;
}

function textMeta(object: GrowRoomObject, key: string) {
  const value = object.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function numberMeta(object: GrowRoomObject, key: string) {
  const value = object.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function optionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function cropProfileLabel(profile: GrowRoomCropProfile) {
  return profile.variety ? `${profile.cropLabel} · ${profile.variety}` : profile.cropLabel;
}

function actionChoices(batch: GrowRoomBatch) {
  if (batch.status === "germination_pending") {
    return [
      { key: "stand_counted", label: "Record live stand", needsQuantity: true },
      { key: "germination_failed", label: "No germination", needsQuantity: false },
    ];
  }
  if (batch.status === "failed") {
    return [{ key: "replacement_requested", label: "Re-sow or replace", needsQuantity: false }];
  }
  if (batch.status === "pot_up_needed") {
    return [{ key: "pot_up_completed", label: "Pot-up complete", needsQuantity: true }];
  }
  if (batch.status === "hardening") {
    return [
      { key: "hardening_advanced", label: "Advance hardening", needsQuantity: false },
      { key: "ready_to_transplant", label: "Ready to plant", needsQuantity: false },
    ];
  }
  if (batch.status === "transplant_ready") return [];
  return [
    { key: "mark_pot_up_needed", label: "Needs pot-up", needsQuantity: false },
    { key: "hardening_started", label: "Start hardening", needsQuantity: false },
    { key: "ready_to_transplant", label: "Ready to plant", needsQuantity: false },
    { key: "count_adjusted", label: "Correct live count", needsQuantity: true },
  ];
}

export default function GrowRoomPage() {
  const [state, setState] = useState<GrowRoomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingBatchId, setSavingBatchId] = useState<string | null>(null);
  const [savingSetup, setSavingSetup] = useState(false);
  const [savingIntake, setSavingIntake] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [batchDestinations, setBatchDestinations] = useState<Record<string, string>>({});
  const [structureKind, setStructureKind] = useState<StructureKind>("rack");
  const [structureLabel, setStructureLabel] = useState("");
  const [structureParent, setStructureParent] = useState("");
  const [intake, setIntake] = useState<IntakeFormState>(emptyIntake);
  const intakeDetailsRef = useRef<HTMLDetailsElement>(null);

  const loadRoom = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/atlas/grow-room", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await response.json() as GrowRoomResponse;
      if (!response.ok || !data.ok || !data.growRoom) {
        throw new Error(data.error || "The Grow Room could not be loaded.");
      }
      setState(data.growRoom);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The Grow Room could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRoom();
  }, [loadRoom]);

  const structuralObjects = useMemo(
    () => (state?.objects ?? []).filter(isGrowRoomStructuralObject),
    [state],
  );
  const racks = useMemo(() => structuralObjects.filter(isGrowRoomRack), [structuralObjects]);
  const locationObjects = useMemo(
    () => structuralObjects.filter(isGrowRoomBatchLocation),
    [structuralObjects],
  );
  const looseObjects = useMemo(
    () => (state?.objects ?? []).filter((object) => !isGrowRoomStructuralObject(object) && !isCanonicalIntakeSource(object)),
    [state],
  );
  const childrenByParent = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const relationship of state?.relationships ?? []) {
      if (relationship.relationshipType !== "contains") continue;
      result.set(relationship.parentObjectId, [...(result.get(relationship.parentObjectId) ?? []), relationship.childObjectId]);
    }
    return result;
  }, [state]);
  const childObjectIds = useMemo(
    () => new Set((state?.relationships ?? []).filter((row) => row.relationshipType === "contains").map((row) => row.childObjectId)),
    [state],
  );
  const batchesByLocation = useMemo(() => {
    const result = new Map<string, GrowRoomBatch[]>();
    for (const batch of state?.batches ?? []) {
      const key = batch.locationObjectId ?? "unplaced";
      result.set(key, [...(result.get(key) ?? []), batch]);
    }
    return result;
  }, [state]);
  const batchActionCount = useMemo(
    () => (state?.batches ?? []).filter((batch) => batch.actionRequired).length,
    [state],
  );
  const totalActionCount = (state?.actions.length ?? 0) + batchActionCount;

  async function postJson(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const data = await response.json() as WriteResponse;
    if (!response.ok || !data.ok) throw new Error(data.error || "The Grow Room update was not saved.");
  }

  async function recordAction(batch: GrowRoomBatch, actionKey: string, needsQuantity: boolean) {
    const rawQuantity = counts[batch.batchId]?.trim() ?? "";
    const quantity = rawQuantity === "" ? null : Number(rawQuantity);
    if (needsQuantity && (quantity === null || !Number.isFinite(quantity) || quantity < 0)) {
      setError("Enter the current live plant count before recording this move.");
      return;
    }

    setSavingBatchId(batch.batchId);
    setError(null);
    setNotice(null);
    try {
      await postJson("/api/atlas/grow-room", {
        batchId: batch.batchId,
        actionKey,
        idempotencyKey: `${batch.batchId}:${actionKey}:${crypto.randomUUID()}`,
        quantity,
        unit: quantity === null ? null : "seedlings",
        locationObjectId: locations[batch.batchId] || null,
        metadata: { sourceSurface: "grow_room_digital_room" },
      });
      setNotice("The living batch Trail was updated.");
      await loadRoom();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The Grow Room move was not saved.");
    } finally {
      setSavingBatchId(null);
    }
  }

  async function assignDestination(batch: GrowRoomBatch) {
    const destinationObjectId = batchDestinations[batch.batchId] || batch.destinationObjectId || "";
    if (!destinationObjectId) {
      setError("Choose the outdoor destination first.");
      return;
    }
    setSavingBatchId(batch.batchId);
    setError(null);
    setNotice(null);
    try {
      await postJson("/api/atlas/grow-room/destination", {
        batchId: batch.batchId,
        destinationObjectId,
        idempotencyKey: `${batch.batchId}:destination:${crypto.randomUUID()}`,
      });
      setNotice("The batch is now linked to its outdoor destination.");
      await loadRoom();
    } catch (destinationError) {
      setError(destinationError instanceof Error ? destinationError.message : "The destination was not saved.");
    } finally {
      setSavingBatchId(null);
    }
  }

  async function createStructure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!structureLabel.trim()) {
      setError("Name the physical rack, shelf, or hardening area.");
      return;
    }
    if (structureKind === "shelf" && !structureParent) {
      setError("Choose the rack or room section that holds this shelf.");
      return;
    }

    setSavingSetup(true);
    setError(null);
    setNotice(null);
    try {
      await postJson("/api/atlas/grow-room/structure", {
        label: structureLabel.trim(),
        structureKind,
        parentObjectId: structureKind === "shelf" ? structureParent : null,
        idempotencyKey: `grow-room-structure:${crypto.randomUUID()}`,
        metadata: { sourceSurface: "grow_room_setup" },
      });
      setStructureLabel("");
      setStructureParent("");
      setNotice("The physical Grow Room structure was added.");
      await loadRoom();
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "The room structure was not saved.");
    } finally {
      setSavingSetup(false);
    }
  }

  function chooseCropProfile(profileId: string) {
    const profile = state?.cropProfiles.find((row) => row.cropProfileId === profileId);
    setIntake((current) => ({
      ...current,
      cropProfileId: profileId,
      cropLabel: profile?.cropLabel ?? current.cropLabel,
      variety: profile?.variety ?? current.variety,
    }));
  }

  function chooseExistingRecord(objectId: string) {
    const object = looseObjects.find((row) => row.objectId === objectId);
    if (!object) {
      setIntake((current) => ({ ...current, sourceObjectId: "" }));
      return;
    }
    const profileId = textMeta(object, "crop_profile_id");
    const profile = state?.cropProfiles.find((row) => row.cropProfileId === profileId);
    setIntake((current) => ({
      ...current,
      sourceObjectId: object.objectId,
      cropProfileId: profileId,
      cropLabel: profile?.cropLabel ?? current.cropLabel,
      variety: profile?.variety ?? current.variety,
      batchLabel: object.label,
      containerKind: textMeta(object, "container_kind") || current.containerKind,
      sownDate: textMeta(object, "sown_date") || current.sownDate,
      seedsSown: numberMeta(object, "seed_count") || current.seedsSown,
      trayCount: "1",
    }));
  }

  function openIntakeFor(object: GrowRoomObject) {
    intakeDetailsRef.current?.setAttribute("open", "");
    chooseExistingRecord(object.objectId);
    intakeDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const [status, actionKey = ""] = intake.condition.split("|");
    const trayCount = Number(intake.trayCount);
    if (!intake.cropLabel.trim() || !intake.batchLabel.trim() || !intake.containerKind.trim() || !Number.isFinite(trayCount) || trayCount <= 0) {
      setError("Crop, batch label, container, and a positive tray or container count are required.");
      return;
    }
    const liveQuantity = optionalNumber(intake.liveQuantity);
    if (intake.liveQuantity.trim() && liveQuantity === null) {
      setError("Live plant count must be a number or left unknown.");
      return;
    }

    setSavingIntake(true);
    setError(null);
    setNotice(null);
    try {
      await postJson("/api/atlas/grow-room/intake", {
        idempotencyKey: `grow-room-intake:${crypto.randomUUID()}`,
        cropProfileId: intake.cropProfileId || null,
        cropLabel: intake.cropLabel.trim(),
        variety: intake.variety.trim() || null,
        batchLabel: intake.batchLabel.trim(),
        containerKind: intake.containerKind.trim(),
        trayCount,
        liveQuantity,
        sownDate: intake.sownDate || null,
        seedsSown: optionalNumber(intake.seedsSown),
        status,
        actionKey: actionKey || null,
        locationObjectId: intake.locationObjectId || null,
        destinationObjectId: intake.destinationObjectId || null,
        sourceObjectId: intake.sourceObjectId || null,
        note: intake.note.trim() || null,
        metadata: { sourceSurface: "grow_room_intake" },
      });
      setIntake(emptyIntake);
      setNotice("The physically verified living batch is now in the Grow Room Trail.");
      await loadRoom();
    } catch (intakeError) {
      setError(intakeError instanceof Error ? intakeError.message : "The living batch was not saved.");
    } finally {
      setSavingIntake(false);
    }
  }

  function batchCard(batch: GrowRoomBatch) {
    const trail = growRoomBatchTrail(batch);
    const choices = actionChoices(batch);
    return (
      <article className={styles.batchCard} key={batch.batchId}>
        <div className={styles.batchHeading}>
          <div>
            <small>{batch.locationLabel || "Unplaced batch"}</small>
            <h3>{batch.cropLabel}{batch.variety ? ` · ${batch.variety}` : ""}</h3>
            <p>{batch.batchLabel} · {batch.trayCount} {batch.trayCount === 1 ? "tray/container" : "trays/containers"}</p>
          </div>
          <span className={batch.actionRequired ? styles.actionBadge : styles.stageBadge}>
            {batch.actionRequired ? growRoomActionLabel(batch.actionKey) : batch.status.replaceAll("_", " ")}
          </span>
        </div>

        <ol className={styles.trail} aria-label={`Green Trail for ${batch.batchLabel}`}>
          {trail.map((node) => (
            <li className={styles[node.state]} key={node.key} aria-current={node.state === "current" ? "step" : undefined}>
              <i aria-hidden="true" />
              <span>{node.label}</span>
            </li>
          ))}
        </ol>

        <div className={styles.batchFacts}>
          <span><small>Sown</small>{prettyDate(batch.sownDate)}</span>
          <span><small>Alive now</small>{quantityLabel(batch)}</span>
          <span><small>Plant window</small>{batch.expectedTransplantStart ? `${prettyDate(batch.expectedTransplantStart)}–${prettyDate(batch.expectedTransplantEnd)}` : "Not assigned"}</span>
          <span><small>Destination</small>{batch.destinationLabel || "Not linked"}</span>
        </div>

        <div className={styles.batchControls}>
          {choices.some((choice) => choice.needsQuantity) ? (
            <label>
              Current live count
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={counts[batch.batchId] ?? ""}
                onChange={(event) => setCounts((current) => ({ ...current, [batch.batchId]: event.target.value }))}
                placeholder={batch.currentQuantity?.toString() || batch.viableSeedlings?.toString() || "0"}
              />
            </label>
          ) : null}
          {locationObjects.length ? (
            <label>
              Shelf or room position
              <select
                value={locations[batch.batchId] ?? batch.locationObjectId ?? ""}
                onChange={(event) => setLocations((current) => ({ ...current, [batch.batchId]: event.target.value }))}
              >
                <option value="">Leave location unchanged</option>
                {locationObjects.map((object) => <option key={object.objectId} value={object.objectId}>{object.label}</option>)}
              </select>
            </label>
          ) : null}
          <label>
            Outdoor destination
            <select
              value={batchDestinations[batch.batchId] ?? batch.destinationObjectId ?? ""}
              onChange={(event) => setBatchDestinations((current) => ({ ...current, [batch.batchId]: event.target.value }))}
            >
              <option value="">Not assigned yet</option>
              {(state?.destinations ?? []).map((destination) => (
                <option key={destination.objectId} value={destination.objectId}>{destination.zoneLabel ? `${destination.zoneLabel} · ` : ""}{destination.label}</option>
              ))}
            </select>
          </label>
          <div className={styles.actionButtons}>
            {choices.map((choice) => (
              <button
                type="button"
                key={choice.key}
                disabled={savingBatchId === batch.batchId}
                onClick={() => void recordAction(batch, choice.key, choice.needsQuantity)}
              >
                {choice.label}
              </button>
            ))}
            {locationObjects.length && locations[batch.batchId] && locations[batch.batchId] !== batch.locationObjectId ? (
              <button type="button" disabled={savingBatchId === batch.batchId} onClick={() => void recordAction(batch, "moved", false)}>
                Move batch
              </button>
            ) : null}
            {(batchDestinations[batch.batchId] || batch.destinationObjectId) ? (
              <button type="button" disabled={savingBatchId === batch.batchId} onClick={() => void assignDestination(batch)}>
                Save destination
              </button>
            ) : null}
          </div>
        </div>
      </article>
    );
  }

  function locationSection(object: GrowRoomObject) {
    const batches = batchesByLocation.get(object.objectId) ?? [];
    return (
      <section className={styles.shelf} key={object.objectId}>
        <div className={styles.shelfHeading}><strong>{object.label}</strong><small>{batches.length} {batches.length === 1 ? "batch" : "batches"}</small></div>
        {batches.length ? batches.map(batchCard) : <div className={styles.empty}>No verified living batch is placed here yet.</div>}
      </section>
    );
  }

  const standaloneLocations = locationObjects.filter((object) => !childObjectIds.has(object.objectId));

  return (
    <main className={styles.shell}>
      <section className={styles.room}>
        <header className={styles.topbar}>
          <Link href="/" className={styles.brand}><small>Atlas</small><strong>Elm Farm</strong></Link>
          <Link href="/" className={styles.back}>← Today</Link>
        </header>

        <section className={styles.hero}>
          <div>
            <small>Digital room</small>
            <h1>{state?.zone?.label || "Grow Room"}</h1>
            <p>Preserve the green Trail of the plants that are actually alive.</p>
          </div>
          <div className={styles.metrics}>
            <span><strong>{state?.batches.length ?? 0}</strong> live batches</span>
            <span><strong>{totalActionCount}</strong> action steps</span>
            <span><strong>{batchesByLocation.get("unplaced")?.length ?? 0}</strong> unplaced</span>
          </div>
        </section>

        <p className={styles.careRule}>Ordinary watering happens during the room visit. Atlas does not ask Anna to click or log it.</p>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {notice ? <div className={intakeStyles.notice} role="status">{notice}</div> : null}
        {loading ? <div className={styles.empty}>Opening the Grow Room…</div> : null}

        {!loading && state ? (
          <>
            <section className={`${styles.section} ${intakeStyles.intakeSection}`}>
              <div className={styles.sectionHeading}>
                <div><small>Establish real truth</small><h2>Room intake</h2></div>
                <span>{looseObjects.length}</span>
              </div>

              <details className={intakeStyles.drawer}>
                <summary><strong>Set up racks and shelves</strong><span>Name only what physically exists.</span></summary>
                <form className={intakeStyles.form} onSubmit={createStructure}>
                  <label>
                    Physical structure
                    <select value={structureKind} onChange={(event) => setStructureKind(event.target.value as StructureKind)}>
                      <option value="rack">Rack</option>
                      <option value="shelf">Shelf</option>
                      <option value="hardening_area">Hardening area</option>
                    </select>
                  </label>
                  <label>
                    Label
                    <input value={structureLabel} onChange={(event) => setStructureLabel(event.target.value)} placeholder={structureKind === "shelf" ? "West Rack · Shelf 2" : "West Rack"} />
                  </label>
                  {structureKind === "shelf" ? (
                    <label>
                      Parent rack or room section
                      <select value={structureParent} onChange={(event) => setStructureParent(event.target.value)}>
                        <option value="">Choose parent</option>
                        {structuralObjects.filter((object) => object.objectMode === "rack" || object.objectMode === "seed_room" || object.objectType === "seed_room").map((object) => (
                          <option key={object.objectId} value={object.objectId}>{object.label}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <button type="submit" disabled={savingSetup}>{savingSetup ? "Saving…" : "Add physical structure"}</button>
                </form>
              </details>

              <details className={intakeStyles.drawer} ref={intakeDetailsRef} open={!state.batches.length}>
                <summary><strong>Inventory a living batch</strong><span>One tray group or container group at a time.</span></summary>
                <form className={intakeStyles.form} onSubmit={submitIntake}>
                  {looseObjects.length ? (
                    <label className={intakeStyles.fullRow}>
                      Existing Grow Room record
                      <select value={intake.sourceObjectId} onChange={(event) => chooseExistingRecord(event.target.value)}>
                        <option value="">This is a new inventory record</option>
                        {looseObjects.map((object) => <option key={object.objectId} value={object.objectId}>{object.label}</option>)}
                      </select>
                    </label>
                  ) : null}
                  <label className={intakeStyles.fullRow}>
                    Known crop profile
                    <select value={intake.cropProfileId} onChange={(event) => chooseCropProfile(event.target.value)}>
                      <option value="">Not found or not certain</option>
                      {state.cropProfiles.map((profile) => <option key={profile.cropProfileId} value={profile.cropProfileId}>{cropProfileLabel(profile)}</option>)}
                    </select>
                  </label>
                  <label>
                    Crop
                    <input required value={intake.cropLabel} onChange={(event) => setIntake((current) => ({ ...current, cropLabel: event.target.value }))} placeholder="Snapdragon" />
                  </label>
                  <label>
                    Variety, when known
                    <input value={intake.variety} onChange={(event) => setIntake((current) => ({ ...current, variety: event.target.value }))} placeholder="Potomac White" />
                  </label>
                  <label>
                    Batch label
                    <input required value={intake.batchLabel} onChange={(event) => setIntake((current) => ({ ...current, batchLabel: event.target.value }))} placeholder="White snaps · tray group 1" />
                  </label>
                  <label>
                    Container
                    <input required value={intake.containerKind} onChange={(event) => setIntake((current) => ({ ...current, containerKind: event.target.value }))} placeholder="72-cell tray" />
                  </label>
                  <label>
                    Trays or containers
                    <input required type="number" min="1" step="1" value={intake.trayCount} onChange={(event) => setIntake((current) => ({ ...current, trayCount: event.target.value }))} />
                  </label>
                  <label>
                    Approximate live plants
                    <input type="number" min="0" step="1" value={intake.liveQuantity} onChange={(event) => setIntake((current) => ({ ...current, liveQuantity: event.target.value }))} placeholder="Unknown is allowed" />
                  </label>
                  <label>
                    Current condition
                    <select value={intake.condition} onChange={(event) => setIntake((current) => ({ ...current, condition: event.target.value }))}>
                      <option value="germination_pending|">Still germinating</option>
                      <option value="seedling_care|">Healthy and growing</option>
                      <option value="seedling_care|thin_or_separate">Needs thinning or separation</option>
                      <option value="pot_up_needed|pot_up">Needs pot-up</option>
                      <option value="seedling_care|begin_hardening">Ready to begin hardening</option>
                      <option value="hardening|">Currently hardening</option>
                      <option value="transplant_ready|transplant">Ready to transplant</option>
                      <option value="failed|replacement_decision">Failed or missing</option>
                    </select>
                  </label>
                  <label>
                    Room position
                    <select value={intake.locationObjectId} onChange={(event) => setIntake((current) => ({ ...current, locationObjectId: event.target.value }))}>
                      <option value="">Not placed yet</option>
                      {locationObjects.map((object) => <option key={object.objectId} value={object.objectId}>{object.label}</option>)}
                    </select>
                  </label>
                  <label>
                    Sown date, when known
                    <input type="date" value={intake.sownDate} onChange={(event) => setIntake((current) => ({ ...current, sownDate: event.target.value }))} />
                  </label>
                  <label>
                    Seeds started, when known
                    <input type="number" min="1" step="1" value={intake.seedsSown} onChange={(event) => setIntake((current) => ({ ...current, seedsSown: event.target.value }))} />
                  </label>
                  <label className={intakeStyles.fullRow}>
                    Intended outdoor destination
                    <select value={intake.destinationObjectId} onChange={(event) => setIntake((current) => ({ ...current, destinationObjectId: event.target.value }))}>
                      <option value="">Not decided yet</option>
                      {state.destinations.map((destination) => (
                        <option key={destination.objectId} value={destination.objectId}>{destination.zoneLabel ? `${destination.zoneLabel} · ` : ""}{destination.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className={intakeStyles.fullRow}>
                    Useful note
                    <textarea value={intake.note} onChange={(event) => setIntake((current) => ({ ...current, note: event.target.value }))} placeholder="Only a fact Anna will need later." />
                  </label>
                  <button type="submit" disabled={savingIntake}>{savingIntake ? "Saving verified batch…" : "Add verified living batch"}</button>
                  <p className={intakeStyles.formRule}>Unknown dates and seed counts stay unknown. Watering is not part of this form.</p>
                </form>
              </details>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div><small>Do while you are here</small><h2>Room actions</h2></div>
                <span>{totalActionCount}</span>
              </div>
              {batchActionCount ? (
                <div className={intakeStyles.batchActionList}>
                  {state.batches.filter((batch) => batch.actionRequired).map((batch) => (
                    <a href={`#batch-${batch.batchId}`} key={batch.batchId}>
                      <strong>{growRoomActionLabel(batch.actionKey)}</strong>
                      <span>{batch.cropLabel}{batch.variety ? ` · ${batch.variety}` : ""}</span>
                    </a>
                  ))}
                </div>
              ) : null}
              {state.actions.length ? (
                <div className={styles.actionList}>
                  {state.actions.map((action) => (
                    <Link href={`/task-focus/${encodeURIComponent(action.taskId)}?returnTo=${encodeURIComponent("/grow-room")}`} key={action.taskId}>
                      <span>{action.dueDate ? prettyDate(action.dueDate) : "Open"}</span>
                      <strong>{action.title}</strong>
                      <small>{action.batchLabel || action.zoneLabel || "Grow Room"}</small>
                    </Link>
                  ))}
                </div>
              ) : null}
              {!totalActionCount ? <div className={styles.empty}>No separate Grow Room action is currently due.</div> : null}
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHeading}>
                <div><small>Physical room</small><h2>Shelves and live batches</h2></div>
                <span>{locationObjects.length}</span>
              </div>

              {racks.map((rack) => {
                const childIds = childrenByParent.get(rack.objectId) ?? [];
                const children = childIds.map((id) => structuralObjects.find((object) => object.objectId === id)).filter((object): object is GrowRoomObject => Boolean(object));
                return (
                  <section className={intakeStyles.rack} key={rack.objectId}>
                    <div className={intakeStyles.rackHeading}><strong>{rack.label}</strong><span>{children.length} {children.length === 1 ? "shelf" : "shelves"}</span></div>
                    {children.length ? children.map(locationSection) : <div className={styles.empty}>This rack exists, but its shelves have not been named yet.</div>}
                  </section>
                );
              })}

              {standaloneLocations.map(locationSection)}

              {(batchesByLocation.get("unplaced") ?? []).length ? (
                <section className={styles.shelf}>
                  <div className={styles.shelfHeading}><strong>Unplaced living batches</strong><small>Place these during the room walkthrough</small></div>
                  {(batchesByLocation.get("unplaced") ?? []).map(batchCard)}
                </section>
              ) : null}

              {!state.batches.length ? (
                <div className={styles.truthEmpty}>
                  <strong>No verified tray batches are entered yet.</strong>
                  <p>Use Room intake during the physical walkthrough. Planned sowings still do not count as living plants.</p>
                </div>
              ) : null}
            </section>

            {looseObjects.length ? (
              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <div><small>Reconcile during intake</small><h2>Existing Grow Room records</h2></div>
                  <span>{looseObjects.length}</span>
                </div>
                <div className={styles.knownGrid}>
                  {looseObjects.map((object) => (
                    <article key={object.objectId}>
                      <strong>{object.label}</strong>
                      <span>{textMeta(object, "container_kind") || object.objectType.replaceAll("_", " ")}</span>
                      <button type="button" className={intakeStyles.useRecordButton} onClick={() => openIntakeFor(object)}>Use in intake</button>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}
