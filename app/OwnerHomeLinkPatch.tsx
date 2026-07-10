"use client";

import { useEffect } from "react";

export default function OwnerHomeLinkPatch() {
  useEffect(() => {
    function addPrivateLinks() {
      if (window.location.pathname !== "/") return;
      const footer = document.querySelector(".atlas-home-footer-row");
      if (!footer) return;

      if (!footer.querySelector(".atlas-owner-footer-link")) {
        const ownerLink = document.createElement("a");
        ownerLink.href = "/owner";
        ownerLink.className = "atlas-home-closeout-footer-link atlas-owner-footer-link";
        ownerLink.setAttribute("aria-label", "Open owner task overview");
        ownerLink.innerHTML = "<span>Owner</span><em>Listings · finish</em>";
        footer.insertBefore(ownerLink, footer.firstChild);
      }

      if (!footer.querySelector(".atlas-marshall-footer-link")) {
        const marshallLink = document.createElement("a");
        marshallLink.href = "/marshall";
        marshallLink.className = "atlas-home-closeout-footer-link atlas-owner-footer-link atlas-marshall-footer-link";
        marshallLink.setAttribute("aria-label", "Open Marshall task overview");
        marshallLink.innerHTML = "<span>Marshall</span><em>Jul 19–25</em>";
        const ownerLink = footer.querySelector(".atlas-owner-footer-link");
        if (ownerLink?.nextSibling) footer.insertBefore(marshallLink, ownerLink.nextSibling);
        else footer.appendChild(marshallLink);
      }
    }

    addPrivateLinks();
    const observer = new MutationObserver(addPrivateLinks);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
