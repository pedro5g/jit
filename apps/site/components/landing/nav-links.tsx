"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const navLinks = [
  { href: "/#why-specialization", label: "Why jit" },
  { href: "/#operations", label: "Operations" },
  { href: "/benchmarks", label: "Benchmarks" },
  { href: "/playground", label: "Playground" },
  { href: "/lab", label: "Lab" },
  { href: "/docs", label: "Docs" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <ul className="flex items-center gap-1">
      {navLinks.map((link) => {
        const route = link.href.split("#")[0] || "/";
        const active = route !== "/" && (pathname === route || pathname.startsWith(`${route}/`));
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "group relative rounded-control px-3 py-2 text-sm transition-colors",
                active ? "text-gold-200" : "text-fg-muted hover:text-ghost-100"
              )}
            >
              {link.label}
              <span
                aria-hidden
                className={clsx(
                  "absolute inset-x-3 -bottom-0.5 h-0.5 origin-left rounded-pill bg-gold-200 transition-transform duration-200 ease-out",
                  active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100 group-hover:bg-ghost-500/60"
                )}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
