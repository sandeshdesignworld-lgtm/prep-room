"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Light or dark, and light wins by default.
 *
 * Crisp White is the product. Someone whose laptop is set to dark should still
 * open Prime AI and get the app as it was designed, so the system preference is
 * deliberately not consulted anywhere: not here, and not in globals.css. Dark
 * exists, but only because someone asked for it.
 *
 * Stored per device rather than on the profile: which theme you want is a fact
 * about the screen you're looking at, not about you, and it has to be readable
 * before React runs so the page doesn't flash.
 */

export type Theme = "light" | "dark";

/** Old spelling kept deliberately: renaming a storage key discards what's in it. */
export const THEME_KEY = "preproom.theme.v1";
export const DEFAULT_THEME: Theme = "light";

/**
 * Runs before first paint, inlined into the document head. Small and total: any
 * failure (private mode, storage disabled) leaves the class off, which is
 * light, which is the default we want anyway.
 */
export const THEME_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  THEME_KEY
)})==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

function read(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** The server has no localStorage, and the default is what it would say anyway. */
function serverSnapshot(): Theme {
  return DEFAULT_THEME;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  // Browser chrome can't read CSS variables, so the meta tag is kept in step
  // by hand. These two mirror --page in globals.css.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#14161a" : "#f7f8fa");
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, read, serverSnapshot);

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode. The class below still applies for this visit.
    }
    applyTheme(next);
    for (const l of listeners) l();
  }, []);

  const toggle = useCallback(() => {
    setTheme(read() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggle };
}
