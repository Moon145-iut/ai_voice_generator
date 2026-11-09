import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VoxStudio Voice Studio",
    short_name: "VoxStudio",
    description: "Self-hosted AI text-to-speech and voice cloning",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0c13",
    theme_color: "#0a0c13",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
