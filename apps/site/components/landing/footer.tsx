import Link from "next/link";
import { JitLogo } from "@/components/brand/jit-logo";
import { githubUrl, jsrUrl, npmUrl } from "@/lib/site";

const columns = [
  {
    title: "Documentation",
    links: [
      { href: "/docs", label: "Introduction", external: false },
      { href: "/docs/quick-start", label: "Quick start", external: false },
    ],
  },
  {
    title: "Project",
    links: [
      { href: githubUrl, label: "GitHub", external: true },
      { href: npmUrl, label: "npm", external: true },
      { href: jsrUrl, label: "JSR", external: true },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: `${githubUrl}/tree/main/docs`, label: "Feature guides", external: true },
      { href: `${githubUrl}/blob/main/docs/architecture.md`, label: "Architecture", external: true },
      { href: `${githubUrl}/blob/main/LICENSE`, label: "MIT license", external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line-subtle bg-night-950">
      <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <JitLogo />
          <p className="mt-4 max-w-[280px] text-sm leading-relaxed text-fg-subtle">
            The compiled data engine — schemas in, straight-line code out.
          </p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="font-pixel-badge text-[11px] uppercase tracking-[0.2em] text-fg-subtle">{column.title}</h2>
            <ul className="mt-4 flex flex-col gap-2.5">
              {column.links.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-fg-muted transition-colors hover:text-gold-200"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link href={link.href} className="text-sm text-fg-muted transition-colors hover:text-gold-200">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line-subtle">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-2 px-5 py-5 sm:px-8">
          <p className="font-mono text-xs text-fg-subtle">MIT © {new Date().getFullYear()} pedro5g</p>
          <p className="font-mono text-xs text-fg-subtle">compiled, cached, and specialized</p>
        </div>
      </div>
    </footer>
  );
}
