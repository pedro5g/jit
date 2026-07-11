import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";
import { source } from "@/lib/source";

export default function sitemap(): MetadataRoute.Sitemap {
  const docs = source.getPages().map((page) => ({
    url: `${siteUrl}${page.url}`,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [
    {
      url: siteUrl,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...docs,
  ];
}
