"use client";

import { useEffect } from "react";

export default function OwnerHomeLinkPatch() {
  useEffect(() => {
    function addPrivateLinks() {
      if (window.location.pathname !== "/") return;
      const footer = document.querySelector(".atlas-home-footer-row");
      if (!footer) return;

      footer.querySelectorAll(".atlas-owner-footer-link, .atlas-marshall-footer-link").forEach((node) => {
        if (!node.classList.contains("atlas-children-footer-link")) node.remove();
      });

      if (!footer.querySelector(".atlas-children-footer-link")) {
        const childrenLink = document.createElement("a");
        childrenLink.href = "/children";
        childrenLink.className = "atlas-home-closeout-footer-link atlas-children-footer-link";
        childrenLink.setAttribute("aria-label", "Open children chores overview");
        childrenLink.innerHTML = "<span>Kids</span><em>Trash · porches</em>";
        footer.insertBefore(childrenLink, footer.firstChild);
      }
    }

    addPrivateLinks();
    const observer = new MutationObserver(addPrivateLinks);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
