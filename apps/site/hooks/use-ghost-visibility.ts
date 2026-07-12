"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "jit:ghost-visible";
const EVENT = "jit:ghost-visibility";

/**
 * Shared mascot visibility (design system §11.3): persisted in localStorage,
 * synchronized live across every ghost on the page (and across tabs) so the
 * navbar toggle can bring a dismissed ghost back without a reload.
 */
export function useGhostVisibility(): [boolean, (visible: boolean) => void] {
  const [visible, setVisibleState] = useState(true);

  useEffect(() => {
    setVisibleState(localStorage.getItem(KEY) !== "0");
    const onChange = () => setVisibleState(localStorage.getItem(KEY) !== "0");
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setVisible = useCallback((next: boolean) => {
    localStorage.setItem(KEY, next ? "1" : "0");
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [visible, setVisible];
}
