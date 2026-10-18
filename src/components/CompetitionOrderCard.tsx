// Copied from ucg-platform@e57754a src/components/CompetitionOrderCard.tsx — keep in sync by hand
// Changed: detached from the platform store, Supabase, toasts, event lock and people slices. It is now
// a controlled component: the page resolves `groups` / `sections` (club-order-model.ts) and passes them
// in with the roster (`athletes`) and `discipline`; every change comes back through `onChange` as the
// next groups + sections, plus `membershipChanged` (a move, split, add or remove of a group) so the page
// can mark the split as decided. `editable` replaces the lock logic (read-only after the order deadline).
// The Level <select>, "Set competition order" card shell and reconcile-and-persist effect are gone (the
// page owns levels, defaults and autosave). Group membership is still changed with the "→ B" buttons, as
// on the platform (the platform has no cross-group drag); each group x apparatus column keeps its own
// dnd-kit context with Pointer/Touch/Keyboard sensors, drop line and screen-reader announcements.
// No arrow up/down buttons exist. Athlete names come from `athletes` instead of the people slice.
import { useState, type CSSProperties } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor,
  closestCenter, useSensor, useSensors,
} from '@dnd-kit/core';
import type {
  Announcements, DragEndEvent, DragOverEvent, DragStartEvent, ScreenReaderInstructions,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, sortableKeyboardCoordinates, type SortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { APPARATUS } from '../lib/apparatus';
import type { LinkAthlete } from '../lib/club-links';
import {
  sectionCap, moveInSections, computeDropIndex, dropLandingPosition,
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
 * and inside each group drags that group's athletes into competing order per apparatus.
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
  /** Show only this apparatus column in each group (the page's apparatus tabs). Default: all. */
  apparatus?: string;
}) {
  const cap = sectionCap(discipline);
  const apparatusOf = apparatusLookup(athletes);
  const nameById = new Map(athletes.map((a) => [a.id, `${a.first} ${a.last}`.trim()]));
  const nameOf = (id: string) => nameById.get(id) ?? 'Unknown athlete';
  const present = new Set(athletes.flatMap((a) => a.apparatus));
  const allCodes = APPARATUS[discipline].map((a) => a.code).filter((c) => present.has(c));
  const codes = onlyApparatus ? allCodes.filter((c) => c === onlyApparatus) : allCodes;
  const regIdsOn = (code: string) => athletes.filter((a) => a.apparatus.includes(code)).map((a) => a.id);
  const overCap = groupsOverCap(groups, cap, apparatusOf);

  /** Membership changed: rebuild every apparatus from `base` sections. */
  const changeGroups = (nextGroups: string[][], base: Record<string, string[][]> = sections) => {
    const next: Record<string, string[][]> = {};
    for (const code of allCodes) next[code] = sectionsFromGroups(nextGroups, regIdsOn(code), base[code]);
    onChange({ groups: nextGroups, sections: next, membershipChanged: true });
  };
  const moveTo = (id: string, toGroup: number) => changeGroups(moveAthleteToGroup(groups, id, toGroup));
  const addGroup = () => changeGroups([...groups, []]);
  const removeGroup = (index: number) => {
    const next = removeEmptyGroup(groups, index);
    if (!next) return;
    // Drop the (empty) section at the same index so later groups keep their own order.
    const base: Record<string, string[][]> = {};
    for (const code of allCodes) base[code] = (sections[code] ?? []).filter((_, i) => i !== index);
    changeGroups(next, base);
  };
  const autoSplit = () => changeGroups(splitEvenly(groups.flat(), cap, apparatusOf));
  const reorder = (code: string, groupIndex: number, nextSection: string[]) => {
    const next = { ...sections, [code]: sections[code].map((s, i) => (i === groupIndex ? nextSection : s)) };
    onChange({ groups, sections: next, membershipChanged: false });
  };

  if (athletes.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>No athletes at this level yet.</p>;
  }

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
        Each group competes together on every event.{editable ? ' Drag athletes to set the order they compete in on each event.' : ''}
      </p>

      {groups.map((members, gi) => (
        <GroupBlock
          key={gi}
          discipline={discipline}
          index={gi}
          groupCount={groups.length}
          members={members}
          cap={cap}
          apparatusOf={apparatusOf}
          codes={codes}
          sectionsBy={sections}
          nameOf={nameOf}
          editable={editable}
          onMove={moveTo}
          onRemove={() => removeGroup(gi)}
          onReorder={reorder}
        />
      ))}
    </div>
  );
}

const apparatusName = (discipline: 'WAG' | 'MAG', code: string): string =>
  APPARATUS[discipline].find((a) => a.code === code)?.name ?? code;

