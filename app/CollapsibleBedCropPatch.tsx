"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

function prepareCropLists() {
  document.querySelectorAll<HTMLElement>(".atlas-bed-inspection-sheet").forEach((sheet) => {
    const crops = Array.from(sheet.querySelectorAll<HTMLElement>(":scope > .atlas-crop-cycle-sheet"));
    if (!crops.length) return;

    if (!sheet.querySelector(":scope > .atlas-bed-crop-list-label")) {
      const label = document.createElement("div");
      label.className = "atlas-bed-crop-list-label";
      label.textContent = `Crops in this bed · ${crops.length}`;
      crops[0].before(label);
    }

    crops.forEach((crop) => {
      if (crop.dataset.cropAccordionReady === "true") return;
      crop.dataset.cropAccordionReady = "true";
      crop.classList.add("atlas-bed-crop-list-item");
      crop.classList.remove("is-expanded");

      const title = crop.querySelector<HTMLElement>(":scope > .atlas-crop-cycle-title");
      if (!title) return;
      title.classList.add("atlas-bed-crop-list-trigger");
      title.setAttribute("role", "button");
      title.setAttribute("tabindex", "0");
      title.setAttribute("aria-expanded", "false");
      title.setAttribute("aria-label", `Open ${title.textContent?.trim() || "crop"} details`);
    });
  });
}

function toggleCrop(trigger: HTMLElement) {
  const crop = trigger.closest<HTMLElement>(".atlas-bed-crop-list-item");
  const sheet = trigger.closest<HTMLElement>(".atlas-bed-inspection-sheet");
  if (!crop || !sheet) return;

  const opening = !crop.classList.contains("is-expanded");
  sheet.querySelectorAll<HTMLElement>(":scope > .atlas-bed-crop-list-item").forEach((item) => {
    item.classList.remove("is-expanded");
    item.querySelector<HTMLElement>(":scope > .atlas-bed-crop-list-trigger")?.setAttribute("aria-expanded", "false");
  });

  if (opening) {
    crop.classList.add("is-expanded");
    trigger.setAttribute("aria-expanded", "true");
  }
}

export default function CollapsibleBedCropPatch() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname.startsWith("/zones")) return;

    prepareCropLists();
    const observer = new MutationObserver(prepareCropLists);
    observer.observe(document.body, { childList: true, subtree: true });

    function click(event: MouseEvent) {
      const trigger = (event.target as Element | null)?.closest<HTMLElement>(".atlas-bed-crop-list-trigger");
      if (trigger) toggleCrop(trigger);
    }

    function keydown(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") return;
      const trigger = (event.target as Element | null)?.closest<HTMLElement>(".atlas-bed-crop-list-trigger");
      if (!trigger) return;
      event.preventDefault();
      toggleCrop(trigger);
    }

    document.addEventListener("click", click);
    document.addEventListener("keydown", keydown);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", click);
      document.removeEventListener("keydown", keydown);
    };
  }, [pathname]);

  return null;
}
