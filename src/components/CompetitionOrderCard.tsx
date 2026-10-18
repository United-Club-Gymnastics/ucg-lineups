// Copied from ucg-platform@e57754a src/components/CompetitionOrderCard.tsx — keep in sync by hand
// Changed: detached from the platform store, Supabase, toasts, event lock and people slices. It is now
// a controlled component: the page resolves `groups` / `sections` (club-order-model.ts) and passes them
// in with the roster (`athletes`) and `discipline`; every change comes back through `onChange` as the
// next groups + sections, plus `membershipChanged` (a move, split, add or remove of a group) so the page
// can mark the split as decided. `editable` replaces the lock logic (read-only after the order deadline).
// The Level <select>, "Set competition order" card shell and reconcile-and-persist effect are gone (the
// page owns levels, defaults and autosave).
// DEVIATION: the platform gives each group x apparatus column its own DndContext (no cross-group drag).
// Here ONE DndContext holds every group's list for the shown apparatus (one SortableContext per group,
// each group also a droppable), so an athlete can be dragged into another group: dropped on an athlete =
// that spot on this apparatus, dropped on the group (header/empty area) = appended. On every other
// apparatus the athlete goes first in the new group (moveAthleteToGroup + sectionsFromGroups). Only one
// apparatus is shown at a time (`apparatus` prop, default the first). The "→ B" buttons stay as the
// non-drag alternative. No arrow up/down buttons exist. Names come from `athletes`.
import { useState, type CSSProperties } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor,
  closestCenter, pointerWithin, rectIntersection, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import type {
  Announcements, CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent, ScreenReaderInstructions,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, sortableKeyboardCoordinates, type SortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { APPARATUS } from '../lib/apparatus';
import type { LinkAthlete } from '../lib/club-links';
import { dropAthlete } from '../lib/club-order-model';
import {
  sectionCap, computeDropIndex, dropLandingPosition,
  groupLetter, splitEvenly, groupsOverCap, sectionsFromGroups,
  moveAthleteToGroup, removeEmptyGroup,
  apparatusLookup, busiestApparatusCount, type ApparatusOf,
} from '../lib/competition-order';
import { Badge } from './ui';

export interface OrderChange {
  groups: string[][];
  sections: Record<string, string[][]>;
  /** True when athletes moved between groups (or groups were added, removed or auto-split). */
  membershipChanged: boolean;
}

/**
 * Club-facing "Set competition order" for ONE level. MAG/WAG only. The club splits its athletes into
 * GROUPS (capped 12 WAG / 15 MAG per apparatus) — the same athletes compete together on every apparatus —
 * and drags athletes into competing order on the shown apparatus, within a group or into another group.
 */
export function CompetitionOrderCard({
  athletes, discipline, groups, sections, editable, onChange, apparatus: onlyApparatus,
}: {
  athletes: LinkAthlete[];
  discipline: 'WAG' | 'MAG';
  /** Group membership (athlete ids); group index = group letter. */
  groups: string[][];
  /** Per apparatus code: `sections[code][k]` = group k's athletes on it, in competing order. */
  sections: Record<string, string[][]>;
  editable: boolean;
  onChange: (next: OrderChange) => void;
  /** The apparatus shown in every group (the page's event tabs). Default: the first one. */
  apparatus?: string;
}) {
  const cap = sectionCap(discipline);
  const apparatusOf = apparatusLookup(athletes);
  const nameById = new Map(athletes.map((a) => [a.id, `${a.first} ${a.last}`.trim()]));
  const nameOf = (id: string) => nameById.get(id) ?? 'Unknown athlete';
  const present = new Set(athletes.flatMap((a) => a.apparatus));
  const allCodes = APPARATUS[discipline].map((a) => a.code).filter((c) => present.has(c));
  const code = onlyApparatus && allCodes.includes(onlyApparatus) ? onlyApparatus : allCodes[0];
  const regIdsOn = (c: string) => athletes.filter((a) => a.apparatus.includes(c)).map((a) => a.id);
  const overCap = groupsOverCap(groups, cap, apparatusOf);

  /** Membership changed: rebuild every apparatus from `base` sections. */
  const changeGroups = (nextGroups: string[][], base: Record<string, string[][]> = sections) => {
    const next: Record<string, string[][]> = {};
    for (const c of allCodes) next[c] = sectionsFromGroups(nextGroups, regIdsOn(c), base[c]);
    onChange({ groups: nextGroups, sections: next, membershipChanged: true });
  };
  const moveTo = (id: string, toGroup: number) => changeGroups(moveAthleteToGroup(groups, id, toGroup));
  const addGroup = () => changeGroups([...groups, []]);
  const removeGroup = (index: number) => {
    const next = removeEmptyGroup(groups, index);
    if (!next) return;
    // Drop the (empty) section at the same index so later groups keep their own order.
    const base: Record<string, string[][]> = {};
    for (const c of allCodes) base[c] = (sections[c] ?? []).filter((_, i) => i !== index);
    changeGroups(next, base);
  };
  const autoSplit = () => changeGroups(splitEvenly(groups.flat(), cap, apparatusOf));

  // ---- one DndContext for every group's list on the shown apparatus ----
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const secs = code ? sections[code] ?? [] : [];
  const groupId = (i: number) => `${GROUP_PREFIX}${i}`;
  /** Resolve what the pointer is over: the group index and, for an athlete, which one. */
  const resolve = (over: string): { section: number; overId: string | null } | null => {
    if (over.startsWith(GROUP_PREFIX)) {
      const i = Number(over.slice(GROUP_PREFIX.length));
      return i >= 0 && i < secs.length ? { section: i, overId: null } : null;
    }
    const i = secs.findIndex((s) => s.includes(over));
    return i >= 0 ? { section: i, overId: over } : null;
  };
  const apparatusLabel = code ? apparatusName(discipline, code) : '';
  const where = (id: string, over: string): string | null => {
    const t = resolve(over);
    if (!t) return null;
    const { position, total } = dropLandingPosition(secs, id, t.section, t.overId ?? '', t.overId === null);
    return `position ${position} of ${total} on ${apparatusLabel}, Group ${groupLetter(t.section)}`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(String(active.id))}.`,
    onDragOver: ({ active, over }) => {
      const name = nameOf(String(active.id));
      const at = over ? where(String(active.id), String(over.id)) : null;
      return at ? `${name} moved to ${at}.` : `${name} is not over a group.`;
    },
    onDragEnd: ({ active, over }) => {
      const name = nameOf(String(active.id));
      const at = over ? where(String(active.id), String(over.id)) : null;
      return at ? `${name} dropped at ${at}.` : `${name} dropped.`;
    },
    onDragCancel: ({ active }) => `Moving ${nameOf(String(active.id))} was cancelled.`,
  };
  const clear = () => { setActiveId(null); setOverId(null); };
  const onDragStart = (evt: DragStartEvent) => { setActiveId(String(evt.active.id)); setOverId(String(evt.active.id)); };
  const onDragOver = (evt: DragOverEvent) => setOverId(evt.over ? String(evt.over.id) : null);
  const onDragEnd = (evt: DragEndEvent) => {
    clear();
    const { active, over } = evt;
    if (!editable || !over || !code) return;
    const id = String(active.id);
    if (String(over.id) === id) return;
    const target = resolve(String(over.id));
    if (!target) return;
    const result = dropAthlete(groups, sections, regIdsOn, code, id, target);
    if (result) onChange(result);
  };

  // Drop line: before `lineBefore` (an id of the target list minus the dragged athlete), or at the end when null.
  let lineSection = -1;
  let lineBefore: string | null = null;
  if (activeId && overId) {
    const t = resolve(overId);
    if (t) {
      const post = (secs[t.section] ?? []).filter((x) => x !== activeId);
      const at = computeDropIndex(secs, activeId, t.section, t.overId ?? '', t.overId === null);
      lineSection = t.section;
      lineBefore = at < post.length ? post[at] : null;
    }
  }

  if (athletes.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>No athletes at this level yet.</p>;
  }

  const body = groups.map((members, gi) => (
    <GroupBlock
      key={gi}
      droppableId={groupId(gi)}
      discipline={discipline}
      index={gi}
      groupCount={groups.length}
      members={members}
      cap={cap}
      apparatusOf={apparatusOf}
      code={code}
      regIds={code ? secs[gi] ?? [] : []}
      nameOf={nameOf}
      editable={editable}
      lineBefore={lineSection === gi ? lineBefore : undefined}
      onMove={moveTo}
      onRemove={() => removeGroup(gi)}
    />
  ));

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {overCap
          ? <Badge tone="err">Split required — max {cap} per event in a group</Badge>
          : <Badge tone="ok">Groups ready</Badge>}
        <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
          {athletes.length} athlete{athletes.length === 1 ? '' : 's'} in {groups.length} group{groups.length === 1 ? '' : 's'}
        </span>
        {editable && (
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
            <button type="button" className="btn small ghost" onClick={autoSplit}>Auto-split evenly</button>
            <button type="button" className="btn small ghost" onClick={addGroup}>+ Add group</button>
          </span>
        )}
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--ink-soft)' }}>
        Each group competes together on every event.
        {editable ? ' Drag athletes to set the order they compete in, or drag one into another group. The arrow buttons move an athlete to another group without dragging.' : ''}
      </p>

      {editable ? (
        <DndContext
          sensors={sensors}
          collisionDetection={collision}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={clear}
          accessibility={{ announcements, screenReaderInstructions: SR_INSTRUCTIONS }}
        >
          {body}
          <DragOverlay>{activeId ? <Chip name={nameOf(activeId)} dragging /> : null}</DragOverlay>
        </DndContext>
      ) : body}
    </div>
  );
}

const GROUP_PREFIX = 'co-group-';

const apparatusName = (discipline: 'WAG' | 'MAG', code: string): string =>
  APPARATUS[discipline].find((a) => a.code === code)?.name ?? code;

/** Prefer the athlete under the pointer; fall back to the group it is in, then the nearest centre
 *  (keyboard dragging has no pointer, so it uses rectangle overlap). */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const hits = within.length ? within : rectIntersection(args);
  const athletes = hits.filter((c) => !String(c.id).startsWith(GROUP_PREFIX));
  if (athletes.length) return athletes;
  return hits.length ? hits : closestCenter(args);
};

function GroupBlock({
  droppableId, discipline, index, groupCount, members, cap, apparatusOf, code, regIds, nameOf, editable, lineBefore, onMove, onRemove,
}: {
  droppableId: string;
  discipline: 'WAG' | 'MAG';
  index: number;
  groupCount: number;
  members: string[];
  cap: number;
  apparatusOf: ApparatusOf;
  code: string | undefined;
  regIds: string[];
  nameOf: (regId: string) => string;
  editable: boolean;
  /** undefined: no line in this group; null: line at the end; id: line before that athlete. */
  lineBefore: string | null | undefined;
  onMove: (regId: string, toGroup: number) => void;
  onRemove: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId, disabled: !editable });
  // The cap applies per apparatus — the busiest one is what counts.
  const busiest = busiestApparatusCount(members, apparatusOf);
  const over = busiest > cap;
  const label = `Group ${groupLetter(index)}`;
  const others = Array.from({ length: groupCount }, (_, i) => i).filter((i) => i !== index);
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      data-testid={`co-group-${index}`}
      style={{
        border: over ? '2px solid var(--coral-700)' : '1px solid var(--line)',
        borderRadius: 10,
        padding: over ? 11 : 12,
        marginBottom: 14,
        minWidth: 0,
        background: isOver ? 'var(--ice-100)' : 'var(--surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{label}</h4>
        <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
          {members.length} athlete{members.length === 1 ? '' : 's'}
        </span>
        <span
          style={{ fontSize: 12.5, fontWeight: 700, color: over ? 'var(--coral-700)' : 'var(--ink-soft)' }}
          title={`Most athletes on any one event in this group (max ${cap})`}
        >
          busiest event {busiest} / {cap}
        </span>
        {editable && members.length === 0 && groupCount > 1 && (
          <button type="button" className="btn small ghost" style={{ marginLeft: 'auto', padding: '1px 8px' }} onClick={onRemove}>
            Remove group
          </button>
        )}
      </div>

      {/* Membership: who is in this group, with move-to-group buttons (the non-drag way to change group). */}
      {members.length === 0 ? (
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--ink-soft)' }}>
          No athletes yet{editable ? ' — drag athletes here or move them from another group.' : '.'}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '0 0 10px', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {members.map((regId) => (
            <li
              key={regId}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: editable && others.length > 0 ? '3px 4px 3px 10px' : '4px 10px',
                borderRadius: 999, border: '1px solid var(--line)', background: 'var(--ice-100)',
                color: 'var(--ink)', fontSize: 12.5, maxWidth: '100%', minWidth: 0,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{nameOf(regId)}</span>
              {editable && others.map((to) => (
                <button
                  key={to}
                  type="button"
                  className="btn small ghost"
                  style={{ padding: '0 8px', minHeight: 28, fontSize: 12 }}
                  aria-label={`Move ${nameOf(regId)} to Group ${groupLetter(to)}`}
                  title={`Move to Group ${groupLetter(to)}`}
                  onClick={() => onMove(regId, to)}
                >
                  → {groupLetter(to)}
                </button>
              ))}
            </li>
          ))}
        </ul>
      )}

      {!code ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-soft)' }}>No apparatus entries yet at this level.</p>
      ) : (
        <OrderColumn
          id={`co-${index}-${code}`}
          apparatusLabel={apparatusName(discipline, code)}
          regIds={regIds}
          nameOf={nameOf}
          editable={editable}
          lineBefore={lineBefore}
        />
      )}
    </section>
  );
}

const SR_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: 'To pick up an athlete, press space or enter. Use the arrow keys to move them, '
    + 'including into another group, then press space or enter again to drop, or escape to cancel.',
};

/** Items never shift while dragging — the drop line marks the landing slot
 *  instead, so the list stays still under the pointer. */
const stillStrategy: SortingStrategy = () => null;

/** One group's list on the shown apparatus. Its DndContext lives in the card, so athletes can cross groups. */
function OrderColumn({
  id, apparatusLabel, regIds, nameOf, editable, lineBefore,
}: {
  id: string;
  apparatusLabel: string;
  regIds: string[];
  nameOf: (regId: string) => string;
  editable: boolean;
  lineBefore: string | null | undefined;
}) {
  const header = (
    <h5 style={{ margin: '0 0 6px', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>
      {apparatusLabel} <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>({regIds.length})</span>
    </h5>
  );
  const colStyle: CSSProperties = { minWidth: 0 };

  if (!editable) {
    return (
      <div style={colStyle}>
        {header}
        {regIds.length === 0
          ? <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '8px 0' }}>No athletes on this event</div>
          : <ol data-testid={id} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {regIds.map((regId, i) => <li key={regId}><Chip name={nameOf(regId)} order={i + 1} staticChip /></li>)}
          </ol>}
      </div>
    );
  }

  return (
    <div style={colStyle}>
      {header}
      <SortableContext id={id} items={regIds} strategy={stillStrategy}>
        <div data-testid={id} style={{ minHeight: 28 }}>
          {regIds.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '4px 0' }}>No athletes on this event. Drop one here.</div>}
          {regIds.map((regId, i) => (
            <div key={regId}>
              {lineBefore === regId && <DropLine key={`line-${regId}`} />}
              <SortableChip id={regId} name={nameOf(regId)} order={i + 1} />
            </div>
          ))}
          {lineBefore === null && <DropLine key="line-end" />}
        </div>
      </SortableContext>
    </div>
  );
}

/** Animated landing indicator (`.co-drop-line` in index.css: grows in, then
 *  pulses; static under prefers-reduced-motion). Decorative — the live
 *  announcements carry the same information for screen readers. */
function DropLine() {
  return <div className="co-drop-slot" aria-hidden data-testid="co-drop-line"><div className="co-drop-line" /></div>;
}

function SortableChip({ id, name, order }: { id: string; name: string; order: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} aria-label={`${order}. ${name}`}>
      <Chip name={name} order={order} />
    </div>
  );
}

/** Athlete chip — used inside the sortable list, inside `DragOverlay`
 *  (which renders a plain, non-sortable copy that follows the cursor), and
 *  (`staticChip`) in the locked view-only list. Fill is `--ice-100` (pale)
 *  with `--ink` text — the app's default body-text pairing, so contrast holds
 *  without a bespoke pairing. */
function Chip({ name, order, dragging, staticChip }: { name: string; order?: number; dragging?: boolean; staticChip?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        marginBottom: 6,
        borderRadius: 6,
        background: 'var(--ice-100)',
        color: 'var(--ink)',
        fontSize: 13,
        border: '1px solid var(--line)',
        cursor: staticChip ? 'default' : dragging ? 'grabbing' : 'grab',
        touchAction: staticChip ? undefined : 'none',
        boxShadow: dragging ? 'var(--shadow)' : 'none',
        minWidth: 0,
      }}
    >
      {/* View-only (locked) chips drop the drag-handle glyph so they don't read as draggable. */}
      {!staticChip && <span aria-hidden style={{ color: 'var(--ink-soft)' }}>⠿</span>}
      {order !== undefined && <span style={{ color: 'var(--ink-soft)', fontVariantNumeric: 'tabular-nums' }}>{order}.</span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{name}</span>
    </div>
  );
}
