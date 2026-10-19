// Built fresh for UCG Lineups (not a copy of the platform's ClubGroupSquadBuilder.tsx): the tray, the
// squads and drag-and-drop for placing whole club-group cards. Logic lives in src/lib/squad-balance.ts and
// rotation.ts; this only draws and reports moves. The platform builder's tray/squad/swap/specialist layout
// and the prototype's labels are kept.
import { useState, type CSSProperties } from 'react';
import Select from './Select';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, pointerWithin, rectIntersection,
  useDraggable, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import type { Announcements, CollisionDetection, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { apparatusCodes, columnLabel, firstApparatus, flightRows, rotationFor, squadLetter, type ArtisticDiscipline, type RotationPattern } from '../lib/rotation';
import { cardLabel, planStats, squadSpecialists, unplacedCards, type SquadCard, type SquadPlan, type SquadStats } from '../lib/squad-balance';
import { fullName, type SquadSessionData } from '../lib/squad-data';
import { squadRoutineCap } from '../lib/squad-builder';
import { Badge } from './ui';

const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

const startsLabel = (i: number, pattern: RotationPattern, d: ArtisticDiscipline) =>
  `starts ${firstApparatus(i, pattern, d)}`;

function Counts({ routines, codes, cap }: { routines: Record<string, number>; codes: string[]; cap?: number }) {
  return (
    <div className="sq-counts">
      {codes.map((c) => {
        const over = cap !== undefined && (routines[c] ?? 0) > cap;
        return (
          <div key={c} className={over ? 'over' : ''}>
            <b>{c}</b>{routines[c] ?? 0}{over && <span className="sr-only"> (over {cap})</span>}
          </div>
        );
      })}
    </div>
  );
}

function CardView({ card, label, where, plan, pattern, discipline, codes, onPlace, dragging }: {
  card: SquadCard;
  label: string;
  where: number | null;
  plan: SquadPlan;
  pattern: RotationPattern;
  discipline: ArtisticDiscipline;
  codes: string[];
  onPlace: (key: string, to: number | null) => void;
  dragging: boolean;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: card.key });
  const style: CSSProperties = dragging ? { opacity: 0.4 } : {};
  const n = card.regIds.length;
  return (
    <div ref={setNodeRef} style={style} className={`sq-card${card.independentRegId ? ' indep' : ''}`} data-card={card.key}>
      <div className="sq-card-top">
        <button type="button" className="sq-handle" aria-label={`Drag ${label}`} {...attributes} {...listeners}>
          <span aria-hidden>⋮⋮</span>
        </button>
        <div className="sq-card-title">{label}</div>
      </div>
      <div className="sq-card-meta">
        <span>{n} athlete{n === 1 ? '' : 's'}</span>
        <label className="sq-place">
          <span>Place in squad</span>
          <Select
            size="sm"
            value={where === null ? '' : String(where)}
            onChange={(v) => onPlace(card.key, v === '' ? null : Number(v))}
            aria-label={`Place in squad: ${label}`}
            options={[{ value: '', label: 'Unplaced' }, ...plan.map((s, i) => ({ value: String(i), label: `Squad ${s.name} (${startsLabel(i, pattern, discipline)})` }))]}
          />
        </label>
      </div>
      <Counts routines={card.routines} codes={codes} />
    </div>
  );
}

function Zone({ id, className, label, children }: { id: string; className: string; label: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`${className}${isOver ? ' over' : ''}`} data-zone={id} role="group" aria-label={label}>{children}</div>;
}

