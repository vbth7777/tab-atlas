import { describe, expect, it } from 'vitest';
import { migrateWorkspaceStore } from '@/src/data/chrome-local-workspace-repository';

describe('workspace store migration', () => {
  it('creates a current empty store for unknown legacy data', () => {
    expect(migrateWorkspaceStore({ schemaVersion: 0, sessions: [] })).toEqual({ schemaVersion: 1, workspaces: [] });
  });

  it('preserves a current store', () => {
    const store = { schemaVersion: 1 as const, workspaces: [] };
    expect(migrateWorkspaceStore(store)).toBe(store);
  });
});
