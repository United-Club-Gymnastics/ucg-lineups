// HTML preview of the SAME page models the PDF is drawn from (src/lib/pdf/model.ts), at paper size (points), black and white.
// A paper scrolls inside its own box on a narrow screen; the page itself never scrolls sideways.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MARK_PATHS, MARK_SIZE } from '../lib/pdf/logo-mark';
import {
  BRAND_NAME, LETTER, MARGIN, SITE, artisticRotationUnit, artisticRowHeight, columnWidths, isLandscape, tntAthleteHeight, tntRotationUnit,
  type ArtisticRotationPage, type ArtisticScorecardPage, type Column, type Page, type SynchroPage, type TntRotationPage, type TntScorecardPage,
} from '../lib/pdf/model';
import { pageLabel } from '../lib/pdf/labels';
import { splitPair } from '../lib/pdf/pair';
import './pdf-preview.css';

const pt = (n: number) => `${n}pt`;
const cols = (columns: { weight: number }[], total: number) => columnWidths(columns, total).map(pt).join(' ');
const boxClass = (c: Column) => `pv-cell${c.heavy ? ' pv-heavy' : ''}`;

function Mark({ size }: { size: number }) {
  return (
    <svg className="pv-mark" width={pt(size)} height={pt(size)} viewBox={`0 0 ${MARK_SIZE} ${MARK_SIZE}`} aria-hidden="true" focusable="false">
      {MARK_PATHS.map((d, i) => <path key={i} d={d} fill="#000" />)}
    </svg>
  );
}

function Lockup({ size, right }: { size: number; right?: boolean }) {
  const [a, b, c] = BRAND_NAME.toUpperCase().split(' ');
  return (
    <div className={`pv-lockup${right ? ' pv-lockup-r' : ''}`} style={{ '--ls': pt(size) } as CSSProperties}>
      <Mark size={size} />
      <span style={{ fontSize: pt(size * 0.3) }}>{a} {b}<br />{c}</span>
    </div>
  );
}

function Footer({ page, centre }: { page: Page; centre?: boolean }) {
  const printed = page.kind === 'artistic-rotation' || page.kind === 'tnt-rotation' ? ` · Printed ${page.printedOn}` : '';
  return (
    <div className="pv-foot">
      <span>{SITE}</span>
      {centre && <Lockup size={16} />}
      <span>Page {page.page.n} of {page.page.of}{printed}</span>
    </div>
  );
}

function Key({ text }: { text: string }) {
  return <div className="pv-key"><span className="pv-swatch" /> {text}</div>;
}

function Check({ size = 12 }: { size?: number }) {
  return <span className="pv-check" style={{ width: pt(size), height: pt(size) }} />;
}

function ArtisticScorecard({ pg }: { pg: ArtisticScorecardPage }) {
  const rowH = artisticRowHeight(pg.rows.length);
  const grid = cols(pg.columns, LETTER.h - 2 * MARGIN);
  return (
    <>
      <div className="pv-head3">
        <div className="pv-small">{pg.meet.date}<br /><i className="pv-grey">Printed {pg.printedOn}</i></div>
        <div className="pv-meet">{pg.meet.name}</div>
        <div className="pv-right"><Lockup size={26} right /><b><i>{pg.gym}<br />{pg.session}</i></b></div>
      </div>
      <div className="pv-band">
        <span className="pv-squad"><b>Squad</b> <b className="pv-squad-letter">{pg.band.squad}</b></span>
        <span className="pv-apparatus">{pg.band.apparatus}</span>
        <span className="pv-rot">{pg.band.discipline} · Rotation {pg.band.rotation}{pg.band.equipment ? ` · ${pg.band.equipment}` : ''}</span>
      </div>
      <div className="pv-grid pv-headrow" style={{ gridTemplateColumns: grid, height: pt(26) }} role="presentation">
        {pg.columns.map((c) => (
          <div key={c.id} className={`${boxClass(c)} pv-th${c.kind === 'text' ? ' pv-left' : ''}`}>
            <b>{c.header}</b>{c.sub && <small>{c.sub}</small>}
          </div>
        ))}
      </div>
      {pg.rows.map((r, i) => (
        <div key={i} className={`pv-grid pv-row${r.levelBreak ? ' pv-break' : ''}`} style={{ gridTemplateColumns: grid, height: pt(rowH) }}>
          {pg.columns.map((c) => (
            <div key={c.id} className={`${boxClass(c)}${c.kind === 'text' ? ' pv-left' : ''}`}>
              {c.kind === 'check' && <Check />}
              {!r.blank && c.id === 'level' && <b className="pv-lv">{r.level}</b>}
              {!r.blank && c.id === 'athlete' && <span className="pv-ath">{r.athlete}</span>}
              {!r.blank && c.id === 'club' && <i className="pv-club">{r.club}</i>}
            </div>
          ))}
        </div>
      ))}
      <Key text={pg.key} />
    </>
  );
}

