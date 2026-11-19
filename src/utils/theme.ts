export type ColorSchemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'color-scheme';

export function getStoredColorScheme(): ColorSchemePreference {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === 'light' || val === 'dark') return val;
  } catch {
    // Ignore storage denial
  }
  return 'system';
}

export function getSystemDarkMatch(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveEffectiveTheme(pref: ColorSchemePreference, systemDark: boolean): 'light' | 'dark' {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

export function applyColorSchemePreference(pref: ColorSchemePreference): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) {
    meta.content = pref === 'system' ? 'light dark' : pref;
  }
  try {
    if (pref === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, pref);
    }
  } catch {
    // Ignore storage denial
  }
}
