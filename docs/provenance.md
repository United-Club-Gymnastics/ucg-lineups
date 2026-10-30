# Provenance: files copied from ucg-platform

Source: `~/Developer/ucg-platform` (read-only), commit `32fb372`. Every copied file carries the header
`// Copied from ucg-platform@<sha> <path> — keep in sync by hand`.

| Platform path @ sha | Local path | What changed |
|---|---|---|
| `src/lib/competition-order.ts` @32fb372 | `src/lib/competition-order.ts` | Header only |
| `src/lib/squad-builder.ts` @32fb372 | `src/lib/squad-builder.ts` | `APPARATUS` import now from `./apparatus` |
| `src/lib/types.ts` @32fb372 | `src/lib/apparatus.ts` | Only `Discipline` and `APPARATUS` extracted |
| `tests/competition-order.test.ts` @32fb372 | `tests/competition-order.test.ts` | Header only |
| `tests/lib/squad-builder.test.ts` @32fb372 | `tests/lib/squad-builder.test.ts` | Header only |
| `src/components/ui.tsx` @32fb372 | `src/components/ui.tsx` | Only `Field`, `Modal`, `Badge`, `Tabs`; `Field` no longer auto-wires `Combo` (not copied) |
| `src/index.css` @32fb372 | `src/index.css` | Font-faces, `:root` tokens, base styles, and the `.btn`/`.badge`/`.field`/`.input`/`.tabs`/`.modal` rules only. Step 3: closed a dangling `H7` comment that hid the `.badge` rules, and appended the `.co-apparatus-grid` / `.co-drop-*` rules from @e57754a |
| `src/components/CompetitionOrderCard.tsx` @e57754a | `src/components/CompetitionOrderCard.tsx` | Controlled component: props `athletes`, `discipline`, `groups`, `sections`, `editable`, `apparatus`, `onChange`. Removed the platform store, Supabase pushes, toasts, event lock, people slices, the level `<select>` and card shell, and the reconcile-and-persist effect. Deviation: one `DndContext` for all groups of the shown apparatus (one `SortableContext` + droppable per group) so athletes can be dragged between groups (`dropAthlete` in `club-order-model.ts`); one apparatus shown at a time. Drop line, sensors, announcements and the "→ B" buttons kept |
| `tests/components/competition-order-groups.test.tsx` @e57754a | `tests/components/competition-order-groups.test.tsx` | Rewritten around a state harness for the controlled card; lock/toast/store tests dropped; read-only, apparatus filter and `membershipChanged` tests added; cross-group drag in `tests/components/cross-group-drag.test.tsx` (new) |
| `src/assets/brand/mark.svg` @d4fd8ba | `src/lib/pdf/logo-mark.ts` | Step 6: only the seven path outlines, as strings (viewBox 126), so jsPDF draws the UCG mark as black vectors and the preview fills the same paths black. No font, no `mark.png`; the "United Club Gymnastics" wording beside it is set in Helvetica |

## Ported from nationals-tools (read-only), commit `0b8116a`

Not byte copies: a React rewrite of the vanilla-JS dropdown, keeping its look and keyboard behaviour.

| nationals-tools path @ 0b8116a | Local path | What changed |
|---|---|---|
| `public/shared/select.js` | `src/components/Select.tsx` | Rewritten as a React component (`value` / `onChange(value)` / `options`). Kept: button with `role=combobox`, `aria-haspopup/expanded/controls/activedescendant`, `role=listbox` / `role=option` / `aria-selected`, Up/Down/Home/End, Enter/Space, Escape, Tab closes, focus stays on the button. Added: multi-letter typeahead (the original matched one letter), disabled options skipped, Escape handled in the window capture phase so an enclosing dialog does not close too, a hidden input carrying the value (forms; a dialog notices the change), the list drawn in a fixed-position portal that shifts and flips to stay on screen |
| `public/shared/enhance-selects.js` | `src/components/Select.tsx` | Its label wiring (`label[for]` or `aria-label` names the box) is covered by `Field` recognising `Select` (`src/components/ui.tsx`) plus the `aria-label` prop; its "hide the native select" mechanism is not needed (we replace the `<select>` elements instead) |
| `public/shared/styles.css` lines ~96-113 (`select` rules) and ~335-375 (`.dd-*`, `.combo-list`) | `src/components/select.css` | `.dd-button`, `.dd-list` (was `.combo-list`), chevron, coral focus ring, bold selected, light-blue active/hover. Changed: focus border is `--coral-text` (5.2:1 on white) instead of `--coral-500` (2.9:1); `position: fixed` list; `.dd-sm` compact size; ellipsis on the box, wrapping in the list |

Config copied and simplified (not provenance-tracked code): `tsconfig*.json`, `eslint.config.js`.

## Not copied (decided in step 4)

- `src/components/ClubGroupSquadBuilder.tsx` @32fb372: built fresh instead as `src/components/SquadBoard.tsx` (it is wired to the platform store, Supabase pushes and toasts; the layout, labels and swap/specialist behaviour follow the approved prototype). `SquadBoard.tsx` carries a header saying so. Its `squad-builder.ts` helpers are reused unchanged through `src/lib/squad-balance.ts`.

## Not copied

Fonts: the licensed woff2 files are never committed; `@font-face` rules point at the platform's public `brand` bucket.

- `src/index.css` `.badge`: radius changed from 99px to `var(--radius-sm)` and `line-height: 1.35` added (2026-10-18), because wrapped badges looked like ovals.

- `public/favicon.svg`: white mark paths from ucg-platform `src/assets/brand/mark-white.svg` (@32fb372, public artwork) on a #184b56 circle; PNG icons resized from Julia's supplied image (2026-10-19).

## Session reminder email (ucg-platform `5824208e`, 2026-10-30)

| Platform path @ 5824208e | Local path | What changed |
|---|---|---|
| `supabase/functions/_shared/session-reminder-email.ts` | `src/lib/email/session-reminder-email.ts` | Header only |
| `supabase/functions/_shared/email-layout.ts` | `src/lib/email/email-layout.ts` | Header only |
| `supabase/functions/_shared/session-time.ts` | `src/lib/email/session-time.ts` | Header only |
| `supabase/functions/_shared/session-date.ts` | `src/lib/email/session-date.ts` | Header only |
| `tests/session-reminder-email.test.ts` | `tests/lib/session-reminder-email.test.ts` | Header; import path |
