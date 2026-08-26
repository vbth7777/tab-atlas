import React, { createContext, useContext, useEffect, useState } from 'react';
import type { SupportedLanguage, LanguageOption, TranslationSchema } from './types';
import { vi } from './vi';
import { en } from './en';
import type { Workspace } from '@/src/domain/workspace';

export * from './types';
export { vi, en };

export const LANGUAGE_STORAGE_KEY = 'atlas_tab_ui_lang';

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en', label: 'English', shortLabel: 'ENG', flag: '🇬🇧' },
  { code: 'vi', label: 'Tiếng Việt', shortLabel: 'VIE', flag: '🇻🇳' },
];

export const dictionaries: Record<SupportedLanguage, TranslationSchema> = {
  en,
  vi,
};

// Export translations alias for backward compatibility
export const translations = dictionaries;

/**
 * Safely resolves the translation dictionary for a given language code.
 * Defaults to English and ensures missing keys at runtime
 * are seamlessly filled from the default locale.
 */
export function getTranslation(lang: string = 'en'): TranslationSchema {
  const selectedLang = (lang === 'vi' ? 'vi' : 'en') as SupportedLanguage;
  const primary = dictionaries[selectedLang] || en;
  const fallback = en;

  // Deep fallback proxy/merger ensuring no key is ever undefined at runtime
  return new Proxy(primary, {
    get(target, prop: keyof TranslationSchema) {
      if (prop in target) {
        const val = target[prop];
        if (typeof val === 'object' && val !== null) {
          const fallbackVal = (fallback[prop] as Record<string, any>) || {};
          return new Proxy(val as any, {
            get(nestedTarget, nestedProp: string) {
              return nestedTarget[nestedProp] ?? fallbackVal[nestedProp] ?? '';
            },
          });
        }
        return val;
      }
      return fallback[prop];
    },
  });
}

export interface I18nContextType {
  lang: SupportedLanguage;
  setLanguage: (lang: SupportedLanguage) => void;
  t: TranslationSchema;
}

const I18nContext = createContext<I18nContextType>({
  lang: 'en',
  setLanguage: () => {},
  t: en,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<SupportedLanguage>('en');

  useEffect(() => {
    try {
      const g = globalThis as any;
      if (g.chrome?.storage?.local) {
        g.chrome.storage.local.get([LANGUAGE_STORAGE_KEY]).then((result: any) => {
          if (result && (result[LANGUAGE_STORAGE_KEY] === 'en' || result[LANGUAGE_STORAGE_KEY] === 'vi')) {
            setLangState(result[LANGUAGE_STORAGE_KEY]);
          } else {
            // Default to English
            setLangState('en');
          }
        }).catch(() => {});

        // Listen for storage changes across popup & dashboard
        const storageListener = (changes: any, areaName: string) => {
          if (areaName === 'local' && changes[LANGUAGE_STORAGE_KEY]) {
            const nextLang = changes[LANGUAGE_STORAGE_KEY].newValue;
            if (nextLang === 'en' || nextLang === 'vi') {
              setLangState(nextLang);
            }
          }
        };
        g.chrome.storage.onChanged.addListener(storageListener);
        return () => g.chrome.storage.onChanged.removeListener(storageListener);
      } else if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (saved === 'en' || saved === 'vi') {
          setLangState(saved as SupportedLanguage);
        } else {
          setLangState('en');
        }
      }
    } catch {}
  }, []);

  const setLanguage = (newLang: SupportedLanguage) => {
    setLangState(newLang);
    try {
      const g = globalThis as any;
      if (g.chrome?.storage?.local) {
        g.chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: newLang }).catch(() => {});
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(LANGUAGE_STORAGE_KEY, newLang);
      }
    } catch {}
  };

  const t = getTranslation(lang);

  return React.createElement(
    I18nContext.Provider,
    { value: { lang, setLanguage, t } },
    children
  );
}

export function useI18n(): I18nContextType {
  return useContext(I18nContext);
}

/**
 * Format relative time (e.g. 5m ago, 2h ago)
 */
export function formatRelativeTime(isoString: string, lang: SupportedLanguage = 'en'): string {
  const t = getTranslation(lang);
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return t.time.justNow;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t.time.minutesAgo.replace('{count}', String(diffMin));
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return t.time.hoursAgo.replace('{count}', String(diffHour));
  const diffDay = Math.floor(diffHour / 24);
  return t.time.daysAgo.replace('{count}', String(diffDay));
}

/**
 * Format synchronized label
 */
export function formatSyncedLabel(workspace: Workspace, lang: SupportedLanguage = 'en'): string {
  const relative = formatRelativeTime(workspace.updatedAt, lang);
  return lang === 'vi' ? `Đã đồng bộ ${relative}` : `Synced ${relative}`;
}

/**
 * Format history timestamp
 */
export function formatHistoryTime(isoString: string, lang: SupportedLanguage = 'en'): string {
  const d = new Date(isoString);
  const dateStr = d.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });
  const timeStr = d.toLocaleTimeString(lang === 'vi' ? 'vi-VN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dateStr} ${timeStr}`;
}
