import pkg from "@jit/compiler/package.json";
import Link from "next/link";
import { GhostToggle } from "@/components/brand/ghost-toggle";
import { JitLogo } from "@/components/brand/jit-logo";
import { ButtonLink } from "@/components/ui/button-link";
import { githubUrl } from "@/lib/site";
import { GithubIcon } from "./github-icon";
import { MobileNav } from "./mobile-nav";
import { NavLinks, navLinks } from "./nav-links";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-line-subtle bg-night-900/85 backdrop-blur">
      <div className="relative mx-auto flex h-18 w-full max-w-300 items-center gap-5 px-5 sm:px-8">
        <Link href="/" aria-label="jit — home" className="flex shrink-0 items-center gap-2.5">
          <JitLogo />
          <span className="hidden rounded-pixel border border-line-gold/40 bg-gold-200/10 px-1.5 py-0.5 font-pixel-badge text-[9px] uppercase tracking-wider text-gold-200 sm:inline-flex">
            v{pkg.version}
          </span>
        </Link>
        <nav aria-label="Main" className="hidden md:block">
          <NavLinks />
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <GhostToggle className="hidden sm:inline-flex" />
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="jit on GitHub"
            className="inline-flex size-9 items-center justify-center rounded-control border border-line-subtle text-fg-muted transition-colors hover:border-line hover:text-ghost-100"
          >
            <GithubIcon className="size-4.5" />
          </a>
          <ButtonLink href="/docs/quick-start" className="hidden sm:inline-flex">
            Get started
          </ButtonLink>
          <MobileNav links={navLinks} />
        </div>
      </div>
    </header>
  );
}
