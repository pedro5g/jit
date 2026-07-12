import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { GhostToggle } from "@/components/brand/ghost-toggle";
import { JitLogo } from "@/components/brand/jit-logo";
import { GhostDocGuide } from "@/components/docs/ghost-doc-guide";
import { githubUrl } from "@/lib/site";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RootProvider theme={{ defaultTheme: "dark", forcedTheme: "dark" }}>
      <DocsLayout
        tree={source.pageTree}
        nav={{
          title: (
            <span className="flex items-center gap-2.5">
              <JitLogo />
              <GhostToggle className="size-7!" />
            </span>
          ),
        }}
        githubUrl={githubUrl}
      >
        {children}
      </DocsLayout>
      <GhostDocGuide />
    </RootProvider>
  );
}