function GroupBlock({
  discipline, index, groupCount, members, cap, apparatusOf, codes, sectionsBy, nameOf, editable, onMove, onRemove, onReorder,
}: {
  discipline: 'WAG' | 'MAG';
  index: number;
  groupCount: number;
  members: string[];
  cap: number;
  apparatusOf: ApparatusOf;
  codes: string[];
  sectionsBy: Record<string, string[][]>;
  nameOf: (regId: string) => string;
  editable: boolean;
  onMove: (regId: string, toGroup: number) => void;
  onRemove: () => void;
  onReorder: (code: string, groupIndex: number, next: string[]) => void;
}) {
  // The cap applies per apparatus — the busiest one is what counts.
  const busiest = busiestApparatusCount(members, apparatusOf);
  const over = busiest > cap;
  const label = `Group ${groupLetter(index)}`;
  const others = Array.from({ length: groupCount }, (_, i) => i).filter((i) => i !== index);
  return (
    <section
      aria-label={label}
      data-testid={`co-group-${index}`}
      style={{
        border: over ? '2px solid var(--coral-700)' : '1px solid var(--line)',
        borderRadius: 10,
        padding: over ? 11 : 12,
        marginBottom: 14,
        minWidth: 0,
        background: 'var(--surface)',
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

      {/* Membership: who is in this group, with move-to-group controls. */}
      {members.length === 0 ? (
        <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--ink-soft)' }}>
          No athletes yet{editable ? ' — move athletes here from another group.' : '.'}
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

      {codes.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-soft)' }}>No apparatus entries yet at this level.</p>
      ) : (
        // No sideways scroll — apparatus columns wrap (.co-apparatus-grid).
        <div className="co-apparatus-grid">
          {codes.map((code) => (
            <OrderColumn
              key={code}
              id={`co-${index}-${code}`}
              apparatusLabel={apparatusName(discipline, code)}
              groupLabel={label}
              regIds={sectionsBy[code]?.[index] ?? []}
              nameOf={nameOf}
              editable={editable}
              onReorder={(next) => onReorder(code, index, next)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const SR_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: 'To pick up an athlete, press space or enter. Use the arrow keys to move them, '
    + 'then press space or enter again to drop, or escape to cancel.',
};

/** Items never shift while dragging — the drop line marks the landing slot
 *  instead, so the list stays still under the pointer. */
const stillStrategy: SortingStrategy = () => null;

/** One apparatus column of one group, with its own DndContext — an athlete
 *  can only be reordered within this group on this apparatus. */
function OrderColumn({
  id, apparatusLabel, groupLabel, regIds, nameOf, editable, onReorder,
}: {
  id: string;
  apparatusLabel: string;
  groupLabel: string;
  regIds: string[];
  nameOf: (regId: string) => string;
  editable: boolean;
  onReorder: (next: string[]) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const sections = [regIds];
  // Screen-reader announcements in athlete names + positions instead of
  // dnd-kit's default raw ids. Landing position uses the same math as the drop.
  const where = (regId: string, over: string): string | null => {
    if (!regIds.includes(over)) return null;
    const { position, total } = dropLandingPosition(sections, regId, 0, over, false);
    return `position ${position} of ${total} on ${apparatusLabel}, ${groupLabel}`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(String(active.id))}.`,
    onDragOver: ({ active, over }) => {
      const name = nameOf(String(active.id));
      const at = over ? where(String(active.id), String(over.id)) : null;
      return at ? `${name} moved to ${at}.` : `${name} is not over the list.`;
    },
    onDragEnd: ({ active, over }) => {
      const name = nameOf(String(active.id));
      const at = over ? where(String(active.id), String(over.id)) : null;
      return at ? `${name} dropped at ${at}.` : `${name} dropped.`;
    },
    onDragCancel: ({ active }) => `Moving ${nameOf(String(active.id))} was cancelled.`,
  };

  const clear = () => { setActiveId(null); setOverId(null); };
  const onDragStart = (evt: DragStartEvent) => {
    setActiveId(String(evt.active.id));
    setOverId(String(evt.active.id));
  };
  const onDragOver = (evt: DragOverEvent) => setOverId(evt.over ? String(evt.over.id) : null);
  const onDragEnd = (evt: DragEndEvent) => {
    clear();
    const { active, over } = evt;
    if (!editable || !over) return;
    const regId = String(active.id);
    const target = String(over.id);
    if (target === regId || !regIds.includes(target)) return;
    const next = moveInSections(sections, regId, 0, computeDropIndex(sections, regId, 0, target, false))[0];
    if (next.join('\u0000') !== regIds.join('\u0000')) onReorder(next);
  };

  // Drop line: before `lineBefore` (an id of the list minus the dragged
  // athlete), or at the end when null — exactly the slot the drop inserts at.
  let lineBefore: string | null | undefined;
  if (activeId && overId && regIds.includes(overId)) {
    const post = regIds.filter((x) => x !== activeId);
    const at = computeDropIndex(sections, activeId, 0, overId, false);
    lineBefore = at < post.length ? post[at] : null;
  }

  const header = (
    <h5 style={{ margin: '0 0 6px', fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>
      {apparatusLabel} <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>({regIds.length})</span>
    </h5>
  );
  const colStyle: CSSProperties = { minWidth: 0 };

  if (regIds.length === 0) {
    return (
      <div style={colStyle}>
        {header}
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '8px 0' }}>No athletes on this event</div>
      </div>
    );
  }

  if (!editable) {
    return (
      <div style={colStyle}>
        {header}
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {regIds.map((regId, i) => <li key={regId}><Chip name={nameOf(regId)} order={i + 1} staticChip /></li>)}
        </ol>
      </div>
    );
  }

  return (
    <div style={colStyle}>
      {header}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={clear}
        accessibility={{ announcements, screenReaderInstructions: SR_INSTRUCTIONS }}
      >
        <SortableContext id={id} items={regIds} strategy={stillStrategy}>
          <div data-testid={id}>
            {regIds.map((regId, i) => (
              <div key={regId}>
                {lineBefore === regId && <DropLine key={`line-${regId}`} />}
                <SortableChip id={regId} name={nameOf(regId)} order={i + 1} />
              </div>
            ))}
            {lineBefore === null && <DropLine key="line-end" />}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeId ? <Chip name={nameOf(activeId)} dragging /> : null}
        </DragOverlay>
      </DndContext>
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
