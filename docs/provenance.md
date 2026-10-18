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

Config copied and simplified (not provenance-tracked code): `tsconfig*.json`, `eslint.config.js`.

## Not copied (decided in step 4)

- `src/components/ClubGroupSquadBuilder.tsx` @32fb372: built fresh instead as `src/components/SquadBoard.tsx` (it is wired to the platform store, Supabase pushes and toasts; the layout, labels and swap/specialist behaviour follow the approved prototype). `SquadBoard.tsx` carries a header saying so. Its `squad-builder.ts` helpers are reused unchanged through `src/lib/squad-balance.ts`.

## Not copied

Fonts: the licensed woff2 files are never committed; `@font-face` rules point at the platform's public `brand` bucket.
