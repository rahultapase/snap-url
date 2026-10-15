import { icon } from './icons';

export type ThemeMode = 'system' | 'light' | 'dark';

const KEY = 'snip:theme';
const ORDER: readonly ThemeMode[] = ['system', 'light', 'dark'];
const LABELS: Record<ThemeMode, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const SWITCH_MS = 260;

const root = document.documentElement;
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function isMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(KEY);
    return isMode(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function storeTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

let switchTimer = 0;

function applyTheme(mode: ThemeMode, animate: boolean): void {
  window.clearTimeout(switchTimer);
  if (animate && !reduceMotion.matches) {
    root.classList.add('theme-switching');
    switchTimer = window.setTimeout(() => root.classList.remove('theme-switching'), SWITCH_MS);
  } else {
    root.classList.remove('theme-switching');
  }
  root.dataset.theme = mode;
}

function accessibleName(mode: ThemeMode): string {
  if (mode !== 'system') return `Theme: ${mode}`;
  return `Theme: system (${prefersDark.matches ? 'dark' : 'light'})`;
}

export function initThemeToggle(button: HTMLButtonElement, announce: (message: string) => void): void {
  let mode = readTheme();

  const icons = document.createElement('span');
  icons.className = 'theme-icons';
  icons.append(
    icon('system', 'icon icon-theme icon-theme-system'),
    icon('sun', 'icon icon-theme icon-theme-light'),
    icon('moon', 'icon icon-theme icon-theme-dark'),
  );
  const label = document.createElement('span');
  label.className = 'theme-label';
  label.setAttribute('aria-hidden', 'true');
  button.replaceChildren(icons, label);

  const render = (): void => {
    button.dataset.mode = mode;
    label.textContent = LABELS[mode];
    button.setAttribute('aria-label', accessibleName(mode));
  };

  applyTheme(mode, false);
  render();

  button.addEventListener('click', () => {
    mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    storeTheme(mode);
    applyTheme(mode, true);
    render();
    announce(accessibleName(mode));
  });

  prefersDark.addEventListener('change', () => {
    if (mode !== 'system') return;
    applyTheme(mode, true);
    render();
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== KEY) return;
    mode = readTheme();
    applyTheme(mode, true);
    render();
  });
}
