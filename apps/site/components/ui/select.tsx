"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

interface SelectProps {
  readonly id?: string;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly options: readonly SelectOption[];
  readonly onValueChange: (value: string) => void;
  readonly ariaLabel?: string;
  readonly className?: string;
}

export function Select({ id, value, defaultValue, options, onValueChange, ariaLabel, className = "" }: SelectProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const rootRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [internalValue, setInternalValue] = useState(defaultValue ?? options[0]?.value ?? "");
  const [open, setOpen] = useState(false);
  const selectedValue = value ?? internalValue;
  const selected = options.find((option) => option.value === selectedValue) ?? options[0];

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const select = (nextValue: string) => {
    if (value === undefined) setInternalValue(nextValue);
    onValueChange(nextValue);
    setOpen(false);
  };

  const focusOption = (offset: number) => {
    const selectedIndex = Math.max(
      0,
      options.findIndex((option) => option.value === selectedValue)
    );
    const nextIndex = (selectedIndex + offset + options.length) % options.length;

    setOpen(true);
    requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus());
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        id={controlId}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={`${controlId}-options`}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            focusOption(event.key === "ArrowDown" ? 1 : -1);
          }
        }}
        className="flex h-9 w-full items-center gap-2 border border-line bg-night-1000 px-2.5 text-left font-mono text-xs text-ghost-100 outline-none transition-colors hover:border-line-gold focus-visible:border-gold-300 focus-visible:ring-2 focus-visible:ring-gold-300/15"
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? selectedValue}</span>
        <ChevronDown
          aria-hidden
          className={`size-3.5 shrink-0 text-fg-subtle transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div
          id={`${controlId}-options`}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute top-[calc(100%+0.375rem)] right-0 left-0 z-60 max-h-64 overflow-y-auto border border-line bg-night-850 p-1 shadow-2xl"
        >
          {options.map((option, index) => {
            const active = option.value === selectedValue;

            return (
              <button
                key={option.value}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => select(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const next = (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
                    optionRefs.current[next]?.focus();
                  }
                }}
                className={
                  active
                    ? "flex w-full items-start gap-2 bg-surface-900 px-2.5 py-2 text-left text-gold-200"
                    : "flex w-full items-start gap-2 px-2.5 py-2 text-left text-ghost-200 hover:bg-night-800"
                }
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-[11px] leading-snug text-fg-subtle">{option.description}</span>
                  )}
                </span>
                <Check aria-hidden className={`mt-0.5 size-3.5 shrink-0 ${active ? "opacity-100" : "opacity-0"}`} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
