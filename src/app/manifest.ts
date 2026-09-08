import type { MetadataRoute } from "next";

/**
 * What a home screen needs to install this.
 *
 * The colours are the Crisp White ones, and they are light on purpose even
 * though the app has a dark theme: this is the splash and the browser chrome,
 * shown before any of the app's own code has run and read the user's choice.
 * Guessing dark and being wrong means a black flash into a white room.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Prime AI",
    short_name: "Prime AI",
    description:
      "A communication coach you talk to. Bring a real situation, get specific advice, then rehearse it out loud.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Portrait, because the room is built to stack on a phone and a rehearsal
    // is something you prop the phone up for.
    orientation: "portrait",
    lang: "en-IN",
    dir: "ltr",
    categories: ["education", "productivity"],
    background_color: "#f7f8fa",
    theme_color: "#f7f8fa",
    icons: [
      { src: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { src: "/icons/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Drawn edge to edge with the mark inside the safe zone, because Android
      // crops these to whatever shape the launcher uses.
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
