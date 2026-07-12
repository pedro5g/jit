import Link from "next/link";
import { JitLogo } from "@/components/brand/jit-logo";
import { ButtonLink } from "@/components/ui/button-link";
import { githubUrl } from "@/lib/site";
import { GithubIcon } from "./github-icon";
import { MobileNav } from "./mobile-nav";

const navLinks = [
  { href: "/#why-specialization", label: "Why jit" },
  { href: "/#operations", label: "Operations" },
  { href: "/benchmarks", label: "Benchmarks" },
  { href: "/playground", label: "Playground" },
  { href: "/docs", label: "Docs" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-line-subtle bg-night-900/85 backdrop-blur">
      <div className="relative mx-auto flex h-18 w-full max-w-300 items-center gap-6 px-5 sm:px-8">
        <Link href="/" aria-label="jit — home" className="shrink-0">
          <JitLogo />
        </Link>
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="rounded-control px-3 py-2 text-sm text-fg-muted transition-colors hover:text-ghost-100"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
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
