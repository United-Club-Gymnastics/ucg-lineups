// HTML preview of the SAME page models the PDF is drawn from (src/lib/pdf/model.ts), at paper size (points), black and white.
// A paper scrolls inside its own box on a narrow screen; the page itself never scrolls sideways.
import { rowUnits } from '../lib/pdf/artistic-rotation-content';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MARK_PATHS, MARK_SIZE } from '../lib/pdf/logo-mark';
import {
  BRAND_NAME, HEAVY_BOX_STYLE, LETTER, MARGIN, SITE, TIMELINE_ROW_UNITS, artisticRotationUnit, artisticRowHeight, columnWidths, isLandscape, tntAthleteHeight, tntRotationUnit,
  type ArtisticRotationPage, type ArtisticScorecardPage, type Column, type Page, type SynchroPage, type TntRotationPage, type TntRow, type TntScorecardPage,
} from '../lib/pdf/model';
import { pageLabel } from '../lib/pdf/labels';
import { splitPair } from '../lib/pdf/pair';
import { QR_SIZE, qrModules } from '../lib/pdf/sheet-qr';
import './pdf-preview.css';

const pt = (n: number) => `${n}pt`;
const cols = (columns: { weight: number }[], total: number) => columnWidths(columns, total).map(pt).join(' ');

/**
 * Cell edges. Each shared edge belongs to ONE cell (its right and bottom, plus the table's left and top), so it is drawn once, as the
 * PDF does. The weights follow HEAVY_BOX_STYLE exactly like the PDF: a vertical edge is heavy when either box beside it is; a
 * horizontal edge is heavy only in style 'B'.
 */
