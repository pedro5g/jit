import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
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
          title: <JitLogo />,
        }}
        githubUrl={githubUrl}
      >
        {children}
      </DocsLayout>
      <GhostDocGuide />
    </RootProvider>
  );
}
