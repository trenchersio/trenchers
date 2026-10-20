import type { MetadataRoute } from "next";

/** Lets people install trenchers.io on their phone's home screen (and get notifications from it). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trenchers",
    short_name: "Trenchers",
    description: "2,000 NFT AI agents on Robinhood Chain. Follow yours, get notified when it trades.",
    start_url: "/agents?source=app",
    scope: "/",
    display: "standalone",
    background_color: "#0B0D0C",
    theme_color: "#0B0D0C",
    icons: [
      { src: "/app/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/app/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/app/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "My Trencher", url: "/agents" },
      { name: "Arena", url: "/arena" },
      { name: "Market", url: "/market" },
    ],
  };
}