function SheetHeader({ title, subtitle, meet, printedOn }: { title: string; subtitle: string; meet: { name: string; date: string }; printedOn: string }) {
  return (
    <div className="pv-head3 pv-sheethead">
      <Lockup size={28} />
      <div><div className="pv-title">{title}</div><div className="pv-sub">{subtitle}</div></div>
      <div className="pv-right pv-small"><b>{meet.name}</b><br />{meet.date}<br /><i className="pv-grey">Printed {printedOn}</i></div>
    </div>
  );
}

function TntScorecard({ pg }: { pg: TntScorecardPage }) {
  const h = tntAthleteHeight(pg.rows.length);
  const grid = cols(pg.columns, LETTER.h - 2 * MARGIN);
  return (
    <>
      <SheetHeader title={pg.title} subtitle={pg.subtitle} meet={pg.meet} printedOn={pg.printedOn} />
      <div className="pv-grid pv-headrow pv-tnt-head" style={{ gridTemplateColumns: grid, height: pt(20) }}>
        {pg.columns.map((c) => <div key={c.id} className={`${boxClass(c)} pv-th${c.id === 'name' ? ' pv-left' : ''}`}>{c.header}</div>)}
      </div>
      {pg.rows.map((r, i) => (
        <div key={i} className={`pv-grid pv-row pv-tnt-row${r.levelBreak ? ' pv-break' : ''}`} style={{ gridTemplateColumns: grid, height: pt(h) }}>
          {pg.columns.map((c) => c.kind === 'box' ? (
            <div key={c.id} className="pv-passes">
              {Array.from({ length: pg.passes }, (_, k) => <div key={k} className={boxClass(c)} />)}
            </div>
          ) : (
            <div key={c.id} className={`${boxClass(c)}${c.id === 'name' ? ' pv-left' : ''}`}>
              {c.kind === 'check' && <Check />}
              {!r.blank && c.id === 'name' && <><b className="pv-ath">{r.name}</b><i className="pv-club">{r.club}</i></>}
              {!r.blank && c.id === 'level' && <b className="pv-lv">{r.level}</b>}
            </div>
          ))}
        </div>
      ))}
      <Key text={pg.key} />
    </>
  );
}

function Synchro({ pg }: { pg: SynchroPage }) {
  const boxes = `repeat(5, 1fr)`;
  const row = (cs: Column[], label: boolean, h: number) => (
    <div className="pv-sy-boxes" style={{ gridTemplateColumns: boxes, height: pt(h) }}>
      {cs.map((c) => <div key={c.id} className={`${boxClass(c)} pv-th`}>{label ? c.header : ''}</div>)}
    </div>
  );
  return (
    <>
      <SheetHeader title={pg.title} subtitle={pg.subtitle} meet={pg.meet} printedOn={pg.printedOn} />
      <div className="pv-small pv-sy-scratch">Scratch?</div>
      {pg.pairs.map((q, i) => {
        const [n1, n2] = splitPair(q.names);
        return (
          <div key={i} className={`pv-sy${q.levelBreak ? ' pv-break' : ''}`}>
            <div className="pv-sy-chk"><Check size={13} /></div>
            <div className="pv-sy-name">
              <div className="pv-cell pv-left pv-th" style={{ height: pt(13) }}>Pair / Club</div>
              <div className="pv-cell pv-left pv-sy-names"><b>{n2 ? `${n1} &` : n1}</b>{n2 && <b>{n2}</b>}<i className="pv-club">{q.club}</i></div>
            </div>
            <div className="pv-sy-lv">
              <div className="pv-cell pv-th" style={{ height: pt(13) }}>Level</div>
              <div className="pv-cell pv-sy-level"><b className="pv-lv">{q.level}</b></div>
            </div>
            <div className="pv-sy-grid">
              {row(pg.row1, true, 13)}{row(pg.row1, false, 22)}{row(pg.row2, true, 13)}{row(pg.row2, false, 22)}
            </div>
          </div>
        );
      })}
      <Key text={pg.key} />
    </>
  );
}

