import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { type Locale, type Messages, resolveMessages } from './messages';

export type ThemeSetting = 'light' | 'dark' | 'auto';

interface GridSettings {
  messages: Messages;
  /** The theme to draw with right now ('auto' already resolved against the OS setting). */
  theme: 'light' | 'dark';
}

const DEFAULT: GridSettings = { messages: resolveMessages('en'), theme: 'light' };
const GridContext = createContext<GridSettings>(DEFAULT);

function systemTheme(): 'light' | 'dark' {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

interface GridProviderProps {
  locale?: Locale;
  /** Replaces single strings of the chosen locale (e.g. to rename a button). */
  messages?: Partial<Messages>;
  theme?: ThemeSetting;
  children: ReactNode;
}

/**
 * Optional wrapper that sets the language and color theme for every grid component below it (DataGrid, Toolbar,
 * FormulaBar, StatusBar, menus and dialogs). Without it they use English and the light theme.
 */
export function GridProvider({ locale = 'en', messages, theme = 'light', children }: GridProviderProps) {
  const [system, setSystem] = useState<'light' | 'dark'>(systemTheme);
  useEffect(() => {
    if (theme !== 'auto' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setSystem(query.matches ? 'dark' : 'light');
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [theme]);
  const resolved = theme === 'auto' ? system : theme;
  const value = useMemo<GridSettings>(() => ({ messages: resolveMessages(locale, messages), theme: resolved }), [locale, messages, resolved]);
  return <GridContext.Provider value={value}>{children}</GridContext.Provider>;
}

export function useMessages(): Messages {
  return useContext(GridContext).messages;
}

export function useTheme(): 'light' | 'dark' {
  return useContext(GridContext).theme;
}
