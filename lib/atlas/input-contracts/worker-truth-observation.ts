import type { AtlasInputContract } from "@/lib/atlas/input-contract";
import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function truthy(value: unknown) {
  return value === true || value === "true" || value === "yes" || value === "1" || value === 1;
}

export function isCanonicalWorkerTruthObservationTask(task: AtlasTaskCard) {
  const metadata = task.metadata ?? {};
  return task.task_type === "truth_acquisition_observation"
    && truthy(metadata.structured_result_required)
    && text(metadata.worker_truth_observation_contract) === "record_worker_truth_observation_v1"
    && text(metadata.worker_observation_adapter) === "crop_observation_v1"
    && text(metadata.worker_observation_key) === "stand_count"
    && Boolean(text(metadata.truth_acquisition_instance_id))
    && Boolean(text(metadata.crop_cycle_id));
}

export function createCanonicalWorkerTruthObservationContract(task: AtlasTaskCard): AtlasInputContract {
  if (!isCanonicalWorkerTruthObservationTask(task)) {
    throw new Error("Task does not carry a supported canonical worker observation contract.");
  }

  const metadata = task.metadata ?? {};
  const subject = text(metadata.display_subject)
    || text(metadata.variety)
    || text(metadata.crop_label)
    || "Crop";
  const location = text(metadata.display_location)
    || text(metadata.display_detail)
    || text(task.zone_label)
    || "Elm Farm";
  const cropCycleId = text(metadata.crop_cycle_id);

  return {
    id: `task.${task.task_id}.crop-observation.stand-count.v1`,
    kind: "count",
    title: subject,
    detail: location,
    source: {
      domain: "crop-cycle",
      jurisdiction: `farm:${task.farm_key}`,
      objectRef: `crop-cycle:${cropCycleId}`,
      claimRef: task.task_id,
    },
    fields: [
      {
        primitive: "quantity",
        id: "livingPlants",
        label: "Living plants",
        unit: "plants",
        displayUnit: "plants",
        displayUnitSingular: "plant",
        step: 1,
        minimum: 0,
        startUnset: true,
        wholeNumber: true,
      },
    ],
    rules: [
      {
        kind: "required_field",
        fieldId: "livingPlants",
        message: "Record the living plant count, including 0.",
      },
    ],
    resultEventType: "atlas.crop_cycle.living_plant_count.result.canonical.v1",
    persistence: "canonical",
    sourceContext: {
      taskId: task.task_id,
      cropCycleId,
      truthAcquisitionInstanceId: text(metadata.truth_acquisition_instance_id),
      observationKey: "stand_count",
      adapter: "crop_observation_v1",
      subject,
      location,
    },
  };
}
