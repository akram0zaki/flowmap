/** Single permission matrix for command-level identity checks. */

import type { WorkspaceRole } from './entities.js';
import { roleAtLeast } from './command.js';

export const COMMAND_PERMISSIONS: Readonly<Record<string, WorkspaceRole>> = {
  CreateWorkspace: 'PLANNER',
  CreateIdea: 'CONTRIBUTOR',
  ImportIdeas: 'CONTRIBUTOR',
  ArchiveWorkspace: 'PLANNER',
  RestoreWorkspace: 'PLANNER',
  CreateSnapshot: 'PLANNER',
  RestoreSnapshot: 'PLANNER',
  SaveView: 'PLANNER',
  RemoveSavedView: 'PLANNER',
};

export function mayRunCommand(role: WorkspaceRole, commandName: string): boolean {
  const required = COMMAND_PERMISSIONS[commandName];
  return required === undefined || roleAtLeast(role, required);
}
