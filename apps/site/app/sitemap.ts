import type { MetadataRoute } from "next";
import { benchmarkSuites } from "@/lib/benchmarks/data";
import { siteUrl } from "@/lib/site";
import { source } from "@/lib/source";

export default function sitemap(): MetadataRoute.Sitemap {
  const docs = source.getPages().map((page) => ({
    url: `${siteUrl}${page.url}`,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const benchmarks = [
    { url: `${siteUrl}/benchmarks`, changeFrequency: "weekly" as const, priority: 0.8 },
    { url: `${siteUrl}/benchmarks/methodology`, changeFrequency: "monthly" as const, priority: 0.6 },
    ...benchmarkSuites.map((suite) => ({
      url: `${siteUrl}/benchmarks/${suite.id}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];

  return [
    {
      url: siteUrl,
      changeFrequency: "weekly",
      priority: 1,
    },
    { url: `${siteUrl}/playground`, changeFrequency: "monthly", priority: 0.7 },
    ...benchmarks,
    ...docs,
  ];
}
