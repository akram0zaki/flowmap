/**
 * The Portfolio Map, on screen.
 *
 * Quarters as columns, teams as rows, the Ideas lane pinned left, three zoom
 * levels, focus mode, and filter chips — with a list companion whose totals must
 * equal the projection exactly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDependency,
  addExternalLink,
  addMilestone,
  assessCommitGate,
  createTheme,
  isCounted,
  isQuarterId,
  removeDependency,
  removeExternalLink,
  removeMilestone,
  removeProductImpact,
  setProductImpact,
  updateDependency,
  utilisationPercent,
  baselineProjection,
  compareScenario,
} from '@flowmap/domain';
import {
  NO_RULE_SETTINGS,
  countByRule,
  scenarioComparisonAdditions,
  type RadarMode,
  type RuleResult,
  type RuleSettings as Settings,
  type SuggestedAction,
} from '@flowmap/rules';
import {
  buildBoard,
  focusOn,
  NO_FILTER,
  NO_FOCUS,
  clampUnits,
  defaultDropUnits,
  findCell,
  previewDrop,
  previewRemoval,
  previewSpan,
  spanOf,
  type SpanDrag,
  type SpanEdge,
  previewResize,
  readinessForIdeas,
  clampScale,
  levelForScale,
  scaleForLevel,
  toggleFilterValue,
  allBlocks,
  LENSES,
  type BoardReveal,
  type CellModel,
  type DragPayload,
  type FilterState,
  type ZoomLevel,
} from '@flowmap/visual-model';

import { useWorkspace } from '../state/workspace-store.js';
import { usePlacement, type DropTarget } from '../state/use-placement.js';
import { useResize, type ResizeState } from '../state/use-resize.js';
import { useSpan, type SpanState } from '../state/use-span.js';
import type { Milestone, QuarterId } from '@flowmap/domain';
import { PortfolioMap } from '../components/PortfolioMap.jsx';
import { LensStrip } from '../components/LensStrip.jsx';
import { ZoomDock } from '../components/ZoomDock.jsx';
import { IdeasLane } from '../components/IdeasLane.jsx';
import { ListCompanion } from '../components/ListCompanion.jsx';
import { DetailPanel, type PanelFootprint } from '../components/DetailPanel.jsx';
import type { DependencyEdge } from '../components/DependencyLayer.jsx';
import { CaptureBar } from '../components/CaptureBar.jsx';
import { Radar } from '../components/Radar.jsx';
import { RuleSettings } from '../components/RuleSettings.jsx';
import { ScenarioDock } from '../components/ScenarioDock.jsx';
import { QbrView } from '../components/QbrView.jsx';
import { AttentionView } from '../components/AttentionView.jsx';
import { CommandPalette } from '../components/CommandPalette.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { WorkspaceSwitcher } from '../components/WorkspaceSwitcher.jsx';
import { PortabilityPanel } from '../components/PortabilityPanel.jsx';
import { SavedViews } from '../components/SavedViews.jsx';
import { SettingsPanel } from '../components/SettingsPanel.jsx';
import { TeamCapacityDialog } from '../components/TeamCapacityDialog.jsx';
import { SyncStatus } from '../components/SyncStatus.jsx';
import { ConflictResolver } from '../components/ConflictResolver.jsx';
import { ShortcutReference } from '../components/ShortcutReference.jsx';
import { SnapshotsPanel } from '../components/SnapshotsPanel.jsx';
import { FirstRunGuide } from '../components/FirstRunGuide.jsx';
import { FlowmapMark } from '../components/FlowmapMark.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { useNativeMenu, type MenuCommand } from '../state/use-native-menu.js';
import {
  DependencyMapView,
  HistoryView,
  ProductsView,
  ThemesView,
  TimelineView,
} from '../components/M5Views.jsx';
import { TeamsView } from '../components/TeamsView.jsx';
import { useSignals } from '../state/use-signals.js';
import { notificationMessages } from '../state/notifications.js';
import type { VesselBlock } from '../components/CapacityVessel.jsx';
import { t } from '../i18n/t.js';

type ActiveLens = (typeof LENSES)[number] | 'HISTORY';

export function App() {
  const state = useWorkspace((s) => s.state);
  const status = useWorkspace((s) => s.status);
  const profileName = useWorkspace((s) => s.profileName);
  const workspaces = useWorkspace((s) => s.workspaces);
  const archivedWorkspaces = useWorkspace((s) => s.archivedWorkspaces);
  const activeWorkspaceId = useWorkspace((s) => s.activeWorkspaceId);
  const selectedFootprintId = useWorkspace((s) => s.selectedFootprintId);
  const presentationMode = useWorkspace((s) => s.presentationMode);
  const syncStatus = useWorkspace((s) => s.syncStatus);
  const conflicts = useWorkspace((s) => s.conflicts);
  const {
    undo,
    redo,
    select,
    clearStatus,
    createWorkspace,
    switchWorkspace,
    archiveActiveWorkspace,
    restoreArchivedWorkspace,
    syncNow,
    resolveConflict,
    importIdeas,
    importWorkspacePackage,
    importWorkspaceJson,
    createSnapshot,
    restoreSnapshot,
    saveView,
    removeSavedView,
    saveImportMapping,
    setNotificationSettings,
    clearLocalData,
    loadSample,
    commitIdeaInto,
    archiveTeam,
    dropCommitment,
    moveFootprint,
    placeFootprint,
    setCapacityDefaults,
    setTeamDefaults,
    setTeamQuarterReserves,
    stretchFootprint,
    reorderFootprints,
    unplaceFootprint,
    resizeFootprint,
    editCommitment,
    relate,
    passGate,
    splitFootprint,
    moveTeamRow,
    setThemes,
    openLink,
    linkIdeaToRefinement,
    unlinkIdeaFromRefinement,
    reviewSignal,
    snoozeSignal,
    clearSignal,
    createScenario,
    discardScenario,
    shareScenario,
    cloneScenario,
    applyScenario,
    getScenarioRebase,
    rebaseScenario,
    setPresentationMode,
    scenarioProjection,
    placeScenarioIdea,
    closeQuarter,
    reopenQuarter,
    setRecurrence,
    renewCommitment,
    search,
  } = useWorkspace.getState();

  /**
   * Zoom is a continuous scale; the level is read off it (spec 06 §3.3). Held
   * this way round because Ctrl/Cmd+scroll and pinch move the scale smoothly
   * and the level has to follow, not the other way about — a level that owned
   * the scale would snap the board back the moment you nudged the wheel.
   */
  const [scale, setScale] = useState(() => scaleForLevel(3));
  const [welcome, setWelcome] = useState(true);
  const level = levelForScale(scale);
  const setLevelState = useCallback((next: ZoomLevel) => setScale(scaleForLevel(next)), []);
  const [filter, setFilter] = useState<FilterState>(NO_FILTER);
  const [focusedCommitmentId, setFocusedCommitmentId] = useState<string | null>(null);
  const [reveal, setReveal] = useState<BoardReveal | null>(null);
  /**
   * Work that has just landed and has not been focused yet.
   *
   * A drop is the end of one decision and the start of the next — how big is
   * it, does it run on, is it in the right place — and all of those are
   * gestures on the block. Leaving focus where the drag started means the
   * first thing you do afterwards is hunt for what you just placed.
   */
  const [justPlaced, setJustPlaced] = useState<{
    readonly commitmentId: string;
    readonly teamId: string;
    readonly quarterId: string;
  } | null>(null);
  const [showList, setShowList] = useState(true);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [showRadar, setShowRadar] = useState(false);
  const [showRuleSettings, setShowRuleSettings] = useState(false);
  const [radarMode, setRadarMode] = useState<RadarMode>('PORTFOLIO');
  /**
   * Rule settings live in view state for now.
   *
   * They belong on the workspace and travel with it (`SetRuleThresholds` in
   * spec 03 §3.1); that command arrives with workspace settings in M6. Held
   * here so the tuning screen is real and usable rather than a mock, and
   * flagged so nobody mistakes it for the finished thing.
   */
  const [ruleSettings, setRuleSettings] = useState<Settings>(NO_RULE_SETTINGS);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [activeLens, setActiveLens] = useState<ActiveLens>('PORTFOLIO');
  const [showPalette, setShowPalette] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  /** The team whose default allocations are open, from its own row in the lens. */
  const [teamSettingsFor, setTeamSettingsFor] = useState<string | null>(null);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<
    | { kind: 'drop'; commitmentId: string; name: string }
    | { kind: 'archiveTeam'; teamId: string; name: string }
    | null
  >(null);
  const scenarioState = selectedScenarioId === null ? null : scenarioProjection(selectedScenarioId);
  const viewState = scenarioState ?? state;
  const scenarioRebase =
    state &&
    selectedScenarioId !== null &&
    state.scenarios?.get(selectedScenarioId)?.baseRevision !== state.workspace.revision
      ? getScenarioRebase(selectedScenarioId)
      : undefined;

  // Announcements are debounced through a ref so rapid arrow-key movement does
  // not queue a dozen utterances.
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((message: string) => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setAnnouncement(message), 120);
  }, []);

  useEffect(() => {
    const onFocus = () => {
      void syncNow();
    };
    window.addEventListener('focus', onFocus);
    const interval = window.setInterval(() => {
      void syncNow();
    }, 60_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(interval);
    };
  }, [syncNow]);

  const handleMenu = useCallback(
    (command: MenuCommand) => {
      switch (command) {
        case 'clear-local-data':
          setConfirmClear(true);
          break;
        case 'undo':
          void undo();
          break;
        case 'redo':
          void redo();
          break;
        case 'command-palette':
          setShowPalette(true);
          break;
        case 'list-companion':
          setShowList((visible) => !visible);
          break;
        case 'presentation':
          announce(presentationMode ? t('presentation.off') : t('presentation.on'));
          setPresentationMode(!presentationMode);
          break;
        case 'settings':
        case 'about':
          setShowSettings(true);
          break;
        case 'shortcuts':
          setShowShortcuts(true);
          break;
      }
    },
    [undo, redo, announce, presentationMode, setPresentationMode],
  );
  const { once } = useNativeMenu(handleMenu);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const typing = isTypingTarget(e.target);
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        once(e.shiftKey ? 'redo' : 'undo', () => {
          void (e.shiftKey ? redo() : undo());
        });
      }
      if (mod && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        once('list-companion', () => setShowList((v) => !v));
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        once('command-palette', () => setShowPalette(true));
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        once('settings', () => setShowSettings(true));
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        once('presentation', () => {
          announce(presentationMode ? t('presentation.off') : t('presentation.on'));
          setPresentationMode(!presentationMode);
        });
      }
      if (e.key === 'Escape') {
        setFocusedCommitmentId(null);
        select(null);
        if (presentationMode) {
          setPresentationMode(false);
          announce(t('presentation.off'));
        }
      }
      if (!mod && e.key === '?' && !typing) {
        e.preventDefault();
        once('shortcuts', () => setShowShortcuts(true));
      }
      if (!mod && /^[1-8]$/.test(e.key) && e.target === document.body) {
        const lens = LENSES[Number(e.key) - 1];
        if (lens) setActiveLens(lens);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, select, announce, presentationMode, setPresentationMode, once]);

  /**
   * Ctrl/Cmd + wheel, and pinch — which the browser also reports as a wheel
   * event with `ctrlKey` set. Plain scrolling stays scrolling: the board is
   * wider than the window and taking the wheel away from panning would cost
   * more than the zoom is worth.
   */
  const onWheelZoom = useCallback((deltaY: number) => {
    // Multiplicative, so a step feels the same at every scale.
    setScale((current) => clampScale(current * Math.exp(-deltaY / 400)));
  }, []);

  const nudgeZoom = useCallback((factor: number) => {
    setScale((current) => clampScale(current * factor));
  }, []);

  const board = useMemo(
    () =>
      viewState
        ? buildBoard({
            workspace: viewState.workspace,
            teams: viewState.teams,
            teamQuarters: viewState.teamQuarters,
            commitments: viewState.commitments,
            footprints: viewState.footprints,
            ...(selectedScenarioId !== null ? { scenario: true } : {}),
          })
        : null,
    [viewState, selectedScenarioId],
  );

  const events = useWorkspace((s) => s.events);
  const snapshots = useWorkspace((s) => s.snapshots);
  const runtime = useWorkspace((s) => s.runtime);

  /**
   * The rules, evaluated. Pure and synchronous, so this is a memo rather than
   * an effect — signals are a function of state, never a thing that happens to
   * it, and there is no window in which the board and the Radar disagree.
   */
  const signals = useSignals(state, {
    actorId: `local:local-profile`,
    settings: ruleSettings,
    now: runtime?.now ?? (() => new Date().toISOString()),
    events,
  });
  const notifiedSignals = useRef(new Map<string, number>());
  useEffect(() => {
    if (!state || typeof Notification === 'undefined') return;
    const now = new Date(runtime?.now() ?? new Date().toISOString());
    const messages = notificationMessages(
      signals.visible,
      state.workspace.settings.notifications,
      now,
      notifiedSignals.current,
      t,
    );
    if (messages.length === 0 || Notification.permission !== 'granted') return;
    for (const message of messages) {
      new Notification(message.title, { body: message.body });
      for (const key of message.key.split('|')) notifiedSignals.current.set(key, now.getTime());
    }
  }, [runtime, signals.visible, state]);
  const scenarioSignals = useSignals(scenarioState, {
    actorId: `local:local-profile`,
    settings: ruleSettings,
    now: runtime?.now ?? (() => new Date().toISOString()),
    events,
  });
  const scenarioDiff =
    state && scenarioState
      ? compareScenario(
          baselineProjection(state),
          scenarioState,
          scenarioComparisonAdditions(
            baselineProjection(state),
            scenarioState,
            signals.all,
            scenarioSignals.all,
          ),
        )
      : null;

  /**
   * What a quick action does.
   *
   * `OPEN` and `NAVIGATE` move the view; `COMMAND` actions name a command the
   * rule believes would help. The commands are deliberately *not* executed
   * blind — most need a value the signal cannot supply (who the owner is, what
   * date) — so they focus the thing and let the panel ask. A rule that could
   * silently mutate the portfolio would be a rule nobody could trust.
   */
  const actOnSignal = useCallback(
    (signal: RuleResult, action: SuggestedAction) => {
      const ref =
        action.kind === 'OPEN' ? action.ref : action.kind === 'NAVIGATE' ? action.focus : undefined;
      const target = ref ?? signal.entityRef;

      const commitmentId =
        target.kind === 'COMMITMENT'
          ? target.id
          : String(signal.facts['commitmentId'] ?? signal.facts['sourceCommitmentId'] ?? '');
      const teamId = String(signal.facts['teamId'] ?? '');
      const quarterId = String(signal.facts['quarterId'] ?? '');
      const landing: BoardReveal = {
        ...(commitmentId !== '' ? { commitmentId } : {}),
        ...(teamId !== '' ? { teamId } : {}),
        ...(isQuarterId(quarterId) ? { quarterId } : {}),
      };

      if (commitmentId === '' && teamId === '') {
        announce(t('radar.noTarget'));
        return;
      }

      setActiveLens('PORTFOLIO');
      if (commitmentId !== '') {
        setFocusedCommitmentId(commitmentId);
        if (state?.commitments.get(commitmentId)?.lifecycle === 'IDEA') {
          setRailCollapsed(false);
        }
      }
      setReveal(landing);
      setShowRadar(false);
      setShowRuleSettings(false);
    },
    [announce, state],
  );

  const readiness = useMemo(
    () => (state ? readinessForIdeas(state.commitments, state.footprints) : new Map()),
    [state],
  );

  const busyTeamIds = useMemo(() => {
    const ids = new Set<string>();
    for (const footprint of state?.footprints.values() ?? []) {
      if (footprint.archivedAt === undefined) ids.add(footprint.teamId);
    }
    return ids;
  }, [state]);

  /**
   * Focus reaches past the grid.
   *
   * The board is a capacity picture — it knows where work sits, not what that
   * work changes or waits on. Handing focus the relations is what lets it dim
   * an unrelated product or milestone rather than only an unrelated block.
   */
  const focus = useMemo(
    () =>
      board
        ? focusOn(board, focusedCommitmentId, {
            impacts: state?.productImpacts?.values() ?? [],
            milestones: state?.milestones?.values() ?? [],
            dependencies: state?.dependencies?.values() ?? [],
          })
        : NO_FOCUS,
    [board, focusedCommitmentId, state],
  );

  const focusedName = useMemo(() => {
    if (!board || focusedCommitmentId === null) return null;
    return (
      board.rows
        .flatMap((r) => r.cells)
        .flatMap((c) => c.blocks)
        .find((b) => b.commitmentId === focusedCommitmentId)?.name ??
      board.ideas.find((i) => i.commitmentId === focusedCommitmentId)?.name ??
      null
    );
  }, [board, focusedCommitmentId]);

  // ── Placing work ───────────────────────────────────────────────────────
  //
  // Dragging is not a shortcut for the form; it is the product's argument. You
  // pick work up, every container tells you what it would become, and the drop
  // is the decision. For an Idea the drop is also the Commit Gate — the gesture
  // supplies a team, a footprint, and a primary footprint, which is three of
  // the four hard blockers, so there is nothing left to fill in.

  const describeDrag = useCallback(
    (payload: DragPayload, target: DropTarget | null): string => {
      if (!board || !target) return t('drop.carrying', { name: payload.name });

      // The rail is the way back off the board.
      if (target.kind === 'RAIL') {
        const removal = previewRemoval(payload);
        if (!removal.allowed) {
          return t('remove.refused', {
            reason: removal.refusal ? t(`remove.no.${removal.refusal}`) : '',
          });
        }
        return removal.returnsToRail
          ? t('remove.wouldReturn', { name: payload.name })
          : t('remove.wouldUnplace', { name: payload.name, units: removal.units });
      }

      const cell = findCell(board, target.teamId, target.quarterId as QuarterId);
      if (!cell) return t('drop.carrying', { name: payload.name });

      const preview = previewDrop(cell, payload, target.commitmentId);
      if (!preview.allowed) {
        return t('drop.refusedAt', {
          team: cell.teamName,
          quarter: cell.quarterId,
          reason: preview.refusal ? t(`drop.no.${preview.refusal}`) : '',
        });
      }
      if (payload.kind === 'LINK') {
        const targetId =
          target.commitmentId ??
          cell.blocks.find((block) => block.commitmentId !== payload.commitmentId)?.commitmentId;
        return targetId
          ? t('link.would', {
              from: payload.name,
              to: state?.commitments.get(targetId)?.name ?? '',
            })
          : t('link.needsWork');
      }

      // A block in hand can do two things, and which one is a modifier away.
      // Saying "would land on" for both is how a drag that quietly duplicated
      // work would read exactly like one that moved it.
      if (payload.kind === 'BLOCK') {
        // In its own container a drop onto another block is neither: it is a
        // reorder, and the only way to say which work will not fit.
        if (payload.fromTeamId === target.teamId && payload.fromQuarterId === target.quarterId) {
          const under = cell.blocks.find((block) => block.commitmentId === target.commitmentId);
          return under
            ? t('order.would', { name: payload.name, other: under.name })
            : t('drop.carrying', { name: payload.name });
        }
        return payload.intent === 'ADD'
          ? t('drop.wouldAlsoTake', {
              team: cell.teamName,
              name: payload.name,
              quarter: cell.quarterId,
              units: payload.addUnits,
              percent: preview.percent ?? 0,
            })
          : t('drop.wouldMove', {
              name: payload.name,
              team: cell.teamName,
              quarter: cell.quarterId,
              percent: preview.percent ?? 0,
            });
      }

      const landing = t('drop.wouldLand', {
        name: payload.name,
        team: cell.teamName,
        quarter: cell.quarterId,
        percent: preview.percent ?? 0,
      });
      return preview.reassignsOwner
        ? `${landing} ${t('drop.reassigns', { team: cell.teamName })}`
        : landing;
    },
    [board, state],
  );

  const applyDrop = useCallback(
    (payload: DragPayload, target: DropTarget) => {
      if (!board) return;

      if (target.kind === 'RAIL') {
        const removal = previewRemoval(payload);
        if (!removal.allowed || payload.kind !== 'BLOCK') return;
        void unplaceFootprint({
          footprintId: payload.footprintId,
          commitmentId: payload.commitmentId,
          returnToRail: removal.returnsToRail,
        }).then((ok: boolean) => {
          if (!ok) return;
          announce(
            removal.returnsToRail
              ? t('remove.returned', { name: payload.name })
              : t('remove.unplaced', { name: payload.name }),
          );
        });
        return;
      }

      const cell = findCell(board, target.teamId, target.quarterId as QuarterId);
      // Re-check on release. The board can change under a slow drag, and the
      // preview that allowed it may no longer be the truth.
      if (!cell || !previewDrop(cell, payload, target.commitmentId).allowed) return;

      // A dependency lands on work, not on a container.
      if (payload.kind === 'LINK') {
        const targetId =
          target.commitmentId ??
          cell.blocks.find((block) => block.commitmentId !== payload.commitmentId)?.commitmentId;
        if (!targetId || targetId === payload.commitmentId) return;

        void relate('AddDependency', (rs, cmd, ctx) =>
          addDependency(
            rs,
            {
              sourceCommitmentId: payload.commitmentId,
              target: { kind: 'COMMITMENT', id: targetId },
            },
            cmd,
            ctx,
          ),
        ).then((ok) => {
          if (ok) {
            announce(
              t('link.made', {
                from: payload.name,
                to: state?.commitments.get(targetId)?.name ?? '',
              }),
            );
          }
        });
        return;
      }

      if (payload.kind === 'BLOCK') {
        /*
         * Dropped in its own container, onto another block: reorder. Which work
         * sits above the capacity rule is a decision, and sorting by size made
         * it an artefact — whichever items happened to be smallest were drawn
         * as the overflow and marked as the questionable ones.
         *
         * The whole container is sent, because a partial order cannot be drawn.
         */
        if (payload.fromTeamId === target.teamId && payload.fromQuarterId === target.quarterId) {
          const order = cell.blocks.map((block) => block.footprintId);
          const from = order.indexOf(payload.footprintId);
          const to = cell.blocks.findIndex((block) => block.commitmentId === target.commitmentId);
          if (from === -1 || to === -1 || from === to) return;

          order.splice(from, 1);
          order.splice(to, 0, payload.footprintId);
          void reorderFootprints(target.teamId, target.quarterId, order).then((ok) => {
            if (ok) announce(t('order.moved', { name: payload.name, position: to + 1 }));
          });
          return;
        }

        // Adding is not placing an Idea: no team becomes the owner, no gate is
        // passed, no lifecycle moves. It is one more team carrying some of the
        // load, which is `AssignCapacityFootprint` and nothing else.
        if (payload.intent === 'ADD') {
          void placeFootprint({
            commitmentId: payload.commitmentId,
            teamId: target.teamId,
            quarterId: target.quarterId,
            units: payload.addUnits,
          }).then((ok: boolean) => {
            if (!ok) return;
            setJustPlaced({
              commitmentId: payload.commitmentId,
              teamId: target.teamId,
              quarterId: target.quarterId,
            });
            announce(
              t('drop.alsoTaken', {
                team: cell.teamName,
                name: payload.name,
                quarter: cell.quarterId,
                units: payload.addUnits,
              }),
            );
          });
          return;
        }
        void moveFootprint(payload.footprintId, {
          teamId: target.teamId,
          quarterId: target.quarterId,
        }).then(() =>
          setJustPlaced({
            commitmentId: payload.commitmentId,
            teamId: target.teamId,
            quarterId: target.quarterId,
          }),
        );
      } else if (selectedScenarioId !== null) {
        void placeScenarioIdea({
          scenarioId: selectedScenarioId,
          commitmentId: payload.commitmentId,
          teamId: target.teamId,
          quarterId: target.quarterId,
          units: payload.units,
        });
      } else {
        void commitIdeaInto({
          commitmentId: payload.commitmentId,
          teamId: target.teamId,
          quarterId: target.quarterId,
          units: payload.units,
        }).then(() =>
          setJustPlaced({
            commitmentId: payload.commitmentId,
            teamId: target.teamId,
            quarterId: target.quarterId,
          }),
        );
      }
      announce(
        t('drop.placed', { name: payload.name, team: cell.teamName, quarter: cell.quarterId }),
      );
    },
    [
      board,
      state,
      moveFootprint,
      placeFootprint,
      reorderFootprints,
      commitIdeaInto,
      unplaceFootprint,
      relate,
      announce,
      selectedScenarioId,
      placeScenarioIdea,
    ],
  );

  /**
   * Alt, read live, is the difference between the two things a held placement
   * can do. Plain is the common case — another team picks the work up too —
   * because most demand is worked by more than one squad, and a board that made
   * that the awkward path would be arguing with reality.
   */
  const resolveIntent = useCallback(
    (payload: DragPayload, alt: boolean): DragPayload =>
      payload.kind === 'BLOCK' ? { ...payload, intent: alt ? 'MOVE' : 'ADD' } : payload,
    [],
  );

  const { placement, carryRef, beginPointer, beginKeyboard, aim, drop, cancel } = usePlacement({
    onDrop: applyDrop,
    onCancel: (payload) => announce(t('drop.cancelled', { name: payload.name })),
    announce,
    describe: describeDrag,
    resolve: resolveIntent,
  });

  const pickUpIdea = useCallback(
    (commitmentId: string, event?: React.PointerEvent) => {
      const idea = board?.ideas.find((i) => i.commitmentId === commitmentId);
      if (!idea || !state) return;
      const payload: DragPayload = {
        kind: 'IDEA',
        commitmentId,
        name: idea.name,
        units: defaultDropUnits(state.workspace.settings.capacity.sizeMapping),
        commitmentClass: idea.commitmentClass,
        hasTargetDate: state.commitments.get(commitmentId)?.targetDate !== undefined,
        ...(state.commitments.get(commitmentId)?.primaryTeamId !== undefined
          ? { primaryTeamId: state.commitments.get(commitmentId)!.primaryTeamId! }
          : {}),
      };
      if (event) beginPointer(payload, event);
      else beginKeyboard(payload);
    },
    [board, state, beginPointer, beginKeyboard],
  );

  /**
   * Drawing a dependency. Shift-drag from a block, or `d` then the arrows —
   * the same gesture as moving work, because it is the same question asked of
   * two pieces of work instead of one. Visual creation defaults to REQUIRES;
   * the type is refined in the panel, and the direction never flips.
   */
  const linkFrom = useCallback(
    (commitmentId: string, event?: React.PointerEvent) => {
      const commitment = state?.commitments.get(commitmentId);
      if (!commitment) return;
      const payload: DragPayload = {
        kind: 'LINK',
        commitmentId,
        name: commitment.name,
        units: 0,
      };
      if (event) beginPointer(payload, event);
      else beginKeyboard(payload);
    },
    [state, beginPointer, beginKeyboard],
  );

  const pickUpBlock = useCallback(
    (footprintId: string, teamId: string, quarterId: string, event?: React.PointerEvent) => {
      const block = board?.rows
        .flatMap((row) => row.cells)
        .flatMap((cell) => cell.blocks)
        .find((b) => b.footprintId === footprintId);
      if (!block || !state) return;

      // How many placements this work has decides whether taking one off the
      // board unplaces it or sends the whole commitment back to the lane.
      const footprintCount = [...state.footprints.values()].filter(
        (f) => f.commitmentId === block.commitmentId && f.archivedAt === undefined,
      ).length;

      const payload: DragPayload = {
        kind: 'BLOCK',
        footprintId,
        commitmentId: block.commitmentId,
        name: block.name,
        units: block.units,
        fromTeamId: teamId,
        fromQuarterId: quarterId as never,
        lifecycle: block.lifecycle,
        footprintCount,
        fromClosed: board
          ? (findCell(board, teamId, quarterId as QuarterId)?.closed ?? false)
          : false,
        // The gesture's default. `resolveIntent` rewrites it while Alt is held.
        intent: 'ADD',
        addUnits: defaultDropUnits(state.workspace.settings.capacity.sizeMapping),
      };
      if (event) beginPointer(payload, event);
      else beginKeyboard(payload);
    },
    [board, state, beginPointer, beginKeyboard],
  );

  /** Delete on a focused block: the same action as dragging it to the lane. */
  const removeBlock = useCallback(
    (footprintId: string, teamId: string, quarterId: string) => {
      const block = board?.rows
        .flatMap((row) => row.cells)
        .flatMap((cell) => cell.blocks)
        .find((b) => b.footprintId === footprintId);
      if (!block || !state) return;

      const footprintCount = [...state.footprints.values()].filter(
        (f) => f.commitmentId === block.commitmentId && f.archivedAt === undefined,
      ).length;
      const removal = previewRemoval({
        kind: 'BLOCK',
        footprintId,
        commitmentId: block.commitmentId,
        name: block.name,
        units: block.units,
        fromTeamId: teamId,
        fromQuarterId: quarterId as QuarterId,
        lifecycle: block.lifecycle,
        footprintCount,
        fromClosed: board
          ? (findCell(board, teamId, quarterId as QuarterId)?.closed ?? false)
          : false,
        // Taking work off the board is the same decision whichever way a drop
        // on a container would have gone; the intent is carried, not consulted.
        intent: 'MOVE',
        addUnits: block.units,
      });

      if (!removal.allowed) {
        announce(
          t('remove.refused', {
            reason: removal.refusal ? t(`remove.no.${removal.refusal}`) : '',
          }),
        );
        return;
      }

      // Announce the outcome, not the intent. Saying "returned to the lane"
      // before the command has run is how a refusal turns into a dead gesture.
      void unplaceFootprint({
        footprintId,
        commitmentId: block.commitmentId,
        returnToRail: removal.returnsToRail,
      }).then((ok: boolean) => {
        if (!ok) return;
        announce(
          removal.returnsToRail
            ? t('remove.returned', { name: block.name })
            : t('remove.unplaced', { name: block.name }),
        );
      });
    },
    [board, state, unplaceFootprint, announce],
  );

  /**
   * Resizing. The consequence is announced while the edge is still moving, and
   * the command is sent once, on release — a command per pixel would fill the
   * undo stack with the journey instead of the destination.
   */
  const describeResize = useCallback(
    (state: ResizeState): string | null => {
      if (!board) return null;
      const cell = findCell(board, state.teamId, state.quarterId as QuarterId);
      if (!cell) return null;
      const preview = previewResize(cell, state.footprintId, state.units);
      if (!preview.allowed) return t('resize.refused');

      const block = cell.blocks.find((b) => b.footprintId === state.footprintId);
      return t('resize.would', {
        name: block?.name ?? '',
        units: preview.units,
        team: cell.teamName,
        quarter: cell.quarterId,
        percent: preview.percent ?? 0,
      });
    },
    [board],
  );

  const commitResize = useCallback(
    (footprintId: string, teamId: string, quarterId: string, units: number) => {
      if (!board) return;
      const cell = findCell(board, teamId, quarterId as QuarterId);
      if (!cell) return;

      const preview = previewResize(cell, footprintId, units);
      if (!preview.allowed) {
        announce(t('resize.refused'));
        return;
      }

      const block = cell.blocks.find((b) => b.footprintId === footprintId);
      if (!block || preview.units === block.units) return;

      void resizeFootprint(footprintId, preview.units).then((ok) => {
        if (ok) announce(t('resize.to', { name: block.name, units: preview.units }));
      });
    },
    [board, resizeFootprint, announce],
  );

  const { resizing, begin: beginResize } = useResize({
    onPreview: (state) => {
      const message = describeResize(state);
      if (message) announce(message);
    },
    onCommit: (state) =>
      commitResize(state.footprintId, state.teamId, state.quarterId, state.units),
  });

  // ── Running work across quarters ───────────────────────────────────────
  //
  // The top edge of a block says how much of a quarter the work takes; the
  // sides say how many quarters it takes it for. A footprint is what this team
  // spends on this work in *this* quarter, so reaching further copies the
  // amount rather than dividing it — three quarters of work costs three
  // quarters, and every cell it reaches redraws while the pointer is down.

  /** The gesture's state, as the pure model wants it. */
  const toSpanDrag = (spanState: SpanState): SpanDrag => ({
    footprintId: spanState.footprintId,
    commitmentId: spanState.commitmentId,
    name: spanState.name,
    teamId: spanState.teamId,
    quarterId: spanState.quarterId as QuarterId,
    units: spanState.units,
    edge: spanState.edge,
  });

  const describeSpan = useCallback(
    (spanState: SpanState): string => {
      if (!board) return '';
      const preview = previewSpan(board, toSpanDrag(spanState), spanState.toQuarterId as QuarterId);
      if (preview.refusal) return t(`span.no.${preview.refusal}`);
      if (!preview.allowed) return t('span.unchanged', { name: spanState.name });
      return preview.added.length > 0
        ? t('span.wouldReach', {
            name: spanState.name,
            count: preview.covered.length,
            // Inflected by its own key: one string cannot carry two
            // independent plurals, and "1 units" is a defect a reader sees.
            units: t('capacity.units', { units: preview.unitsDelta }),
          })
        : t('span.wouldRetract', {
            name: spanState.name,
            count: preview.covered.length,
            units: t('capacity.units', { units: -preview.unitsDelta }),
          });
    },
    [board],
  );

  const { spanning, begin: beginSpan } = useSpan({
    announce,
    describe: describeSpan,
    onCancel: (spanState) => announce(t('drop.cancelled', { name: spanState.name })),
    onCommit: (spanState) => {
      if (!board || !state) return;
      const preview = previewSpan(board, toSpanDrag(spanState), spanState.toQuarterId as QuarterId);
      if (!preview.allowed) return;

      void stretchFootprint({
        commitmentId: spanState.commitmentId,
        teamId: spanState.teamId,
        units: spanState.units,
        add: preview.added,
        // The footprints the retracted quarters hold, resolved here while the
        // board still describes them.
        remove: preview.removed.flatMap((quarterId) => {
          const cell = findCell(board, spanState.teamId, quarterId as QuarterId);
          const block = cell?.blocks.find((b) => b.commitmentId === spanState.commitmentId);
          return block ? [block.footprintId] : [];
        }),
      }).then((ok: boolean) => {
        if (!ok) return;
        announce(t('span.reached', { name: spanState.name, count: preview.covered.length }));
      });
    },
  });

  /** What the board row being stretched would gain and lose, for the preview. */
  const spanPreview = useMemo(() => {
    if (!spanning || !board) return null;
    const preview = previewSpan(board, toSpanDrag(spanning), spanning.toQuarterId as QuarterId);
    return {
      teamId: spanning.teamId,
      added: preview.added as readonly string[],
      removed: preview.removed as readonly string[],
    };
  }, [spanning, board]);

  /**
   * The keyboard half: one quarter at a time, on the same edges the pointer can
   * grab. It runs the same `previewSpan` and the same command, so the two paths
   * cannot come to different answers about what a reach means.
   */
  const onSpanStep = useCallback(
    (footprintId: string, teamId: string, quarterId: string, edge: SpanEdge, direction: 1 | -1) => {
      if (!board) return;
      const block = findCell(board, teamId, quarterId as QuarterId)?.blocks.find(
        (candidate) => candidate.footprintId === footprintId,
      );
      if (!block) return;

      const run = spanOf(board, teamId, block.commitmentId, quarterId as QuarterId);
      const at = board.quarters.indexOf(
        (edge === 'START' ? run[0] : run[run.length - 1]) as QuarterId,
      );
      const to = board.quarters[at + direction];
      if (!to) {
        announce(t('span.no.OUTSIDE_HORIZON'));
        return;
      }

      const drag: SpanDrag = {
        footprintId,
        commitmentId: block.commitmentId,
        name: block.name,
        teamId,
        quarterId: quarterId as QuarterId,
        units: block.units,
        edge,
      };
      const preview = previewSpan(board, drag, to);
      if (!preview.allowed) {
        announce(
          preview.refusal
            ? t(`span.no.${preview.refusal}`)
            : t('span.unchanged', { name: block.name }),
        );
        return;
      }

      void stretchFootprint({
        commitmentId: block.commitmentId,
        teamId,
        units: block.units,
        add: preview.added,
        remove: preview.removed.flatMap((removedQuarter) => {
          const cell = findCell(board, teamId, removedQuarter as QuarterId);
          const held = cell?.blocks.find((b) => b.commitmentId === block.commitmentId);
          return held ? [held.footprintId] : [];
        }),
      }).then((ok: boolean) => {
        if (ok) {
          announce(t('span.reached', { name: block.name, count: preview.covered.length }));
        }
      });
    },
    [board, stretchFootprint, announce],
  );

  /**
   * The keyboard half of dragging a block up or down its container's stack.
   * Same command, so the two paths cannot disagree about what an order means.
   */
  const onReorderStep = useCallback(
    (footprintId: string, teamId: string, quarterId: string, direction: 1 | -1) => {
      const cell = findCell(board!, teamId, quarterId as QuarterId);
      if (!cell) return;
      const order = cell.blocks.map((block) => block.footprintId);
      const from = order.indexOf(footprintId);
      const to = from + direction;
      if (from === -1 || to < 0 || to >= order.length) {
        announce(t('order.atEnd'));
        return;
      }
      const moved = cell.blocks[from]!;
      order.splice(from, 1);
      order.splice(to, 0, footprintId);
      void reorderFootprints(teamId, quarterId, order).then((ok) => {
        if (ok) announce(t('order.moved', { name: moved.name, position: to + 1 }));
      });
    },
    [board, reorderFootprints, announce],
  );

  const onSpanStart = useCallback(
    (
      footprintId: string,
      teamId: string,
      quarterId: string,
      edge: SpanEdge,
      event: React.PointerEvent,
    ) => {
      const block = board?.rows
        .flatMap((row) => row.cells)
        .flatMap((cell) => cell.blocks)
        .find((candidate) => candidate.footprintId === footprintId);
      if (!block) return;
      beginSpan(
        {
          footprintId,
          commitmentId: block.commitmentId,
          name: block.name,
          teamId,
          quarterId,
          units: block.units,
          edge,
        },
        event,
      );
    },
    [board, beginSpan],
  );

  /*
   * Focus lands once the block is actually drawn — the command has to round
   * trip through the repository and the projection first, so there is nothing
   * to focus at the moment the drop is applied.
   */
  useEffect(() => {
    if (!justPlaced || !board) return;
    const { commitmentId, teamId, quarterId } = justPlaced;

    const cell = document.querySelector(
      `[data-drop-team="${CSS.escape(teamId)}"][data-drop-quarter="${CSS.escape(quarterId)}"]`,
    );
    const element = cell?.querySelector<SVGGElement>(
      `[data-commitment="${CSS.escape(commitmentId)}"]`,
    );
    if (!element) return;

    setJustPlaced(null);
    const placedBlock = findCell(board, teamId, quarterId as QuarterId)?.blocks.find(
      (candidate) => candidate.commitmentId === commitmentId,
    );
    if (placedBlock) select(placedBlock.footprintId);
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [justPlaced, board, select]);

  /**
   * What the panel shows. Driven by the focused commitment rather than a
   * separate selection: the thing you are looking at on the board and the thing
   * the panel describes must not be able to differ.
   */
  const panelCommitment = focusedCommitmentId
    ? (state?.commitments.get(focusedCommitmentId) ?? null)
    : null;

  const panelFootprints = useMemo((): PanelFootprint[] => {
    if (!state || !board || !panelCommitment) return [];
    return [...state.footprints.values()]
      .filter((f) => f.commitmentId === panelCommitment.id && f.archivedAt === undefined)
      .map((footprint) => {
        const cell = findCell(board, footprint.teamId, footprint.quarterId);
        return {
          footprint,
          teamName: cell?.teamName ?? footprint.teamId,
          percentAfter: cell?.summary ? utilisationPercent(cell.summary) : null,
        };
      });
  }, [state, board, panelCommitment]);

  /**
   * The gate, for work that has not passed it. Uses the same pure assessment
   * the handler runs, so the checklist and the refusal cannot disagree.
   */
  const panelGate = useMemo(() => {
    if (!state || !board || !panelCommitment || panelCommitment.lifecycle !== 'IDEA') return null;

    const footprints = [...state.footprints.values()];
    const readiness = assessCommitGate({
      commitment: panelCommitment,
      footprints,
      hasProductImpact: [...(state.productImpacts?.values() ?? [])].some(
        (impact) => impact.commitmentId === panelCommitment.id && impact.archivedAt === undefined,
      ),
      dependenciesReviewed: false,
      largeThreshold: state.workspace.settings.capacity.sizeMapping.L,
    });

    // What committing would do to capacity. Stated, never used to block.
    const own = footprints.filter(
      (f) => f.commitmentId === panelCommitment.id && f.archivedAt === undefined,
    );
    const overflow = own.reduce((worst, footprint) => {
      const cell = findCell(board, footprint.teamId, footprint.quarterId);
      return Math.max(worst, cell?.summary?.overflow ?? 0);
    }, 0);

    const overflowingCells = new Set(
      own
        .filter(
          (footprint) =>
            (findCell(board, footprint.teamId, footprint.quarterId)?.summary?.overflow ?? 0) > 0,
        )
        .map((footprint) => `${footprint.teamId}:${footprint.quarterId}`),
    );
    const candidates = [...state.footprints.values()].filter(
      (footprint) =>
        footprint.archivedAt === undefined &&
        overflowingCells.has(`${footprint.teamId}:${footprint.quarterId}`),
    );
    const constrained: { name: string; reason: 'MANDATORY' | 'IN_DELIVERY' | 'HARD_DEPENDENCY' }[] =
      [];
    const movable: { name: string; units: number; earliestAlternativeQuarter?: string }[] = [];
    const crossTeam: { name: string; team: string; quarter: string }[] = [];
    for (const footprint of candidates) {
      const commitment = state.commitments.get(footprint.commitmentId);
      if (!commitment || commitment.id === panelCommitment.id) continue;
      const hardDependency = [...(state.dependencies?.values() ?? [])].some(
        (dependency) =>
          dependency.sourceCommitmentId === commitment.id &&
          dependency.isHard &&
          dependency.status === 'OPEN' &&
          dependency.archivedAt === undefined,
      );
      const reason =
        commitment.class === 'MANDATORY'
          ? ('MANDATORY' as const)
          : commitment.lifecycle === 'IN_DELIVERY'
            ? ('IN_DELIVERY' as const)
            : hardDependency
              ? ('HARD_DEPENDENCY' as const)
              : null;
      if (reason) constrained.push({ name: commitment.name, reason });
      else if (commitment.lifecycle === 'COMMITTED') {
        const earliestAlternativeQuarter = board.quarters
          .slice(board.quarters.indexOf(footprint.quarterId) + 1)
          .find(
            (quarterId) =>
              (findCell(board, footprint.teamId, quarterId)?.summary?.headroom ?? 0) >=
              footprint.units,
          );
        movable.push({
          name: commitment.name,
          units: footprint.units,
          ...(earliestAlternativeQuarter ? { earliestAlternativeQuarter } : {}),
        });
        for (const team of state.teams.values()) {
          if (team.archivedAt !== undefined || !team.active || team.id === footprint.teamId)
            continue;
          const alternative = findCell(board, team.id, footprint.quarterId);
          if ((alternative?.summary?.headroom ?? 0) >= footprint.units) {
            crossTeam.push({
              name: commitment.name,
              team: team.name,
              quarter: footprint.quarterId,
            });
          }
        }
      }
    }
    const products = [...(state.productImpacts?.values() ?? [])]
      .filter(
        (impact) => impact.archivedAt === undefined && impact.commitmentId === panelCommitment.id,
      )
      .map((impact) => ({
        product: state.products?.get(impact.productServiceId)?.name ?? impact.productServiceId,
        impact: impact.type,
      }));
    const dependencies = [...(state.dependencies?.values() ?? [])]
      .filter(
        (dependency) =>
          dependency.archivedAt === undefined &&
          (dependency.sourceCommitmentId === panelCommitment.id ||
            (dependency.target.kind === 'COMMITMENT' &&
              dependency.target.id === panelCommitment.id)),
      )
      .map((dependency) => ({
        commitment:
          dependency.sourceCommitmentId === panelCommitment.id
            ? (state.commitments.get(
                dependency.target.kind === 'COMMITMENT' ? dependency.target.id : '',
              )?.name ?? dependency.target.id)
            : (state.commitments.get(dependency.sourceCommitmentId)?.name ??
              dependency.sourceCommitmentId),
        direction:
          dependency.sourceCommitmentId === panelCommitment.id
            ? ('OUTBOUND' as const)
            : ('INBOUND' as const),
      }));
    return {
      readiness,
      overflow,
      tradeoff: { constrained, movable, crossTeam, products, dependencies },
    };
  }, [state, board, panelCommitment]);

  /** The relations that belong to whatever the panel is showing. */
  const panelRelations = useMemo(() => {
    const id = panelCommitment?.id;
    const of = <T extends { commitmentId?: string }>(map: ReadonlyMap<string, T> | undefined) =>
      [...(map?.values() ?? [])].filter(
        (row) =>
          row.commitmentId === id && (row as { archivedAt?: string }).archivedAt === undefined,
      );

    return {
      impacts: of(state?.productImpacts),
      milestones: of(state?.milestones).sort((a, b) => a.displayOrder - b.displayOrder),
      links: of(state?.externalLinks),
      dependencies: [...(state?.dependencies?.values() ?? [])].filter(
        (d) => d.sourceCommitmentId === id && d.archivedAt === undefined,
      ),
    };
  }, [state, panelCommitment]);

  /**
   * The workspace's themes, and which of them this commitment carries.
   *
   * Both come from the join table rather than from the commitment, because a
   * theme is a portfolio-wide taxonomy: the same label has to mean the same
   * thing on every piece of work, which it cannot if each one owns its own copy.
   */
  const panelThemes = useMemo(() => {
    const id = panelCommitment?.id;
    return {
      all: [...(state?.themes?.values() ?? [])]
        .filter((theme) => theme.archivedAt === undefined)
        .sort((a, b) => a.name.localeCompare(b.name)),
      selected: [...(state?.commitmentThemes?.values() ?? [])]
        .filter((join) => join.commitmentId === id && join.archivedAt === undefined)
        .map((join) => join.themeId),
    };
  }, [state, panelCommitment]);

  /** A dependency can point at four different kinds of thing. */
  const nameOfTarget = useCallback(
    (target: { kind: string; id: string }): string => {
      switch (target.kind) {
        case 'COMMITMENT':
          return state?.commitments.get(target.id)?.name ?? target.id;
        case 'TEAM':
          return state?.teams.get(target.id)?.name ?? target.id;
        case 'MILESTONE':
          return state?.milestones?.get(target.id)?.name ?? target.id;
        case 'DECISION':
          return state?.decisions?.get(target.id)?.name ?? target.id;
        default:
          return target.id;
      }
    },
    [state],
  );

  /**
   * Dependencies of the focused commitment, resolved to places on the board.
   *
   * A dependency on a decision or a milestone has no cell to point at; it is
   * listed in the panel and simply not drawn, rather than being aimed at
   * something arbitrary.
   */
  const dependencyEdges = useMemo((): DependencyEdge[] => {
    if (!state || !board || !focusedCommitmentId) return [];

    const cellsOf = (commitmentId: string) =>
      [...state.footprints.values()]
        .filter((f) => f.commitmentId === commitmentId && f.archivedAt === undefined)
        .map((f) => `${f.teamId}|${f.quarterId}`);

    const from = cellsOf(focusedCommitmentId)[0];
    if (!from) return [];

    return [...(state.dependencies?.values() ?? [])]
      .filter((d) => d.sourceCommitmentId === focusedCommitmentId && d.archivedAt === undefined)
      .map((dependency) => {
        const target = dependency.target;
        const to =
          target.kind === 'COMMITMENT'
            ? (cellsOf(target.id)[0] ?? null)
            : target.kind === 'TEAM'
              ? `${target.id}|${from.split('|')[1]}`
              : null;

        return {
          id: dependency.id,
          type: dependency.type,
          status: dependency.status,
          isHard: dependency.isHard,
          fromCellKey: from,
          toCellKey: to,
          targetName: nameOfTarget(target),
        };
      });
  }, [state, board, focusedCommitmentId, nameOfTarget]);

  /**
   * Milestones by commitment, so the board can draw them without a lookup per
   * block. Sorted the way the panel lists them, so the order a lead learns in
   * one place is the order they see in the other.
   */
  const milestonesByCommitment = useMemo(() => {
    const out = new Map<string, Milestone[]>();
    for (const milestone of state?.milestones?.values() ?? []) {
      if (milestone.archivedAt !== undefined) continue;
      const list = out.get(milestone.commitmentId) ?? [];
      list.push(milestone);
      out.set(milestone.commitmentId, list);
    }
    for (const list of out.values()) list.sort((a, b) => a.displayOrder - b.displayOrder);
    return out;
  }, [state]);

  /**
   * Every refinement reserve on the board, as somewhere an Idea can be attached.
   *
   * Bounded to the horizon the board is showing: a list of every team-quarter
   * that ever existed is a scroll, not a choice.
   */
  const refinementReserves = useMemo(() => {
    if (!state || !board) return [];
    const quarters = new Set<string>(board.quarters);

    return [...state.teamQuarters.values()]
      .filter((tq) => tq.archivedAt === undefined && quarters.has(tq.quarterId))
      .flatMap((tq) =>
        tq.reserves
          .filter((reserve) => reserve.type === 'REFINEMENT')
          .map((reserve) => ({
            reserveId: reserve.id,
            teamId: tq.teamId,
            quarterId: tq.quarterId,
            label: `${state.teams.get(tq.teamId)?.name ?? tq.teamId} · ${tq.quarterId}`,
          })),
      )
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [state, board]);

  /** Names for the Ideas a refinement reserve supports. */
  const ideaNames = useMemo(() => {
    const out = new Map<string, string>();
    for (const commitment of state?.commitments.values() ?? []) {
      if (commitment.lifecycle === 'IDEA' && commitment.archivedAt === undefined) {
        out.set(commitment.id, commitment.name);
      }
    }
    return out;
  }, [state]);

  const vesselBlocksFor = useCallback(
    (cell: CellModel): VesselBlock[] => {
      if (!viewState) return [];
      return cell.blocks.flatMap((block) => {
        const footprint = viewState.footprints.get(block.footprintId);
        const commitment = viewState.commitments.get(block.commitmentId);
        if (!footprint || !commitment) return [];
        const milestones = milestonesByCommitment.get(commitment.id);
        const health = signals.health.get(commitment.id);
        return [
          {
            footprint,
            commitment,
            counted: isCounted(footprint, commitment, viewState.workspace.currentQuarterId),
            // Computed by the board model, which can see the whole row.
            continuesBefore: block.continuesBefore,
            continuesAfter: block.continuesAfter,
            ...(selectedScenarioId !== null && commitment.lifecycle === 'IDEA'
              ? { scenarioGhost: true }
              : {}),
            ...(milestones ? { milestones } : {}),
            ...(health ? { health } : {}),
          },
        ];
      });
    },
    [viewState, milestonesByCommitment, signals.health, selectedScenarioId],
  );

  if (!state || !board) {
    return (
      <main className="fm-shell">
        <p className="fm-empty">Loading workspace…</p>
      </main>
    );
  }

  const teams = [...state.teams.values()].filter((team) => team.archivedAt === undefined);
  const ideas = [...state.commitments.values()].filter(
    (c) => c.archivedAt === undefined && c.lifecycle === 'IDEA',
  );
  const scenarios = [...(state.scenarios?.values() ?? [])]
    .filter((scenario) => scenario.archivedAt === undefined)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const exportRows = allBlocks(board).map((block) => ({
    commitment: block.name,
    lifecycle: block.lifecycle,
    team: block.cell.teamName,
    quarter: block.cell.quarterId,
    units: block.units,
  }));

  useEffect(() => {
    if (
      selectedScenarioId !== null &&
      !scenarios.some((scenario) => scenario.id === selectedScenarioId)
    ) {
      setSelectedScenarioId(null);
    }
  }, [scenarios, selectedScenarioId]);

  return (
    <div
      className="fm-shell"
      data-lens={activeLens}
      data-presentation={presentationMode || undefined}
    >
      <header className="fm-header">
        <h1 className="fm-header__brand">
          <FlowmapMark />
          <span>{t('app.name')}</span>
        </h1>
        <WorkspaceSwitcher
          workspaces={workspaces}
          archivedWorkspaces={archivedWorkspaces}
          activeWorkspaceId={activeWorkspaceId}
          timezone={state.workspace.timezone}
          onSwitch={(workspaceId) => void switchWorkspace(workspaceId)}
          onCreate={(name, location) =>
            void createWorkspace(name, state.workspace.timezone, location)
          }
          onArchive={() => void archiveActiveWorkspace()}
          onRestore={(workspaceId) => void restoreArchivedWorkspace(workspaceId)}
        />
        <div className="fm-header__tools" role="group" aria-label={t('header.tools')}>
          {runtime && (
            <PortabilityPanel
              state={state}
              events={events}
              profileName={profileName}
              now={runtime.now}
              rows={exportRows}
              radarRows={signals.visible.map((signal) => ({
                rule: signal.ruleCode,
                severity: signal.severity,
                entity: signal.entityRef.kind,
                due: signal.dueOn ?? '',
              }))}
              onImportWorkspace={importWorkspacePackage}
              onImportWorkspaceJson={importWorkspaceJson}
              onImportedIdeas={importIdeas}
              savedMappings={state.workspace.settings.importMappings ?? []}
              onSaveMapping={saveImportMapping}
              notificationSettings={
                state.workspace.settings.notifications ?? { mode: 'MY_ACTIONS' }
              }
              onNotificationSettings={setNotificationSettings}
              announce={announce}
            />
          )}
          <SavedViews
            views={state.workspace.settings.savedViews ?? []}
            onSave={(name) =>
              void saveView({
                name,
                lens: activeLens,
                filters: {
                  quarters: filter.quarters,
                  teams: filter.teams,
                  lifecycles: filter.lifecycles,
                  classes: filter.classes,
                },
              })
            }
            onApply={(view) => {
              setActiveLens(view.lens as ActiveLens);
              setFilter({
                ...NO_FILTER,
                quarters: (view.filters['quarters'] ?? []) as FilterState['quarters'],
                teams: (view.filters['teams'] ?? []) as FilterState['teams'],
                lifecycles: (view.filters['lifecycles'] ?? []) as FilterState['lifecycles'],
                classes: (view.filters['classes'] ?? []) as FilterState['classes'],
              });
              announce(t('savedViews.applied', { name: view.name }));
            }}
            onRemove={(viewId) => void removeSavedView(viewId)}
          />
          <SnapshotsPanel
            snapshots={snapshots}
            onCreate={() => void createSnapshot()}
            onRestore={(id, confirmation) => void restoreSnapshot(id, confirmation)}
          />
        </div>
        <span className="fm-header__spacer" />
        <div className="fm-header__status">
          <ThemeToggle />
          <button
            type="button"
            className="fm-header__action"
            aria-pressed={showSettings}
            onClick={() => setShowSettings(true)}
          >
            {t('settings.open')}
          </button>
          <SyncStatus
            status={syncStatus}
            onSync={() => void syncNow()}
            onOpenConflicts={() => setShowConflicts(true)}
          />
          <span>{profileName}</span>
        </div>
      </header>

      {status && (
        <div
          className={`fm-banner fm-banner--${status.tone}`}
          role={status.tone === 'critical' ? 'alert' : 'status'}
        >
          <span>{status.message}</span>
          <button type="button" onClick={clearStatus}>
            Dismiss
          </button>
        </div>
      )}
      {state.teams.size === 0 && state.commitments.size === 0 && welcome && (
        <FirstRunGuide
          onExploreSample={() => {
            const sampleId = workspaces.find((workspace) => workspace.isSample)?.id;
            if (sampleId) void switchWorkspace(sampleId);
            else void loadSample();
            setWelcome(false);
          }}
          onDismiss={() => setWelcome(false)}
        />
      )}

      <div className="fm-controlbar fm-editing-chrome">
        <nav className="fm-lens-nav" aria-label={t('lens.switch')}>
          {LENSES.map((lens, index) => (
            <button
              key={lens}
              type="button"
              aria-pressed={activeLens === lens}
              onClick={() => setActiveLens(lens)}
            >
              <kbd>{index + 1}</kbd> {t(`lens.${lens}`)}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={activeLens === 'HISTORY'}
            onClick={() => setActiveLens('HISTORY')}
          >
            {t('lens.history')}
          </button>
        </nav>
        <LensStrip
          filter={filter}
          focusedName={focusedName}
          teamNames={new Map([...state.teams.values()].map((tm) => [tm.id, tm.name]))}
          onRemoveChip={(key) => setFilter((f) => removeChip(f, key))}
          onClearFilters={() => setFilter(NO_FILTER)}
          onToggleHide={() => setFilter((f) => ({ ...f, hideFiltered: !f.hideFiltered }))}
          onClearFocus={() => setFocusedCommitmentId(null)}
        />
      </div>

      <ScenarioDock
        scenarios={scenarios}
        selectedId={selectedScenarioId}
        onSelect={setSelectedScenarioId}
        onCreate={() => {
          void createScenario().then((created) => {
            if (!created) return;
            const newest = [...(useWorkspace.getState().state?.scenarios?.values() ?? [])]
              .filter((scenario) => scenario.status === 'DRAFT' || scenario.status === 'SHARED')
              .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
            if (newest) setSelectedScenarioId(newest.id);
          });
        }}
        onDiscard={(scenarioId) => {
          void discardScenario(scenarioId).then((discarded) => {
            if (discarded) setSelectedScenarioId(null);
          });
        }}
        onApply={(scenarioId, selectedCommandIds) => {
          void applyScenario(scenarioId, selectedCommandIds).then((applied) => {
            if (applied) setSelectedScenarioId(null);
          });
        }}
        onShare={(scenarioId) => void shareScenario(scenarioId)}
        onClone={(scenarioId) => {
          void cloneScenario(scenarioId).then((cloned) => {
            if (!cloned) return;
            const newest = [...(useWorkspace.getState().state?.scenarios?.values() ?? [])]
              .filter((scenario) => scenario.status === 'DRAFT')
              .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
            if (newest) setSelectedScenarioId(newest.id);
          });
        }}
        onRebase={(scenarioId, resolutions) => void rebaseScenario(scenarioId, resolutions)}
        {...(scenarioDiff ? { summary: scenarioDiff.summary } : {})}
        {...(scenarioDiff ? { diff: scenarioDiff } : {})}
        {...(scenarioRebase ? { rebase: scenarioRebase } : {})}
      />

      {!presentationMode && (
        <CaptureBar
          teams={teams.map((team) => ({ id: team.id, name: team.name }))}
          ideas={ideas.map((c) => ({ id: c.id, name: c.name }))}
          currentQuarter={state.workspace.currentQuarterId}
          showList={showList}
          onToggleList={() => setShowList((v) => !v)}
          onUndo={() => void undo()}
          onRedo={() => void redo()}
          radarCount={signals.visible.length}
          highCount={signals.visible.filter((signal) => signal.severity === 'HIGH').length}
          showRadar={showRadar}
          onToggleRadar={() => {
            setShowRadar((open) => !open);
            setShowRuleSettings(false);
          }}
          showRules={showRuleSettings}
          onToggleRules={() => {
            setShowRuleSettings((open) => !open);
            setShowRadar(false);
          }}
          showResetSample={state.workspace.isSample}
        />
      )}

      {activeLens === 'QBR' && (
        <QbrView
          state={viewState ?? state!}
          filter={filter}
          scenarioId={selectedScenarioId}
          defaultUnits={defaultDropUnits(state.workspace.settings.capacity.sizeMapping)}
          onPlace={(input) => {
            if (selectedScenarioId !== null) {
              void placeScenarioIdea({ scenarioId: selectedScenarioId, ...input });
            }
          }}
          onOpen={setFocusedCommitmentId}
        />
      )}

      {activeLens === 'TIMELINE' && (
        <TimelineView state={viewState ?? state!} onOpen={setFocusedCommitmentId} filter={filter} />
      )}
      {activeLens === 'DEPENDENCIES' && (
        <DependencyMapView
          state={viewState ?? state!}
          onOpen={setFocusedCommitmentId}
          filter={filter}
        />
      )}
      {activeLens === 'PRODUCTS' && (
        <ProductsView state={viewState ?? state!} onOpen={setFocusedCommitmentId} filter={filter} />
      )}
      {activeLens === 'THEMES' && (
        <ThemesView state={viewState ?? state!} onOpen={setFocusedCommitmentId} filter={filter} />
      )}
      {activeLens === 'TEAMS' && (
        <TeamsView
          state={viewState ?? state!}
          filter={filter}
          onOpenCell={(teamId, quarterId) => {
            setReveal({ teamId, quarterId });
            setActiveLens('PORTFOLIO');
          }}
          onArchiveTeam={(teamId) => {
            const team = state?.teams.get(teamId);
            if (!team) return;
            setPendingConfirm({ kind: 'archiveTeam', teamId, name: team.name });
          }}
          onOpenTeamSettings={setTeamSettingsFor}
        />
      )}
      {activeLens === 'ATTENTION' && (
        <AttentionView
          signals={signals.visible}
          today={signals.today}
          ownedRefs={signals.ownedRefs}
          filter={filter}
          onOpen={(signal) =>
            actOnSignal(signal, { kind: 'OPEN', ref: signal.entityRef, labelKey: 'open' })
          }
        />
      )}
      {activeLens === 'HISTORY' && (
        <HistoryView
          state={state}
          events={events}
          recommendations={signals.all.filter((signal) => signal.category === 'HISTORY')}
          onCloseQuarter={(outcomes, carryOver) =>
            void closeQuarter({ quarterId: state.workspace.currentQuarterId, outcomes, carryOver })
          }
          onReopen={() => void reopenQuarter(state.workspace.currentQuarterId)}
          filter={filter}
        />
      )}

      {/* The board and its table companion share the shell's one scrollable
          region, so the rail and the grid can each keep a scroll of their own
          inside it. See the note on `.fm-shell[data-lens='PORTFOLIO']`. */}
      <div className="fm-body">
        {activeLens === 'PORTFOLIO' && (
          <div className="fm-workspace">
            <IdeasLane
              ideas={board.ideas}
              readiness={readiness}
              refinementReserves={refinementReserves}
              onLinkRefinement={(reserveId, commitmentId) =>
                void linkIdeaToRefinement(reserveId, commitmentId)
              }
              onUnlinkRefinement={(reserveId, commitmentId) =>
                void unlinkIdeaFromRefinement(reserveId, commitmentId)
              }
              selectedCommitmentId={focusedCommitmentId}
              draggingCommitmentId={placement?.payload.commitmentId ?? null}
              dropState={
                placement?.target?.kind === 'RAIL'
                  ? previewRemoval(placement.payload).allowed
                    ? 'ok'
                    : 'no'
                  : null
              }
              dropNote={
                placement?.target?.kind === 'RAIL'
                  ? describeDrag(placement.payload, placement.target)
                  : null
              }
              onSelect={(commitmentId) =>
                setFocusedCommitmentId((current) =>
                  current === commitmentId ? null : commitmentId,
                )
              }
              onPickUp={pickUpIdea}
              onDrop={(commitmentId) => {
                const idea = state?.commitments.get(commitmentId);
                if (!idea) return;
                setPendingConfirm({ kind: 'drop', commitmentId, name: idea.name });
              }}
              collapsed={railCollapsed}
              onToggleCollapsed={() => setRailCollapsed((was) => !was)}
              revealCommitmentId={
                reveal?.commitmentId !== undefined &&
                state?.commitments.get(reveal.commitmentId)?.lifecycle === 'IDEA'
                  ? reveal.commitmentId
                  : null
              }
            />

            <PortfolioMap
              board={board}
              level={level}
              focus={focus}
              filter={filter}
              selectedFootprintId={selectedFootprintId}
              vesselBlocksFor={vesselBlocksFor}
              onSelectBlock={(footprintId, commitmentId) => {
                select(footprintId);
                setFocusedCommitmentId((current) =>
                  current === commitmentId ? null : commitmentId,
                );
              }}
              // Selecting a cell used to toggle filters, which quietly stacked up
              // until the board was unreadable. Until the detail panel exists
              // (M2-COM-2), selecting a cell does nothing but move the cursor.
              onSelectCell={() => undefined}
              onFilterTeam={(teamId) => setFilter((f) => toggleFilterValue(f, 'teams', teamId))}
              onFilterQuarter={(quarterId) =>
                setFilter((f) => toggleFilterValue(f, 'quarters', quarterId))
              }
              onAnnounce={announce}
              dragging={placement?.payload ?? null}
              dragTarget={placement?.target ?? null}
              onPickUpBlock={pickUpBlock}
              onRemoveBlock={removeBlock}
              onResizeBlock={(footprintId, teamId, quarterId, units) =>
                commitResize(footprintId, teamId, quarterId, clampUnits(units))
              }
              onResizeStart={(input, event) => beginResize(input, event)}
              onSpanStart={onSpanStart}
              onSpanStep={onSpanStep}
              onReorderStep={onReorderStep}
              spanning={spanPreview}
              resizing={
                resizing ? { footprintId: resizing.footprintId, units: resizing.units } : null
              }
              onAimDrag={(teamId, quarterId) => aim({ kind: 'CELL', teamId, quarterId })}
              onLinkFrom={linkFrom}
              scale={scale}
              onWheelZoom={onWheelZoom}
              onDropHere={drop}
              dependencyEdges={dependencyEdges}
              onMoveRow={(teamId, direction) => void moveTeamRow(teamId, direction)}
              onArchiveTeam={(teamId) => {
                const team = state?.teams.get(teamId);
                if (!team) return;
                setPendingConfirm({ kind: 'archiveTeam', teamId, name: team.name });
              }}
              busyTeamIds={busyTeamIds}
              ideaNames={ideaNames}
              reveal={reveal}
            />

            {showRadar && (
              <Radar
                signals={signals.visible}
                allSignals={signals.all}
                dispositions={signals.dispositions}
                ownedRefs={signals.ownedRefs}
                today={signals.today}
                mode={radarMode}
                onModeChange={setRadarMode}
                onAct={actOnSignal}
                onReview={(signal) =>
                  void reviewSignal({
                    signalKey: signal.signalKey,
                    atFingerprint: signal.conditionFingerprint,
                    atSeverity: signal.severity,
                  })
                }
                onSnooze={(signal, until) =>
                  void snoozeSignal({
                    signalKey: signal.signalKey,
                    atFingerprint: signal.conditionFingerprint,
                    atSeverity: signal.severity,
                    snoozeUntil: until,
                  })
                }
                onClear={(signal) => void clearSignal(signal.signalKey)}
                onClose={() => setShowRadar(false)}
              />
            )}

            {showRuleSettings && (
              <RuleSettings
                settings={ruleSettings}
                counts={countByRule(signals.all)}
                onChange={setRuleSettings}
                onClose={() => setShowRuleSettings(false)}
              />
            )}

            {/* Inside the workspace row, not floating over it: the board narrows
              rather than being hidden. Editing a field and watching the figure
              move is the point, and a panel covering the board defeats it. */}
            {panelCommitment && state && !presentationMode && (
              <DetailPanel
                commitment={panelCommitment}
                health={signals.health.get(panelCommitment.id) ?? 'OK'}
                healthSignals={signals.all.filter(
                  (signal) =>
                    signal.surfaces.includes('HEALTH') &&
                    signal.entityRef.kind === 'COMMITMENT' &&
                    signal.entityRef.id === panelCommitment.id,
                )}
                teams={teams}
                products={[...(state.products?.values() ?? [])]}
                people={[...(state.people?.values() ?? [])]}
                footprints={panelFootprints}
                quarters={board.quarters}
                currentQuarterId={state.workspace.currentQuarterId}
                impacts={panelRelations.impacts}
                valueDrivers={state.workspace.settings.valueDrivers}
                themes={panelThemes.all}
                commitmentThemeIds={panelThemes.selected}
                milestones={panelRelations.milestones}
                links={panelRelations.links}
                dependencies={panelRelations.dependencies}
                nameOfTarget={nameOfTarget}
                onChange={(patch) => void editCommitment(panelCommitment.id, patch)}
                onSetImpact={(productServiceId, type) =>
                  void relate('SetProductImpact', (rs, cmd, ctx) =>
                    setProductImpact(
                      rs,
                      { commitmentId: panelCommitment.id, productServiceId, type },
                      cmd,
                      ctx,
                    ),
                  )
                }
                onRemoveImpact={(impactId) =>
                  void relate('RemoveProductImpact', (rs, cmd, ctx) =>
                    removeProductImpact(rs, { impactId }, cmd, ctx),
                  )
                }
                onAddMilestone={(name) =>
                  void relate('AddMilestone', (rs, cmd, ctx) =>
                    addMilestone(rs, { commitmentId: panelCommitment.id, name }, cmd, ctx),
                  )
                }
                onRemoveMilestone={(milestoneId) =>
                  void relate('RemoveMilestone', (rs, cmd, ctx) =>
                    removeMilestone(rs, { milestoneId }, cmd, ctx),
                  )
                }
                onAddLink={(type, url, label) =>
                  void relate('AddExternalLink', (rs, cmd, ctx) =>
                    addExternalLink(
                      rs,
                      {
                        commitmentId: panelCommitment.id,
                        type,
                        url,
                        ...(label ? { label } : {}),
                      },
                      cmd,
                      ctx,
                    ),
                  )
                }
                onRemoveLink={(linkId) =>
                  void relate('RemoveExternalLink', (rs, cmd, ctx) =>
                    removeExternalLink(rs, { linkId }, cmd, ctx),
                  )
                }
                onSetDependencyType={(dependencyId, type) =>
                  void relate('UpdateDependency', (rs, cmd, ctx) =>
                    updateDependency(rs, { dependencyId, type }, cmd, ctx),
                  )
                }
                onRemoveDependency={(dependencyId) =>
                  void relate('RemoveDependency', (rs, cmd, ctx) =>
                    removeDependency(rs, { dependencyId }, cmd, ctx),
                  )
                }
                onSetThemes={(themeIds) => void setThemes(panelCommitment.id, themeIds)}
                onCreateTheme={(name) =>
                  void relate('CreateTheme', (rs, cmd, ctx) => createTheme(rs, { name }, cmd, ctx))
                }
                onSplit={(footprintId, toQuarterId, units) =>
                  void splitFootprint(footprintId, toQuarterId, units)
                }
                onOpenLink={(url) => void openLink(url)}
                onSetRecurrence={(recurrence) => void setRecurrence(panelCommitment.id, recurrence)}
                onRenew={() => void renewCommitment(panelCommitment.id)}
                onDrop={() =>
                  setPendingConfirm({
                    kind: 'drop',
                    commitmentId: panelCommitment.id,
                    name: panelCommitment.name,
                  })
                }
                gate={
                  panelGate
                    ? {
                        ...panelGate,
                        onCommit: () => void passGate(panelCommitment.id),
                      }
                    : null
                }
                onClose={() => setFocusedCommitmentId(null)}
              />
            )}
            <ZoomDock level={level} scale={scale} onLevel={setLevelState} onZoomBy={nudgeZoom} />
          </div>
        )}
        {showList && <ListCompanion board={board} filter={filter} />}
      </div>

      {/* The piece that follows the cursor. Small and quiet — the answer is on
          the board, not under the pointer. Positioned by `usePlacement` writing
          to this node's style, never through a render. */}
      {placement?.via === 'pointer' && (
        <div className="fm-carry" ref={carryRef} aria-hidden="true">
          {placement.payload.name} · {placement.payload.units}
        </div>
      )}

      {placement?.via === 'keyboard' && (
        <div className="fm-carry fm-carry--keyboard" aria-hidden="true">
          {t('drop.keyboardHint', { name: placement.payload.name })}
          <button type="button" onClick={cancel}>
            {t('drop.cancel')}
          </button>
        </div>
      )}

      {/* Capacity consequences reach a non-sighted user the moment they happen. */}
      <div className="fm-visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>

      {showPalette && (
        <CommandPalette
          onClose={() => setShowPalette(false)}
          onOpen={(id) => {
            setFocusedCommitmentId(id);
            setActiveLens('PORTFOLIO');
          }}
          onCreateIdea={(name) => void useWorkspace.getState().captureIdea(name)}
          onFilterQuarter={(quarter) =>
            setFilter((current) => toggleFilterValue(current, 'quarters', quarter as QuarterId))
          }
          onSearch={search}
        />
      )}
      {teamSettingsFor !== null && state && (
        <TeamCapacityDialog
          state={state}
          teamId={teamSettingsFor}
          onSave={(input) => {
            void setTeamDefaults(input);
            setTeamSettingsFor(null);
          }}
          onSaveQuarter={(teamQuarterId, reserves) =>
            void setTeamQuarterReserves(teamQuarterId, reserves)
          }
          onClose={() => setTeamSettingsFor(null)}
        />
      )}

      {showSettings && runtime && (
        <SettingsPanel
          runtime={runtime}
          shared={syncStatus?.providerId === 'FILE'}
          onClearLocalData={() => {
            setShowSettings(false);
            setConfirmClear(true);
          }}
          onClose={() => setShowSettings(false)}
          state={state}
          onSaveCapacityDefaults={(input) => void setCapacityDefaults(input)}
          onSaveTeamCapacity={(input) =>
            void setTeamDefaults({
              teamId: input.teamId,
              defaultQuarterCapacity: input.defaultQuarterCapacity,
              reserves: input.reserves,
              applyToOpenQuarters: input.applyToOpenQuarters,
            })
          }
          onSaveQuarterReserves={(teamQuarterId, reserves) =>
            void setTeamQuarterReserves(teamQuarterId, reserves)
          }
        />
      )}
      {showConflicts && (
        <ConflictResolver
          conflicts={conflicts}
          onResolve={(conflict, action, value) => void resolveConflict(conflict, action, value)}
          onClose={() => setShowConflicts(false)}
        />
      )}
      {showShortcuts && <ShortcutReference onClose={() => setShowShortcuts(false)} />}
      {confirmClear && (
        <ConfirmDialog
          title={t('settings.clear.title')}
          body={t('settings.clear.body')}
          confirmLabel={t('settings.clear.confirm')}
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            void clearLocalData();
          }}
        />
      )}
      {pendingConfirm?.kind === 'drop' && (
        <ConfirmDialog
          title={t('drop.confirm.title', { name: pendingConfirm.name })}
          body={t('drop.confirm.body')}
          confirmLabel={t('action.drop')}
          danger
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            const { commitmentId, name } = pendingConfirm;
            setPendingConfirm(null);
            void dropCommitment(commitmentId).then((ok) => {
              if (!ok) return;
              setFocusedCommitmentId((current) => (current === commitmentId ? null : current));
              announce(t('action.dropped', { name }));
            });
          }}
        />
      )}
      {pendingConfirm?.kind === 'archiveTeam' && (
        <ConfirmDialog
          title={t('team.archive.title', { name: pendingConfirm.name })}
          body={t('team.archive.body')}
          confirmLabel={t('action.archive')}
          danger
          onCancel={() => setPendingConfirm(null)}
          onConfirm={() => {
            const { teamId, name } = pendingConfirm;
            setPendingConfirm(null);
            void archiveTeam(teamId).then((ok) => {
              if (ok) announce(t('action.archived', { name }));
            });
          }}
        />
      )}
    </div>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function removeChip(filter: FilterState, key: string): FilterState {
  const [kind, ...rest] = key.split(':');
  const value = rest.join(':');

  switch (kind) {
    case 'quarter':
      return toggleFilterValue(filter, 'quarters', value as FilterState['quarters'][number]);
    case 'team':
      return toggleFilterValue(filter, 'teams', value);
    case 'lifecycle':
      return toggleFilterValue(filter, 'lifecycles', value as FilterState['lifecycles'][number]);
    case 'class':
      return toggleFilterValue(filter, 'classes', value as FilterState['classes'][number]);
    case 'text':
      return { ...filter, text: '' };
    default:
      return filter;
  }
}
