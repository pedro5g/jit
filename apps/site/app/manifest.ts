import type { MetadataRoute } from "next";
import { siteDescription, siteName, siteTagline } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${siteName} — ${siteTagline}`,
    short_name: siteName,
    description: siteDescription,
    start_url: "/",
    display: "standalone",
    background_color: "#151822",
    theme_color: "#151822",
    icons: [
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
