"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export function MobileNav({ links }: { links: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-9 items-center justify-center rounded-control border border-line-subtle text-fg-muted hover:text-ghost-100"
      >
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
      </button>
      {open && (
        <nav
          aria-label="Mobile"
          className="absolute inset-x-0 top-full border-b border-line-subtle bg-night-950/95 px-5 py-4 backdrop-blur"
        >
          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-control px-3 py-2.5 text-sm text-fg-muted hover:bg-night-800 hover:text-ghost-100"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
