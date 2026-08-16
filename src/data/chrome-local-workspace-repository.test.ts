import { describe, expect, it } from 'vitest';
import { migrateWorkspaceStore } from '@/src/data/chrome-local-workspace-repository';

describe('workspace store migration', () => {
  it('upgrades v1 snapshots to live workspaces without losing tabs', () => {
    const legacy = {
      schemaVersion: 1,
      workspaces: [{
        id: 'workspace_1',
        name: 'Research',
        color: 'teal',
        tabs: [{ id: 'tab_1', title: 'Example', url: 'https://example.com', hostname: 'example.com', savedAt: '2026-01-01T00:00:00.000Z' }],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    };

    const migrated = migrateWorkspaceStore(legacy);

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.windowToWorkspace).toEqual({});
    expect(migrated.workspaces.at(0)).toMatchObject({ name: 'Research', live: { status: 'disconnected' } });
    expect(migrated.workspaces.at(0)?.tabs).toHaveLength(1);
  });

  it('preserves a current store and its window links', () => {
    const store = {
      schemaVersion: 2 as const,
      workspaces: [],
      windowToWorkspace: { '3': 'workspace_1' },
    };

    expect(migrateWorkspaceStore(store)).toEqual(store);
  });

  it('migrates raw array of workspaces without losing data', () => {
    const rawArray = [
      { id: 'ws_1', name: 'Legacy Array Workspace', tabs: [{ id: 1, url: 'https://google.com' }] },
    ];
    const migrated = migrateWorkspaceStore(rawArray);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.workspaces).toHaveLength(1);
    expect(migrated.workspaces[0].name).toBe('Legacy Array Workspace');
  });

  it('migrates un-versioned object containing workspaces', () => {
    const unversioned = {
      workspaces: [
        { id: 'ws_2', name: 'Unversioned Object Workspace', tabs: [] },
      ],
    };
    const migrated = migrateWorkspaceStore(unversioned);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.workspaces).toHaveLength(1);
    expect(migrated.workspaces[0].name).toBe('Unversioned Object Workspace');
  });

  it('unwraps nested storage key object wrapper', () => {
    const nested = {
      'tab-atlas.workspace-store': {
        schemaVersion: 2,
        workspaces: [{ id: 'ws_3', name: 'Nested Workspace', tabs: [] }],
      },
    };
    const migrated = migrateWorkspaceStore(nested);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.workspaces).toHaveLength(1);
    expect(migrated.workspaces[0].name).toBe('Nested Workspace');
  });

  it('falls back to an empty store for unrecognised data', () => {
    expect(migrateWorkspaceStore({ schemaVersion: 0, sessions: [] })).toEqual({ schemaVersion: 2, workspaces: [], windowToWorkspace: {} });
  });
});
