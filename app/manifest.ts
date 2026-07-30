import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Atlas · Feast Guild",
    short_name: "Atlas",
    description: "Living farm bullet journal and rhythm engine",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f7f4e9",
    theme_color: "#f7f4e9",
    categories: ["productivity", "business", "lifestyle"],
    icons: [
      {
        src: "/api/pwa/icon?size=192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/api/pwa/icon?size=512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/api/pwa/icon?size=512&maskable=1",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Today",
        short_name: "Today",
        description: "Open the current Day spread",
        url: "/day",
        icons: [{ src: "/api/pwa/icon?size=192", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Bell",
        short_name: "Bell",
        description: "Open farm changes and alerts",
        url: "/bell",
        icons: [{ src: "/api/pwa/icon?size=192", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
