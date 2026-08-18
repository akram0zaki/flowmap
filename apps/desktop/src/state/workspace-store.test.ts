import { afterEach, describe, expect, it } from 'vitest';
import { MemoryWorkspaceRepository } from '@flowmap/storage';

import {
  SAMPLE_WORKSPACE_ID,
  useWorkspace,
  WORKSPACE_ID,
  type Runtime,
} from './workspace-store.js';

const initial = useWorkspace.getState();

afterEach(() => {
  useWorkspace.setState(initial, true);
});

function runtime(): Runtime {
  let n = 0;
  return {
    repository: new MemoryWorkspaceRepository(),
    now: () => '2026-08-15T09:00:00Z',
    newId: () => `id-${String((n += 1)).padStart(4, '0')}`,
  };
}

describe('sample workspace is a separate switchable portfolio', () => {
  it('starts on an empty personal workspace and keeps the sample listed', async () => {
    const r = runtime();
    await useWorkspace.getState().init(r, 'You');

    const { state, workspaces, activeWorkspaceId } = useWorkspace.getState();
    expect(workspaces).toHaveLength(2);
    expect(workspaces.filter((workspace) => workspace.isSample)).toHaveLength(1);
    expect(activeWorkspaceId).toBe(WORKSPACE_ID);
    expect(state?.workspace.isSample).toBe(false);
    expect(state?.teams.size).toBe(0);
    expect(state?.commitments.size).toBe(0);
  });

  it('switches to the sample without overwriting the personal workspace', async () => {
    const r = runtime();
    await useWorkspace.getState().init(r, 'You');
    expect(await useWorkspace.getState().addTeam('Payments')).toBe(true);
    expect(useWorkspace.getState().state?.teams.size).toBe(1);

    const sampleId = useWorkspace.getState().workspaces.find((workspace) => workspace.isSample)?.id;
    expect(sampleId).toBe(SAMPLE_WORKSPACE_ID);
    expect(await useWorkspace.getState().switchWorkspace(sampleId!)).toBe(true);

    const onSample = useWorkspace.getState();
    expect(onSample.state?.workspace.isSample).toBe(true);
    expect(onSample.state?.teams.size).toBe(5);
    expect(onSample.activeWorkspaceId).toBe(SAMPLE_WORKSPACE_ID);

    expect(await useWorkspace.getState().switchWorkspace(WORKSPACE_ID)).toBe(true);
    const back = useWorkspace.getState();
    expect(back.state?.workspace.isSample).toBe(false);
    expect(back.state?.teams.size).toBe(1);
    expect([...back.state!.teams.values()][0]?.name).toBe('Payments');
  });

  it('reseeds the sample workspace rather than the personal one', async () => {
    const r = runtime();
    await useWorkspace.getState().init(r, 'You');
    expect(await useWorkspace.getState().addTeam('Payments')).toBe(true);

    await useWorkspace.getState().loadSample();
    expect(useWorkspace.getState().activeWorkspaceId).toBe(SAMPLE_WORKSPACE_ID);
    expect(useWorkspace.getState().state?.teams.size).toBe(5);

    expect(await useWorkspace.getState().switchWorkspace(WORKSPACE_ID)).toBe(true);
    expect(useWorkspace.getState().state?.teams.size).toBe(1);
  });

  it('reuses an existing sample workspace instead of seeding a second one', async () => {
    const r = runtime();
    await useWorkspace.getState().init(r, 'You');
    await useWorkspace.getState().loadSample();
    const firstId = useWorkspace.getState().activeWorkspaceId;

    await useWorkspace.getState().init(r, 'You');
    const samples = useWorkspace.getState().workspaces.filter((workspace) => workspace.isSample);
    expect(samples).toHaveLength(1);
    expect(samples[0]?.id).toBe(firstId);
  });
});
