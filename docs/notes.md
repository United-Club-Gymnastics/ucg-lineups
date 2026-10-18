# Build notes

## Step 1 — scaffold

- **Test config:** a separate `vitest.config.ts` (as in the platform) instead of putting `test` in `vite.config.ts`; vitest bundles its own vite copy and the plugin types clash with vite 8. jsdom for all tests, with RTL `cleanup` in `tests/setup.ts` (vitest globals are off).
- **Tests are not type-checked** by `tsc -b` (same as the platform): the copied `squad-builder.test.ts` has a fixture that fails strict types. They run fine under vitest.
- **No existing platform tests** cover `Field`/`Modal`/`Tabs` directly, so `tests/components/ui.test.tsx` is new (label association, dialog role/Escape/focus trap, tabs, badge).
- **`Field`** loses its `Combo` auto-wiring (Combo not copied); native controls only.
- **Fonts:** `@font-face` URLs are the platform's Supabase `brand` bucket (as copied); `@fontsource` packages are the fallback.
- **Firebase** is initialised but not yet imported by any screen, so it is tree-shaken out of the current build.
- Firebase config files exist but nothing is deployed; `firestore.rules` denies everything until a later step.
