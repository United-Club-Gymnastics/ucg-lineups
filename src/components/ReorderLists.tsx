// Built fresh for UCG Lineups. One or more numbered lists the admin can reorder by dragging (dnd-kit: pointer, touch and
// keyboard, with a drop line instead of shifting rows). With several lists, a row can also be dragged into another list.
// Used for the T&T competing order (one list) and the synchro flights (one list per flight).
import { useState, type ReactNode } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, pointerWithin, rectIntersection,
  useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import type { Announcements, CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent, ScreenReaderInstructions } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, type SortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { computeDropIndex, dropLandingPosition, moveInSections } from '../lib/competition-order';

export interface ReorderList {
  id: string;
  /** Used in screen-reader announcements, e.g. "Flight A". */
  label: string;
  ids: string[];
}

const LIST_PREFIX = 'rl-list-';

const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const hits = within.length ? within : rectIntersection(args);
  const rows = hits.filter((c) => !String(c.id).startsWith(LIST_PREFIX));
  if (rows.length) return rows;
  return hits.length ? hits : closestCenter(args);
};

/** Rows never shift while dragging; the drop line marks the landing slot instead. */
const stillStrategy: SortingStrategy = () => null;

export function ReorderLists({ lists, nameOf, renderRow, renderHeader, breakBefore, emptyText, onChange, ariaLabel }: {
  lists: ReorderList[];
  nameOf: (id: string) => string;
  /** The row's content (the handle and number are added). `listIndex` lets a row offer "move to flight". */
  renderRow: (id: string, listIndex: number) => ReactNode;
  /** Optional heading above each list (e.g. "Flight A"); the list and heading are wrapped in a labelled section. */
  renderHeader?: (listIndex: number) => ReactNode;
  /** A heavy rule is drawn above a row when this returns true (the level changes). */
  breakBefore?: (id: string, previousId: string) => boolean;
  emptyText: string;
  onChange: (next: string[][]) => void;
  ariaLabel: string;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const sections = lists.map((l) => l.ids);
  const resolve = (over: string): { section: number; overId: string | null } | null => {
    if (over.startsWith(LIST_PREFIX)) {
      const i = lists.findIndex((l) => l.id === over.slice(LIST_PREFIX.length));
      return i >= 0 ? { section: i, overId: null } : null;
    }
    const i = sections.findIndex((s) => s.includes(over));
    return i >= 0 ? { section: i, overId: over } : null;
  };
  const where = (id: string, over: string): string | null => {
    const t = resolve(over);
    if (!t) return null;
    const { position, total } = dropLandingPosition(sections, id, t.section, t.overId ?? '', t.overId === null);
    return lists.length > 1 ? `position ${position} of ${total} in ${lists[t.section].label}` : `position ${position} of ${total}`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(String(active.id))}.`,
    onDragOver: ({ active, over }) => {
      const at = over ? where(String(active.id), String(over.id)) : null;
      return at ? `${nameOf(String(active.id))} moved to ${at}.` : `${nameOf(String(active.id))} is not over a list.`;
    },
    onDragEnd: ({ active, over }) => {
      const at = over ? where(String(active.id), String(over.id)) : null;
      return at ? `${nameOf(String(active.id))} dropped at ${at}.` : `${nameOf(String(active.id))} dropped.`;
    },
    onDragCancel: ({ active }) => `Moving ${nameOf(String(active.id))} was cancelled.`,
  };
  const clear = () => { setActiveId(null); setOverId(null); };
  const onDragStart = (e: DragStartEvent) => { setActiveId(String(e.active.id)); setOverId(String(e.active.id)); };
  const onDragOver = (e: DragOverEvent) => setOverId(e.over ? String(e.over.id) : null);
  const onDragEnd = (e: DragEndEvent) => {
    clear();
    if (!e.over || String(e.over.id) === String(e.active.id)) return;
    const id = String(e.active.id);
    const t = resolve(String(e.over.id));
    if (!t) return;
    const at = computeDropIndex(sections, id, t.section, t.overId ?? '', t.overId === null);
    const next = moveInSections(sections, id, t.section, at);
    if (next.every((s, i) => s.join('\u0000') === sections[i].join('\u0000'))) return;
    onChange(next);
  };

  // Drop line: before `lineBefore` (an id in the target list minus the dragged row), or at the end when null.
  let lineSection = -1;
  let lineBefore: string | null = null;
  if (activeId && overId) {
    const t = resolve(overId);
    if (t) {
      const post = sections[t.section].filter((x) => x !== activeId);
      const at = computeDropIndex(sections, activeId, t.section, t.overId ?? '', t.overId === null);
      lineSection = t.section;
      lineBefore = at < post.length ? post[at] : null;
    }
  }

  const instructions: ScreenReaderInstructions = {
    draggable: `To pick up a row in ${ariaLabel}, press space or enter. Use the arrow keys to move it${lists.length > 1 ? ', including into another list,' : ''} then press space or enter again to drop, or escape to cancel.`,
  };

  return (
    <DndContext
      sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}
      onDragCancel={clear} accessibility={{ announcements, screenReaderInstructions: instructions }}
    >
      {lists.map((l, li) => (
        <ListBody
          key={l.id} list={l} listIndex={li} renderRow={renderRow} renderHeader={renderHeader} breakBefore={breakBefore} emptyText={emptyText}
          lineBefore={lineSection === li ? lineBefore : undefined} nameOf={nameOf} dragging={activeId}
        />
      ))}
      <DragOverlay>{activeId ? <div className="rl-overlay">{nameOf(activeId)}</div> : null}</DragOverlay>
    </DndContext>
  );
}

function ListBody({ list, listIndex, renderRow, renderHeader, breakBefore, emptyText, lineBefore, nameOf, dragging }: {
  list: ReorderList;
  listIndex: number;
  renderRow: (id: string, listIndex: number) => ReactNode;
  renderHeader?: (listIndex: number) => ReactNode;
  breakBefore?: (id: string, previousId: string) => boolean;
  emptyText: string;
  /** undefined: no line here; null: at the end; id: before that row. */
  lineBefore: string | null | undefined;
  nameOf: (id: string) => string;
  dragging: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${LIST_PREFIX}${list.id}` });
  return (
    <section className="rl-section" aria-label={renderHeader ? list.label : undefined}>
      {renderHeader?.(listIndex)}
    <SortableContext id={list.id} items={list.ids} strategy={stillStrategy}>
      <ol ref={setNodeRef} className={`rl-list${isOver ? ' over' : ''}`} aria-label={list.label} data-list={list.id}>
        {list.ids.length === 0 && <li className="rl-empty">{emptyText}</li>}
        {list.ids.map((id, i) => (
          <li key={id} className="rl-slot">
            {lineBefore === id && <DropLine />}
            <Row
              id={id} pos={i + 1} name={nameOf(id)} heavy={!!breakBefore && i > 0 && breakBefore(id, list.ids[i - 1])}
              ghost={dragging === id}
            >
              {renderRow(id, listIndex)}
            </Row>
          </li>
        ))}
        {lineBefore === null && <li className="rl-slot rl-end"><DropLine /></li>}
      </ol>
    </SortableContext>
    </section>
  );
}

function DropLine() {
  return <div className="co-drop-slot" aria-hidden data-testid="rl-drop-line"><div className="co-drop-line" /></div>;
}

function Row({ id, pos, name, heavy, ghost, children }: { id: string; pos: number; name: string; heavy: boolean; ghost: boolean; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({ id });
  return (
    <div
      ref={setNodeRef} className={`rl-row${heavy ? ' heavy' : ''}`} data-row={id}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined, opacity: ghost ? 0.4 : 1 }}
    >
      <span className="rl-pos">{pos}</span>
      <button type="button" ref={setActivatorNodeRef} className="rl-handle" aria-label={`Drag ${name}, now number ${pos}`} {...attributes} {...listeners}>
        <span aria-hidden>⋮⋮</span>
      </button>
      <div className="rl-body">{children}</div>
    </div>
  );
}
