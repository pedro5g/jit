"use client";

/**
 * The chrome both panels share, so Run and Generate look like two views of one
 * workspace rather than two pages that happen to sit side by side.
 */

/** Sticky action row: the controls that change what the panel produces. */
export function PanelToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-subtle bg-night-950 px-3 py-2 sm:px-4">
      {children}
    </div>
  );
}

/** Scrollable content that fills the panel, so the output can grow with it. */
export function PanelBody({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:p-4">{children}</div>;
}

export function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`-mb-px border-b-2 px-2 pb-1.5 font-mono text-[11px] transition-colors ${
        active ? "border-gold-200 text-gold-200" : "border-transparent text-fg-subtle hover:text-ghost-100"
      }`}
    >
      {label}
    </button>
  );
}

export function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-wide text-fg-subtle">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="rounded-control border border-line-subtle bg-night-1000/60 px-2.5 py-2 font-mono text-[12px] text-fg outline-none transition-colors focus:border-line-gold"
      />
      {hint && <span className="text-[10px] text-fg-subtle">{hint}</span>}
    </label>
  );
}
