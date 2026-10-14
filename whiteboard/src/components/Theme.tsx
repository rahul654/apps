import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyTheme, getTheme, type ThemeChoice } from '../lib/prefs';
import { IconMonitor, IconMoon, IconSun } from './Icons';

interface ThemeValue {
  choice: ThemeChoice;
  /** What is actually shown: the choice, or the system preference for "system". */
  resolved: 'light' | 'dark';
  cycle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemeChoice, string> = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };

function systemDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(getTheme);
  const [sysDark, setSysDark] = useState(systemDark);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSysDark(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  const cycle = useCallback(() => {
    setChoice((c) => {
      const next = NEXT[c];
      applyTheme(next);
      return next;
    });
  }, []);
  const value = useMemo<ThemeValue>(() => ({ choice, resolved: choice === 'system' ? (sysDark ? 'dark' : 'light') : choice, cycle }), [choice, sysDark, cycle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme outside ThemeProvider');
  return v;
}

export function ThemeToggle() {
  const { choice, cycle } = useTheme();
  const Icon = choice === 'light' ? IconSun : choice === 'dark' ? IconMoon : IconMonitor;
  return (
    <button type="button" className="btn ghost icon" onClick={cycle} aria-label={`${LABEL[choice]} (click to change)`} title={`${LABEL[choice]}: click to change`}>
      <Icon />
    </button>
  );
}
