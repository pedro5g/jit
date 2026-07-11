import { clsx } from "clsx";
import styles from "./jit-ghost.module.css";

/**
 * Server-rendered static mascot (design system §7, animation guide layer A+B).
 * Interactive state machine and pointer tracking land in the motion phase.
 */
export function JitGhostStatic({
  size = 160,
  float = true,
  glow = true,
  className,
  alt = "",
}: {
  size?: number;
  float?: boolean;
  glow?: boolean;
  className?: string;
  alt?: string;
}) {
  return (
    <div
      aria-hidden={alt === ""}
      className={clsx(styles.ghost, float && styles.float, glow && styles.glow, className)}
      style={{ width: size, height: size }}
    >
      {/* biome-ignore lint/performance/noImgElement: static brand SVG, no optimization pass wanted */}
      <img src="/brand/jit-ghost.svg" alt={alt} width={size} height={size} draggable={false} />
    </div>
  );
}
