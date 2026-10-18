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
| `src/index.css` @32fb372 | `src/index.css` | Font-faces, `:root` tokens, base styles, and the `.btn`/`.badge`/`.field`/`.input`/`.tabs`/`.modal` rules only |

Config copied and simplified (not provenance-tracked code): `tsconfig*.json`, `eslint.config.js`.

## To copy (later steps)

- `src/components/CompetitionOrderCard.tsx`
- `src/components/ClubGroupSquadBuilder.tsx`

## Not copied

Fonts: the licensed woff2 files are never committed; `@font-face` rules point at the platform's public `brand` bucket.
