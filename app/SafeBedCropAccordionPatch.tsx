"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function normalizedCropName(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cropName(crop: HTMLElement) {
  const title = crop.querySelector<HTMLElement>(":scope > .atlas-crop-cycle-title");
  const namedCycle = title?.querySelector<HTMLElement>(":scope > span")?.textContent;
  return normalizedCropName(namedCycle || title?.textContent);
}

function prepareSheet(sheet: HTMLElement) {
  if (sheet.dataset.cropAccordionReady === "true") return;

  const initialCrops = Array.from(
    sheet.querySelectorAll<HTMLElement>(":scope > .atlas-crop-cycle-sheet"),
  );
  if (!initialCrops.length) return;

  const cycleNames = initialCrops
    .filter((crop) => crop.classList.contains("current-crop-cycle"))
    .map(cropName)
    .filter(Boolean);

  initialCrops.forEach((crop) => {
    if (crop.classList.contains("current-crop-cycle")) return;
    const legacyName = cropName(crop);
    if (!legacyName) return;
    const replaced = cycleNames.some(
      (cycleName) => cycleName === legacyName || cycleName.endsWith(` ${legacyName}`),
    );
    if (replaced) crop.hidden = true;
  });

  const crops = initialCrops.filter((crop) => !crop.hidden);
  if (!crops.length) return;

  sheet.dataset.cropAccordionReady = "true";

  const label = document.createElement("div");
  label.className = "atlas-bed-crop-list-label";
  label.textContent = `Crops in this bed · ${crops.length}`;
  crops[0].before(label);

  crops.forEach((crop) => {
    crop.classList.add("atlas-bed-crop-list-item");
    crop.classList.remove("is-expanded");

    const title = crop.querySelector<HTMLElement>(":scope > .atlas-crop-cycle-title");
    if (!title) return;
    title.classList.add("atlas-bed-crop-list-trigger");
    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");
    title.setAttribute("aria-expanded", "false");
    title.setAttribute("aria-label", `Open ${cropName(crop) || "crop"} details`);
  });
}

function prepareOpenBeds() {
  document
    .querySelectorAll<HTMLElement>(".atlas-bed-row-card.open .atlas-bed-inspection-sheet")
    .forEach(prepareSheet);
}

function toggleCrop(trigger: HTMLElement) {
  const crop = trigger.closest<HTMLElement>(".atlas-bed-crop-list-item");
  const sheet = trigger.closest<HTMLElement>(".atlas-bed-inspection-sheet");
  if (!crop || !sheet) return;

  const opening = !crop.classList.contains("is-expanded");
  sheet.querySelectorAll<HTMLElement>(":scope > .atlas-bed-crop-list-item").forEach((item) => {
    item.classList.remove("is-expanded");
    item
      .querySelector<HTMLElement>(":scope > .atlas-bed-crop-list-trigger")
      ?.setAttribute("aria-expanded", "false");
  });

  if (opening) {
    crop.classList.add("is-expanded");
    trigger.setAttribute("aria-expanded", "true");
  }
}

export default function SafeBedCropAccordionPatch() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/zones/")) return;

    window.setTimeout(prepareOpenBeds, 0);

    function click(event: MouseEvent) {
      const target = event.target as Element | null;
      const cropTrigger = target?.closest<HTMLElement>(".atlas-bed-crop-list-trigger");
      if (cropTrigger) {
        toggleCrop(cropTrigger);
        return;
      }

      if (target?.closest(".atlas-bed-row-button")) {
        window.setTimeout(prepareOpenBeds, 0);
      }
    }

    function keydown(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") return;
      const trigger = (event.target as Element | null)?.closest<HTMLElement>(
        ".atlas-bed-crop-list-trigger",
      );
      if (!trigger) return;
      event.preventDefault();
      toggleCrop(trigger);
    }

    document.addEventListener("click", click);
    document.addEventListener("keydown", keydown);

    return () => {
      document.removeEventListener("click", click);
      document.removeEventListener("keydown", keydown);
    };
  }, [pathname]);

  return null;
}
