import type { MetadataRoute } from "next";
import { appConfig } from "@/lib/config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: appConfig.name,
    short_name: appConfig.name,
    description: appConfig.tagline,
    start_url: "/groups",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: appConfig.themeColor,
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
