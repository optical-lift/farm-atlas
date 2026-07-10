"use client";

import { useEffect } from "react";

export default function OwnerHomeLinkPatch() {
  useEffect(() => {
    function addOwnerLink() {
      if (window.location.pathname !== "/") return;
      const footer = document.querySelector(".atlas-home-footer-row");
      if (!footer || footer.querySelector(".atlas-owner-footer-link")) return;

      const link = document.createElement("a");
      link.href = "/owner";
      link.className = "atlas-home-closeout-footer-link atlas-owner-footer-link";
      link.setAttribute("aria-label", "Open owner task overview");
      link.innerHTML = "<span>Owner</span><em>Listings · venue finish</em>";
      footer.insertBefore(link, footer.firstChild);
    }

    addOwnerLink();
    const observer = new MutationObserver(addOwnerLink);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
