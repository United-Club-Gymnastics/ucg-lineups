// A styled dropdown, ported from the other UCG tools: nationals-tools public/shared/select.js + enhance-selects.js (see
// docs/provenance.md). A box with a chevron and a coral focus ring that opens a rounded, shadowed option list; the chosen
// option is bold, the hovered/active one light blue. ARIA "select-only combobox" + listbox pattern: the box is a button with
// role=combobox that keeps focus the whole time (aria-activedescendant names the highlighted option).
// Keys: Down/Up open then move, Home/End, Enter/Space choose (or open), Escape closes, Tab leaves, letters jump (typeahead).
// The list is drawn in a portal with fixed positioning, so a table or a scrolling card never clips it, and it flips/shifts to
// stay on screen near the right and bottom edges.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import './select.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Used for the box; `Field` sets it so its label points here. */
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Shown when `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  /** `sm`: a compact box for table rows and cards. */
  size?: 'md' | 'sm';
  className?: string;
  style?: CSSProperties;
}

const MARGIN = 8;
const GAP = 4;
const MAX_LIST = 320;
const TYPEAHEAD_MS = 600;

interface Pos { left: number; top?: number; bottom?: number; minWidth: number; maxHeight: number; maxWidth: number }

export default function Select({
  value, onChange, options, id, name, placeholder = 'Select…', disabled = false, size = 'md', className, style, ...aria
}: SelectProps) {
  const autoId = useId();
  const baseId = id ?? `sel-${autoId.replace(/:/g, '')}`;
  const listId = `${baseId}-list`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<Pos | null>(null);
  const typed = useRef({ text: '', at: 0 });

  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const current = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const isPlaceholder = !current || current.value === '';

  const enabled = (i: number) => i >= 0 && i < options.length && !options[i].disabled;
  const firstEnabled = () => options.findIndex((o) => !o.disabled);
  const lastEnabled = () => options.length - 1 - [...options].reverse().findIndex((o) => !o.disabled);
  /** The next enabled option from `from` in direction `dir`, or `from` when there is none. */
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (!options[i].disabled) return i;
    return from;
  };

  const openList = () => {
    if (disabled || options.length === 0) return;
    setActive(enabled(selectedIndex) ? selectedIndex : firstEnabled());
    setOpen(true);
  };
  const closeList = useCallback(() => { setOpen(false); setPos(null); }, []);
  const choose = (i: number) => {
    if (!enabled(i)) return;
    const changed = options[i].value !== value;
    closeList();
    buttonRef.current?.focus();
    if (changed) onChange(options[i].value);
  };

  // Where the list goes: under the box, left edges aligned, shifted left if it would pass the right edge, flipped above when
  // there is little room below. Re-measured when it opens, on resize and on any scroll.
  const place = useCallback(() => {
    const b = buttonRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const natural = listRef.current?.offsetWidth ?? r.width;
    const maxWidth = Math.max(120, vw - 2 * MARGIN);
    const width = Math.min(Math.max(natural, r.width), maxWidth);
    const left = Math.max(MARGIN, Math.min(r.left, vw - MARGIN - width));
    const below = vh - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const flip = below < 160 && above > below;
    setPos(flip
      ? { left, bottom: vh - r.top + GAP, minWidth: r.width, maxHeight: Math.min(MAX_LIST, above), maxWidth }
      : { left, top: r.bottom + GAP, minWidth: r.width, maxHeight: Math.min(MAX_LIST, Math.max(120, below)), maxWidth });
  }, []);
  useLayoutEffect(() => { if (open) place(); }, [open, place, options]);
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    // Scrolling the list itself must not re-place it (that re-render snapped it back to the highlighted option).
    const onScroll = (e: Event) => { if (!listRef.current?.contains(e.target as Node)) place(); };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onScroll, true);
    // Escape is handled here, in the capture phase on the window, so a dialog around the box (which also listens for Escape)
    // does not close with the list.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      closeList();
      buttonRef.current?.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, place, closeList]);
  // Keep the highlighted option in view when it changes (keyboard, typeahead) or the list first opens — not on every
  // re-placement, so the mouse wheel / trackpad can scroll the list freely.
  const placed = pos !== null;
  useEffect(() => {
    if (!open || !placed || active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, placed, active, listId]);
  // A disabled box (or one that lost its options) shows no list, whatever `open` says.
  const showList = open && !disabled && options.length > 0;

  function typeahead(key: string, now: number) {
    if (options.length === 0) return;
    const t = typed.current;
    t.text = now - t.at > TYPEAHEAD_MS ? key : t.text + key;
    t.at = now;
    const text = t.text.toLowerCase();
    // The same letter pressed repeatedly cycles through the options that start with it.
    const cycling = text.length > 1 && [...text].every((c) => c === text[0]);
    const needle = cycling ? text[0] : text;
    const from = (open ? active : selectedIndex) + (cycling || text.length === 1 ? 1 : 0);
    const order = [...options.keys()].map((_, i) => (from + i) % options.length);
    const hit = order.find((i) => !options[i].disabled && options[i].label.trim().toLowerCase().startsWith(needle));
    if (hit === undefined) return;
    if (open) setActive(hit);
    else if (options[hit].value !== value) onChange(options[hit].value);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
      e.preventDefault();
      if (!open) { openList(); return; }
      setActive((a) => (k === 'Home' ? firstEnabled() : k === 'End' ? lastEnabled() : step(a, k === 'ArrowDown' ? 1 : -1)));
    } else if ((k === 'Enter' || k === ' ') && open) {
      e.preventDefault();
      choose(active);
    } else if (k === 'Tab') {
      if (open) closeList();
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(k)) {
      typeahead(k, e.timeStamp);
    }
  }

  const list = showList && (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      tabIndex={-1}
      aria-label={aria['aria-label']}
      aria-labelledby={aria['aria-labelledby']}
      className="dd-list"
      style={{ ...pos, visibility: pos ? 'visible' : 'hidden' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {options.map((o, i) => (
        <li
          key={`${o.value}-${i}`}
          id={`${listId}-${i}`}
          role="option"
          data-value={o.value}
          aria-selected={i === selectedIndex}
          aria-disabled={o.disabled || undefined}
          className={`${i === active ? 'dd-active' : ''}${o.value === '' ? ' dd-placeholder' : ''}`.trim() || undefined}
          onMouseDown={(e) => e.preventDefault() /* keep focus on the box */}
          onMouseMove={() => { if (!o.disabled && active !== i) setActive(i); }}
          onClick={() => choose(i)}
        >
          {o.label}
        </li>
      ))}
    </ul>
  );

  return (
    <div className={`dd${size === 'sm' ? ' dd-sm' : ''}${className ? ` ${className}` : ''}`} style={style}>
      <button
        ref={buttonRef}
        type="button"
        id={baseId}
        className="dd-button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        disabled={disabled}
        onClick={() => (open ? closeList() : openList())}
        onBlur={closeList}
        onKeyDown={onKeyDown}
      >
        <span className={`dd-text${isPlaceholder ? ' dd-placeholder' : ''}`}>{current ? current.label : placeholder}</span>
      </button>
      {/* Gives forms a value, and lets a dialog notice that the choice changed. */}
      <input type="hidden" name={name} value={value} readOnly />
      {list && createPortal(list, document.body)}
    </div>
  );
}
