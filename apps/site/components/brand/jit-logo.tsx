import { clsx } from "clsx";

export function JitLogo({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      {/* biome-ignore lint/performance/noImgElement: static brand SVG */}
      <img src="/brand/jit-ghost.svg" alt="" aria-hidden width={30} height={30} draggable={false} />
      <span className="font-pixel text-xl leading-none text-ghost-100">
        jit
        <span aria-hidden className="terminal-cursor ml-0.5 text-gold-200">
          _
        </span>
      </span>
    </span>
  );
}
