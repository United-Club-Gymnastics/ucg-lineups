# Build notes

## Step 1 — scaffold

- **Test config:** a separate `vitest.config.ts` (as in the platform) instead of putting `test` in `vite.config.ts`; vitest bundles its own vite copy and the plugin types clash with vite 8. jsdom for all tests, with RTL `cleanup` in `tests/setup.ts` (vitest globals are off).
- **Tests are not type-checked** by `tsc -b` (same as the platform): the copied `squad-builder.test.ts` has a fixture that fails strict types. They run fine under vitest.
- **No existing platform tests** cover `Field`/`Modal`/`Tabs` directly, so `tests/components/ui.test.tsx` is new (label association, dialog role/Escape/focus trap, tabs, badge).
- **`Field`** loses its `Combo` auto-wiring (Combo not copied); native controls only.
- **Fonts:** `@font-face` URLs are the platform's Supabase `brand` bucket (as copied); `@fontsource` packages are the fallback.
- **Firebase** is initialised but not yet imported by any screen, so it is tree-shaken out of the current build.
- Firebase config files exist but nothing is deployed; `firestore.rules` denies everything until a later step.

## Step 2 — import

- **Vite `base` is now `'./'`** so the built site works at `united-club-gymnastics.github.io/ucg-lineups/` (HashRouter) until the custom domain is set, and at the custom domain afterwards.
- **Bibs are NOT unique per discipline in the real 2026 exports.** 25 discipline+bib keys cover 72 extra rows (bib `1014` is a placeholder shared by dozens of unrelated athletes; the rest are two-club collisions). The spec key `<DISC>_<bib>` is used when a bib is unique; when several athletes share one, every one is kept with id `<DISC>_<bib>~<first-last-slug>` (+`~n` if still clashing), with one `shared-bib` warning per bib. Discipline-export rows are joined by bib, and by first+last name when the bib is shared. **Needs a ruling from Julia** (can ScoreFlippers bibs be fixed, or is the name-suffixed id acceptable?).
- **Parsing:** headers are matched case-insensitively after dropping `_x000d_`/line breaks/extra spaces; rows are keyed by the normalised header. Detection is by headers only. The club email workbook uses the first sheet with "Nationals" in its name, else the first matching sheet.
- **Levels:** the export's `LevelShortName` is used (Dev, Int, Adv, XS, XP, XD, L9, NF…); anything with "Open Scoring" (or short name `Open`) becomes Infinity / `Inf`. Display names drop the `NAIGC ` prefix. T&T athlete level comes from the athletes export; per-event levels (NF/IF/HF) come from the T&T export and are stored only for Included events (`tnt`). For T&T, `apparatus` holds the Included event codes in TR, DM, TU, SY order (same keys as `tnt`), so synchro-only athletes compete with `apparatus: ['SY']`.
- **Independents** ("Independent …" clubs) are flagged `independent: true`, get no `Club` record, no emails and no warnings. Their `clubId` is still the name slug.
- **Warnings** (codes): `shared-bib`, `not-in-export` (athlete missing from a supplied discipline export), `no-export` (discipline export not supplied at all), `unmatched-row`, `email-unmatched`, `no-email` (only when a club email file is supplied), `bad-session`, `missing-bib`, `unknown-type`, `mixed-session`. Athletes missing from the discipline export get `apparatus: []`, `competes: false`.
- **Sessions:** id `s<number>-<gym>`; each real session holds a single discipline. `Session.discipline` is the majority discipline (with a `mixed-session` warning otherwise). Sorted by number then gym order (default Green, Red, Yellow, Orange, Purple).
- **Firestore layer** (`src/lib/data/`): `planImport` is pure and tested; `applyImport` only commits its ops in batches of 450. Athletes are written with `merge: false` (so a scratched T&T event actually disappears); removed athletes get `{ removed: true }` (merge); sessions and clubs merge; existing clubs keep their token and keep stored emails when the import carries none (a re-imported email list does overwrite). `settings/meet` defaults are written only if it does not exist. `clubLinks` is not written yet (step 3). **Nothing has run against a live Firebase project.**
- **UI:** the admin shell holds the tab state in React (no routes yet). Import screen requires "Load stored data" before Apply, so a failed read can never look like "everything is new". ExcelJS is lazy-loaded with the Import screen.
- **Real-export check:** `npx tsx scripts/check-real-exports.mts` (counts only, never names). `tsx` added as a dev dependency. The `scripts/` folder is not type-checked or linted.