function ArtisticRotation({ pg }: { pg: ArtisticRotationPage }) {
  const u = artisticRotationUnit(pg.units);
  const colW = 46;
  const grid = `1fr repeat(${pg.columnCount}, ${pt(colW)})`;
  return (
    <>
      <div className="pv-rtitle">{pg.title}</div>
      <div className="pv-rsub">{pg.subtitle}</div>
      <div className="pv-sched">
        <div><b className="pv-underline">Schedule</b><div className="pv-sched-items">{pg.schedule.map((s) => <span key={s.label}><b>{s.time || '--'}</b> {s.label}</span>)}</div></div>
        <b><i>Session athlete count: {pg.athleteCount}</i></b>
      </div>
      {pg.squads.map((s) => (
        <div key={s.letter} className="pv-squadblock" style={{ marginBottom: pt(u * 0.8), fontSize: pt(Math.min(9, u * 0.62)) }}>
          <div className="pv-rgrid pv-rhead" style={{ gridTemplateColumns: grid, height: pt(u * 1.5) }}>
            <b className="pv-rsquad">{s.heading}</b>
            {s.columns.map((c, k) => <b key={k}>{c}</b>)}
          </div>
          {s.empty && <div className="pv-rgrid pv-rrow" style={{ gridTemplateColumns: '1fr', height: pt(u) }}><i className="pv-grey" style={{ paddingLeft: pt(5) }}>No club groups placed</i></div>}
          {s.rows.map((r, i) => (
            <div key={i} className={`pv-rgrid pv-rrow${r.alt ? ' pv-alt' : ''}${r.levelBreak ? ' pv-dash' : ''}`} style={{ gridTemplateColumns: grid, height: pt(u) }}>
              <b className="pv-rlabel">{r.label}</b>
              {r.counts.map((v, k) => <span key={k} className={v ? 'pv-n' : 'pv-n pv-zero'}>{v === null ? '' : v}</span>)}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function TntRotation({ pg }: { pg: TntRotationPage }) {
  const u = tntRotationUnit(pg.units);
  return (
    <>
      <div className="pv-rtitle">{pg.title}</div>
      <div className="pv-rsub">{pg.subtitle}</div>
      {pg.tables.map((t, ti) => {
        const wide = t.columns.length === 7;
        const grid = cols((wide ? [3.4, 4.2, 0.8, 0.8, 0.8, 0.8, 0.8] : [1.2, 4, 4.6, 1]).map((weight) => ({ weight })), LETTER.w - 2 * MARGIN);
        const numeric = (i: number) => (wide ? i >= 2 : i === 3);
        return (
          <div key={ti} style={{ marginBottom: pt(u * 0.8), fontSize: pt(Math.min(8.5, u * 0.65)) }}>
            <div className="pv-thead"><b><i>{t.continued ? `${t.heading} (continued)` : t.heading}</i></b></div>
            <div className="pv-rgrid pv-rhead pv-light" style={{ gridTemplateColumns: grid, height: pt(u) }}>
              {t.columns.map((c, i) => <b key={c} className={numeric(i) ? 'pv-c' : 'pv-l'}>{c}</b>)}
            </div>
            {t.rows.map((r, i) => (
              <div key={i} className={`pv-rgrid pv-rrow${r.alt ? ' pv-alt' : ''}`} style={{ gridTemplateColumns: grid, height: pt(u) }}>
                {r.cells.map((v, k) => <span key={k} className={numeric(k) ? 'pv-c' : 'pv-l'}>{v}</span>)}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

/** True while the element's content is wider than its box (a scroll box is then given a tab stop so a keyboard can scroll it). */
function useOverflowsX<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const check = () => setOver(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, over] as const;
}

/** One page at paper size. */
export function PagePreview({ page, id }: { page: Page; id?: string }) {
  const land = isLandscape(page);
  const [ref, over] = useOverflowsX<HTMLDivElement>();
  const label = `Page ${page.page.n} of ${page.page.of}: ${pageLabel(page)}`;
  const style: CSSProperties = { width: pt(land ? LETTER.h : LETTER.w), height: pt(land ? LETTER.w : LETTER.h), padding: pt(MARGIN) };
  return (
    <div className="pv-scroll" id={id} ref={ref} {...(over ? { tabIndex: 0, role: 'group', 'aria-label': `${label} (scrolls sideways)` } : {})}>
      <section className={`pv-paper ${land ? 'pv-land' : 'pv-port'}`} style={style} aria-label={label}>
        {page.kind === 'artistic-scorecard' && <ArtisticScorecard pg={page} />}
        {page.kind === 'tnt-scorecard' && <TntScorecard pg={page} />}
        {page.kind === 'synchro' && <Synchro pg={page} />}
        {page.kind === 'artistic-rotation' && <ArtisticRotation pg={page} />}
        {page.kind === 'tnt-rotation' && <TntRotation pg={page} />}
        <Footer page={page} centre={page.kind === 'artistic-rotation' || page.kind === 'tnt-rotation'} />
      </section>
    </div>
  );
}
