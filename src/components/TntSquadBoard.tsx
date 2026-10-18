// Built fresh for UCG Lineups: the three T&T squads and the unplaced list. Athletes are dragged by a handle onto a squad
// (dnd-kit: pointer, touch, keyboard) or moved with the "Move to squad" select. Logic lives in src/lib/tnt-squads.ts.
import { useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, pointerWithin, rectIntersection,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import type { Announcements, CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
  TNT_CAP, TNT_EVENT_NAME, TNT_EVENTS, TNT_SQUAD_COUNT, TNT_USUAL, fullName, mixedLevels, mixedText, rotationFor, sizeStatus, squadLetter,
  type TntAthlete,
} from '../lib/tnt-squads';
import { Badge } from './ui';

const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

const cmpText = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/** Club, then first name, then last name. */
const byClubThenName = (byId: Map<string, TntAthlete>) => (x: string, y: string) => {
  const a = byId.get(x)!;
  const b = byId.get(y)!;
  return cmpText(a.clubName, b.clubName) || cmpText(a.first, b.first) || cmpText(a.last, b.last) || x.localeCompare(y);
};

export function LevelChips({ a }: { a: TntAthlete }) {
  return (
    <span className="tnt-chips">
      {[...TNT_EVENTS, 'SY' as const].filter((c) => a.levels[c]).map((c) => (
        <span key={c} className="tnt-chip" title={`${TNT_EVENT_NAME[c]}: ${a.levels[c]}`}><b>{c}</b> {a.levels[c]}</span>
      ))}
    </span>
  );
}

function Zone({ id, className, label, children }: { id: string; className: string; label: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`${className}${isOver ? ' over' : ''}`} data-zone={id} role="group" aria-label={label}>{children}</div>;
}

function AthleteRow({ a, where, dragging, onMove }: { a: TntAthlete; where: number | null; dragging: boolean; onMove: (id: string, to: number | null) => void }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: a.id });
  const name = fullName(a);
  return (
    <li ref={setNodeRef} className="tnt-ath" style={dragging ? { opacity: 0.4 } : undefined} data-athlete={a.id}>
      <button type="button" className="sq-handle" aria-label={`Drag ${name}`} {...attributes} {...listeners}><span aria-hidden>⋮⋮</span></button>
      <span className="tnt-who">
        <b>{name}</b>
        <span className="tnt-club">{a.clubName}</span>
        <LevelChips a={a} />
      </span>
      <label className="sq-place">
        <span className="sr-only">Move {name} to squad</span>
        <select
          value={where === null ? '' : String(where)} aria-label={`Move to squad: ${name}`}
          onChange={(e) => onMove(a.id, e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">Unplaced</option>
          {Array.from({ length: TNT_SQUAD_COUNT }, (_, j) => <option key={j} value={j}>Squad {squadLetter(j)}</option>)}
        </select>
      </label>
    </li>
  );
}

export function TntSquadBoard({ squads, tray, byId, onMove }: {
  squads: string[][];
  tray: string[];
  byId: Map<string, TntAthlete>;
  onMove: (id: string, to: number | null) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const cmp = byClubThenName(byId);
  const nameOf = (id: unknown) => { const a = byId.get(String(id)); return a ? fullName(a) : 'athlete'; };
  const zoneName = (id: unknown) => (id === 'tray' ? 'the unplaced list' : `Squad ${squadLetter(Number(String(id).replace('squad-', '')))}`);
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} is over ${zoneName(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} was placed in ${zoneName(over.id)}.` : `${nameOf(active.id)} was dropped outside a squad and not moved.`),
    onDragCancel: ({ active }) => `Dragging ${nameOf(active.id)} was cancelled.`,
  };
  const whereOf = new Map<string, number>();
  squads.forEach((s, i) => s.forEach((id) => whereOf.set(id, i)));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over) return;
    const id = String(e.active.id);
    const to = String(e.over.id);
    const target = to === 'tray' ? null : Number(to.replace('squad-', ''));
    if (target !== null && Number.isNaN(target)) return;
    if ((whereOf.get(id) ?? null) === target) return;
    onMove(id, target);
  };
  const row = (id: string, where: number | null) => {
    const a = byId.get(id);
    return a ? <AthleteRow key={id} a={a} where={where} dragging={activeId === id} onMove={onMove} /> : null;
  };

  return (
    <DndContext
      sensors={sensors} collisionDetection={collide} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
      onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)} accessibility={{ announcements }}
    >
      <section className="sq-tray" aria-label="Unplaced athletes">
        <div className="sq-tray-h">
          <b>Unplaced athletes ({tray.length})</b>
          <span className="sq-muted">Drag an athlete by the handle onto a squad, or use the Move to squad menu.</span>
        </div>
        <Zone id="tray" className="tnt-list sq-tray-b" label="Unplaced athletes">
          {tray.length === 0 ? <div className="sq-empty">Everyone is in a squad.</div> : <ul className="tnt-ul">{[...tray].sort(cmp).map((id) => row(id, null))}</ul>}
        </Zone>
      </section>
      <div className="sq-squads tnt-squads">
        {squads.map((ids, s) => {
          const status = sizeStatus(ids.length);
          const mixed = mixedLevels(ids, byId);
          return (
            <section key={s} className="sq-squad" aria-label={`Squad ${squadLetter(s)}`} data-squad={s}>
              <div className="sq-squad-h">
                <div className="sq-r1">
                  <h3 className="display">Squad {squadLetter(s)}</h3>
                  <span className="sq-rot">{rotationFor(s).map((c) => TNT_EVENT_NAME[c]).join(' → ')}</span>
                </div>
                <div className="sq-pills">
                  {status === 'ok' && <Badge tone="ok">{ids.length} athlete{ids.length === 1 ? '' : 's'}</Badge>}
                  {status === 'high' && <Badge tone="warn">{ids.length} athletes: above the usual {TNT_USUAL[0]}–{TNT_USUAL[1]}</Badge>}
                  {status === 'over' && <Badge tone="err">{ids.length} athletes: over {TNT_CAP}</Badge>}
                  {mixed.length > 0 && <Badge tone="warn">Mixed levels: {mixedText(mixed)}</Badge>}
                </div>
              </div>
              <Zone id={`squad-${s}`} className="sq-squad-b" label={`Athletes in Squad ${squadLetter(s)}`}>
                {ids.length === 0 ? <div className="sq-empty">Drop athletes here</div> : <ul className="tnt-ul">{[...ids].sort(cmp).map((id) => row(id, s))}</ul>}
              </Zone>
            </section>
          );
        })}
      </div>
      <DragOverlay>{activeId ? <div className="sq-card sq-overlay">{nameOf(activeId)}</div> : null}</DragOverlay>
    </DndContext>
  );
}
