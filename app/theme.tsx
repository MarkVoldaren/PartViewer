import React, { useEffect, useState } from "react";

type Theme = "light" | "dark";
const key = "part-viewer-theme";
const preference = window.matchMedia("(prefers-color-scheme: dark)");
function savedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(key);
    return value === "light" || value === "dark" ? value : null;
  } catch { return null; }
}
function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#101a24" : "#f3f6fa");
}
apply(savedTheme() || (preference.matches ? "dark" : "light"));

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme as Theme);
  useEffect(() => {
    const sync = () => {
      const next = savedTheme() || (preference.matches ? "dark" : "light");
      apply(next);
      setTheme(next);
    };
    preference.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    return () => {
      preference.removeEventListener("change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return <button type="button" className="theme-toggle" aria-label="Dark mode" aria-pressed={theme === "dark"} title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} onClick={() => {
    const next = theme === "dark" ? "light" : "dark";
    apply(next);
    setTheme(next);
    try { localStorage.setItem(key, next); } catch { /* Theme remains usable without storage. */ }
  }}><span aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span><span>{theme === "dark" ? "Dark" : "Light"}</span></button>;
}