export function SquadBoard({ discipline, pattern, plan, cards, data, onPlace, onSwap }: {
  discipline: ArtisticDiscipline;
  pattern: RotationPattern;
  plan: SquadPlan;
  cards: SquadCard[];
  data: SquadSessionData;
  onPlace: (key: string, to: number | null) => void;
  onSwap: (a: number, b: number) => void;
}) {
  const codes = apparatusCodes(discipline);
  const cap = squadRoutineCap(discipline);
  const byKey = new Map(cards.map((c) => [c.key, c]));
  const labelCtx = { clubLabel: data.clubLabel, independentLabel: data.independentLabel };
  const levelName = (l: string) => data.levelNames.get(l) ?? l;
  const labelOf = (c: SquadCard) => cardLabel(c, levelName(c.levelId), labelCtx);
  const stats = planStats(plan, byKey, discipline, data.levelRank);
  const tray = unplacedCards(plan, cards);
  const whereOf = new Map<string, number>();
  plan.forEach((s, i) => s.cardKeys.forEach((k) => whereOf.set(k, i)));
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const zoneName = (id: unknown) => (id === 'tray' ? 'the unplaced groups' : `Squad ${squadLetter(Number(String(id).replace('squad-', '')))}`);
  const nameOf = (id: unknown) => { const c = byKey.get(String(id)); return c ? labelOf(c) : 'group'; };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} is over ${zoneName(over.id)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `${nameOf(active.id)} was placed in ${zoneName(over.id)}.` : `${nameOf(active.id)} was dropped outside a squad and not moved.`),
    onDragCancel: ({ active }) => `Dragging ${nameOf(active.id)} was cancelled.`,
  };

  const onDragStart = (e: DragStartEvent) => setActiveKey(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveKey(null);
    if (!e.over) return;
    const key = String(e.active.id);
    const to = String(e.over.id);
    const target = to === 'tray' ? null : Number(to.replace('squad-', ''));
    if (target !== null && Number.isNaN(target)) return;
    if ((whereOf.get(key) ?? null) === target) return;
    onPlace(key, target);
  };

  const cardView = (c: SquadCard, where: number | null) => (
    <CardView
      key={c.key} card={c} label={labelOf(c)} where={where} plan={plan} pattern={pattern} discipline={discipline}
      codes={codes} onPlace={onPlace} dragging={activeKey === c.key}
    />
  );

  const squadPanel = (i: number) => {
    const slot = plan[i];
    const st: SquadStats = stats[i];
    const keys = slot.cardKeys.filter((k) => byKey.has(k));
    const regIds = keys.flatMap((k) => byKey.get(k)!.regIds);
    const rot = rotationFor(i, pattern, discipline);
    const specs = squadSpecialists(regIds, (id) => data.athletes.get(id)?.apparatus ?? [], i, pattern, discipline);
    return (
      <section key={slot.name} className="sq-squad" aria-label={`Squad ${slot.name}`} data-squad={i}>
        <div className="sq-squad-h">
          <div className="sq-r1">
            <h3 className="display">Squad {slot.name}</h3>
            <span className="sq-rot">{st.athletes} athlete{st.athletes === 1 ? '' : 's'} · {rot.map((c) => columnLabel(c, pattern, discipline)).join(' → ')}</span>
          </div>
          <label className="sq-swap">
            <span>Swap all groups with</span>
            <Select
              size="sm"
              value=""
              onChange={(v) => { if (v !== '') onSwap(i, Number(v)); }}
              aria-label={`Swap all of Squad ${slot.name}'s groups with another squad`}
              options={[{ value: '', label: 'Choose a squad…' }, ...plan.flatMap((o, j) => (j === i ? [] : [{ value: String(j), label: `Squad ${o.name} (${startsLabel(j, pattern, discipline)})` }]))]}
            />
          </label>
          <Counts routines={st.routines} codes={codes} cap={cap} />
          {(st.overCap.length > 0 || st.mixed) && (
            <div className="sq-pills">
              {st.overCap.length > 0 && <Badge tone="err">Over {cap} on {st.overCap.join(', ')}</Badge>}
              {st.mixed && (
                <Badge tone="warn">{st.infinityMixed ? 'Infinity mixed with other levels: ' : 'Mixed levels: '}{st.levels.map(levelName).join(', ')}</Badge>
              )}
            </div>
          )}
        </div>
        <Zone id={`squad-${i}`} className="sq-squad-b" label={`Groups in Squad ${slot.name}`}>
          {keys.length ? keys.map((k) => cardView(byKey.get(k)!, i)) : <div className="sq-empty">Drop club groups here</div>}
          {specs.length > 0 && (
            <p className="sq-specs">
              Specialists: {specs.map((s) => `${data.athletes.get(s.regId) ? fullName(data.athletes.get(s.regId)!) : s.regId} (${s.apparatus.join(', ')}): first up rotation ${s.firstRotation}`).join('; ')}
            </p>
          )}
        </Zone>
      </section>
    );
  };

  const rows = flightRows(pattern, discipline);
  const active = activeKey ? byKey.get(activeKey) : undefined;

  return (
    <DndContext
      sensors={sensors} collisionDetection={collide} onDragStart={onDragStart} onDragEnd={onDragEnd}
      onDragCancel={() => setActiveKey(null)} accessibility={{ announcements }}
    >
      <section className="sq-tray" aria-label="Unplaced club groups">
        <div className="sq-tray-h">
          <b>Unplaced club groups ({tray.length})</b>
          <span className="sq-muted">Drag a card by its handle onto a squad, or pick a squad from its menu.</span>
        </div>
        <Zone id="tray" className="sq-tray-b" label="Unplaced club groups">
          {tray.length ? tray.map((c) => cardView(c, null)) : <div className="sq-empty">All club groups are placed.</div>}
        </Zone>
      </section>
      {rows.map((idx, f) => (
        <div key={f} className="sq-flight">
          {rows.length > 1 && (
            <h3 className="sq-flight-label">
              Flight {f + 1} · {f === 1 ? 'B' : 'A'} equipment
            </h3>
          )}
          <div className="sq-squads">{idx.map(squadPanel)}</div>
        </div>
      ))}
      <DragOverlay>{active ? <div className="sq-card sq-overlay">{labelOf(active)}</div> : null}</DragOverlay>
    </DndContext>
  );
}

