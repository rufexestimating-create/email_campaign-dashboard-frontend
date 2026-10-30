"use client";

import { useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY as STORAGE_KEY } from "./theme-script";

export type Theme = "light" | "dark";

const listeners = new Set<() => void>();

const getTheme = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function storedChoice(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function apply(theme: Theme) {
  const html = document.documentElement;
  html.classList.add("theme-transition");
  html.dataset.theme = theme;
  window.setTimeout(() => html.classList.remove("theme-transition"), 300);
  listeners.forEach((l) => l());
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the theme still applies for this visit
  }
  apply(theme);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Until the user picks a theme, follow the operating system setting live
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (storedChoice() !== "light" && storedChoice() !== "dark") apply(media.matches ? "dark" : "light");
  };
  media.addEventListener("change", onSystemChange);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", onSystemChange);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, () => "light");
}
