import Link from "next/link";
import { JitGhostStatic } from "@/components/brand/jit-ghost-static";
import { ButtonLink } from "@/components/ui/button-link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
      <JitGhostStatic size={140} />
      <p className="mt-8 font-pixel text-5xl text-gold-200">404</p>
      <h1 className="mt-3 text-xl font-semibold text-fg-strong">Nothing compiled at this path</h1>
      <p className="mt-2 max-w-[420px] text-sm leading-relaxed text-fg-muted">
        The schema for this URL has no matching page. The ghost checked the cache twice.
      </p>
      <div className="mt-8 flex gap-3">
        <ButtonLink href="/">Back to the landing</ButtonLink>
        <ButtonLink href="/docs" variant="secondary">
          Open the docs
        </ButtonLink>
      </div>
      <Link href="/" className="sr-only">
        Home
      </Link>
    </main>
  );
}
