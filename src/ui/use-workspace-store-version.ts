import { useEffect, useState } from 'react';

/**
 * Bumps whenever the background worker persists workspace changes, so open UI
 * reflects live tab activity. It only observes storage; it never writes back.
 */
export function useWorkspaceStoreVersion(): number {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const listener = (changes: Record<string, unknown>, areaName: string) => {
      if (areaName === 'local' && 'tab-atlas.workspace-store' in changes) setVersion((current) => current + 1);
    };

    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  return version;
}