const THIN_W = 0.75;
const HEAVY_W = 2.4;
const vertW = (heavy: boolean) => (heavy ? HEAVY_W : THIN_W);
const horizW = (heavy: boolean) => (heavy && HEAVY_BOX_STYLE === 'B' ? HEAVY_W : THIN_W);
interface Edges { t?: number; r?: number; b?: number; l?: number }
const edges = (e: Edges): CSSProperties => ({
  '--bt': pt(e.t ?? 0), '--br': pt(e.r ?? 0), '--bb': pt(e.b ?? 0), '--bl': pt(e.l ?? 0),
} as CSSProperties);
const rightOf = (cs: Column[], i: number) => vertW(cs[i].heavy || (i + 1 < cs.length && cs[i + 1].heavy));
const boxClass = () => 'pv-cell';

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
        <div className="pv-qrlock">{pg.qr && <Qr text={pg.qr} />}<div className="pv-small">{pg.meet.date}<br /><i className="pv-grey">Printed {pg.printedOn}</i></div></div>
        <div className="pv-meet">{pg.meet.name}</div>
        <div className="pv-right"><Lockup size={26} right /><b><i>{pg.gym}<br />{pg.session}</i></b></div>
      </div>
      <div className="pv-band">
        <span className="pv-squad"><b>Squad</b> <b className="pv-squad-letter">{pg.band.squad}</b></span>
        <span className="pv-apparatus">{pg.band.apparatus}</span>
        <span className="pv-rot">{pg.band.discipline}{pg.band.rotation != null ? ` · Rotation ${pg.band.rotation}` : ''}{pg.band.equipment ? ` · ${pg.band.equipment}` : ''}</span>
      </div>
      <div className="pv-grid pv-headrow" style={{ gridTemplateColumns: grid, height: pt(26) }} role="presentation">
        {pg.columns.map((c, i) => (
          <div key={c.id} className={`${boxClass()} pv-th${c.kind === 'text' ? ' pv-left' : ''}`} style={edges({ t: horizW(c.heavy), b: horizW(c.heavy), r: rightOf(pg.columns, i), l: i === 0 ? vertW(c.heavy) : 0 })}>
            <b>{c.header}</b>{c.sub && <small>{c.sub}</small>}
          </div>
        ))}
      </div>
      {pg.rows.map((r, i) => (
        <div key={i} className={`pv-grid pv-row${r.levelBreak ? ' pv-break' : ''}`} style={{ gridTemplateColumns: grid, height: pt(rowH) }}>
          {pg.columns.map((c, ci) => (
            <div key={c.id} className={`${boxClass()}${c.kind === 'text' ? ' pv-left' : ''}`} style={edges({ b: pg.rows[i + 1]?.levelBreak ? 0 : horizW(c.heavy), r: rightOf(pg.columns, ci), l: ci === 0 ? vertW(c.heavy) : 0 })}>
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

/** The sheet's QR code (same modules as the PDF), labelled for screen readers by what it links to. */
function Qr({ text }: { text: string }) {
  const m = qrModules(text);
  return (
    <svg className="pv-qr" viewBox={`0 0 ${m.length} ${m.length}`} width={pt(QR_SIZE)} height={pt(QR_SIZE)} role="img" aria-label={`QR code: ${text}`} shapeRendering="crispEdges">
      <path d={m.flatMap((row, r) => row.map((on, c) => (on ? `M${c} ${r}h1v1h-1z` : ''))).join('')} fill="#000" />
    </svg>
  );
}

function SheetHeader({ title, subtitle, meet, printedOn, qr }: { title: string; subtitle: string; meet: { name: string; date: string }; printedOn: string; qr?: string }) {
  return (
    <div className="pv-head3 pv-sheethead">
      <div className="pv-qrlock">{qr && <Qr text={qr} />}<Lockup size={28} /></div>
      <div><div className="pv-title">{title}</div><div className="pv-sub">{subtitle}</div></div>
      <div className="pv-right pv-small"><b>{meet.name}</b><br />{meet.date}<br /><i className="pv-grey">Printed {printedOn}</i></div>
    </div>
  );
}

/** Lines in one score box: the row's own count (High Flyers trampoline: 2), else the page's; a `single` column is always one. */
const linesOf = (c: Column, r: TntRow, pg: TntScorecardPage): number => (c.single ? 1 : r.passes ?? pg.passes);

function TntScorecard({ pg }: { pg: TntScorecardPage }) {
  const h = tntAthleteHeight(pg.rows.length);
  const grid = cols(pg.columns, LETTER.h - 2 * MARGIN);
  return (
    <>
      <SheetHeader title={pg.title} subtitle={pg.subtitle} meet={pg.meet} printedOn={pg.printedOn} qr={pg.qr} />
      <div className="pv-grid pv-headrow pv-tnt-head" style={{ gridTemplateColumns: grid, height: pt(20) }}>
        {pg.columns.map((c, i) => <div key={c.id} className={`${boxClass()} pv-th${c.id === 'name' ? ' pv-left' : ''}`} style={edges({ t: horizW(c.heavy), b: horizW(c.heavy), r: rightOf(pg.columns, i), l: i === 0 ? vertW(c.heavy) : 0 })}>{c.header}</div>)}
      </div>
      {pg.rows.map((r, i) => (
        <div key={i} className={`pv-grid pv-row pv-tnt-row${r.levelBreak ? ' pv-break' : ''}`} style={{ gridTemplateColumns: grid, height: pt(h) }}>
          {pg.columns.map((c, ci) => c.kind === 'box' ? (
            <div key={c.id} className="pv-passes">
              {Array.from({ length: linesOf(c, r, pg) }, (_, k) => (
                <div key={k} className={boxClass()} style={edges({ b: k === linesOf(c, r, pg) - 1 && pg.rows[i + 1]?.levelBreak ? 0 : horizW(c.heavy), r: rightOf(pg.columns, ci) })} />
              ))}
            </div>
          ) : (
            <div key={c.id} className={`${boxClass()}${c.id === 'name' ? ' pv-left' : ''}`} style={edges({ b: pg.rows[i + 1]?.levelBreak ? 0 : THIN_W, r: rightOf(pg.columns, ci), l: ci === 0 ? vertW(c.heavy) : 0 })}>
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
  const row = (cs: Column[], label: boolean, h: number, top: boolean) => (
    <div className="pv-sy-boxes" style={{ gridTemplateColumns: 'repeat(5, 1fr)', height: pt(h) }}>
      {cs.map((c, k) => <div key={c.id} className={`${boxClass()} pv-th`} style={edges({ t: top ? horizW(c.heavy) : 0, b: horizW(c.heavy), r: rightOf(cs, k), l: k === 0 ? vertW(c.heavy) : 0 })}>{label ? c.header : ''}</div>)}
    </div>
  );
  return (
    <>
      <SheetHeader title={pg.title} subtitle={pg.subtitle} meet={pg.meet} printedOn={pg.printedOn} qr={pg.qr} />
      <div className="pv-small pv-sy-scratch">Scratch?</div>
      {pg.pairs.map((q, i) => {
        const [n1, n2] = splitPair(q.names);
        return (
          <div key={i} className={`pv-sy${q.levelBreak ? ' pv-break' : ''}`}>
            <div className="pv-sy-chk"><Check size={13} /></div>
            <div className="pv-sy-name">
              <div className="pv-cell pv-left pv-th" style={{ height: pt(13), ...edges({ t: THIN_W, b: THIN_W, l: THIN_W }) }}>Pair / Club</div>
              <div className="pv-cell pv-left pv-sy-names" style={edges({ b: THIN_W, l: THIN_W })}><b>{n2 ? `${n1} &` : n1}</b>{n2 && <b>{n2}</b>}<i className="pv-club">{q.club}</i></div>
            </div>
            <div className="pv-sy-lv">
              <div className="pv-cell pv-th" style={{ height: pt(13), ...edges({ t: THIN_W, b: THIN_W, l: THIN_W }) }}>Level</div>
              <div className="pv-cell pv-sy-level" style={edges({ b: THIN_W, l: THIN_W })}><b className="pv-lv">{q.level}</b></div>
            </div>
            <div className="pv-sy-grid">
              {row(pg.row1, true, 13, true)}{row(pg.row1, false, 22, false)}{row(pg.row2, true, 13, false)}{row(pg.row2, false, 22, false)}
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
  const colW = pg.columnWidth;
  const grid = `1fr repeat(${pg.columnCount}, ${pt(colW)})`;
  const tu = u * TIMELINE_ROW_UNITS;
  return (
    <>
      <div className="pv-rtitle">{pg.title}</div>
      <div className="pv-rsub">{pg.subtitle}</div>
      <div className="pv-sched">
        <div><b className="pv-underline">Schedule</b><div className="pv-sched-items">{pg.schedule.map((s) => <span key={s.label}><b>{s.time || '--'}</b> {s.label}</span>)}</div></div>
        <b><i>Session athlete count: {pg.athleteCount}</i></b>
      </div>
      {pg.squads.map((s) => (
        <div key={s.letter} className={`pv-squadblock${pg.hasNotes ? ' pv-withnotes' : ''}`} style={{ marginBottom: pt(u * 0.8), fontSize: pt(Math.min(9, u * 0.62)) }}>
          <div className="pv-squadtable">
          <div className="pv-rgrid pv-rhead" style={{ gridTemplateColumns: grid, height: pt(u * 1.5) }}>
            <b className="pv-rsquad">{s.heading}</b>
            {s.columns.map((c, k) => <b key={k} className={c.length > 6 ? 'pv-long' : undefined}>{c}</b>)}
          </div>
          {s.empty && <div className="pv-rgrid pv-rrow" style={{ gridTemplateColumns: '1fr', height: pt(u) }}><i className="pv-grey" style={{ paddingLeft: pt(5) }}>No club groups placed</i></div>}
          {s.rows.map((r, i) => (
            <div key={i} className={`pv-rgrid pv-rrow${r.alt ? ' pv-alt' : ''}${r.levelBreak ? ' pv-dash' : ''}`} style={{ gridTemplateColumns: grid, height: pt(u * rowUnits(r)) }}>
              {r.names
                ? <span className="pv-rlabel pv-rlabel2"><b>{r.label}</b><span className="pv-rnames">{r.names}</span></span>
                : <b className="pv-rlabel">{r.label}</b>}
              {r.counts.map((v, k) => <span key={k} className={v ? 'pv-n' : 'pv-n pv-zero'}>{v === null ? '' : v}</span>)}
            </div>
          ))}
          </div>
          {pg.hasNotes && <div className="pv-notes">{s.notes.map((n, i) => <p key={i}>{n}</p>)}</div>}
        </div>
      ))}
      {pg.timeline && (
        <table className="pv-timeline" style={{ fontSize: pt(Math.min(7, tu * 0.62)), marginTop: pt(u * 0.4) }}>
          <thead>
            <tr style={{ height: pt(tu) }}><th /> {pg.timeline.header.map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {pg.timeline.rows.map((r) => (
              <tr key={r.letter} style={{ height: pt(tu) }}>
                <th>{r.letter}</th>
                {r.cells.map((c, k) => <td key={k} className={/^\((C|W\/C)\)/.test(c) ? 'pv-compete' : undefined}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
