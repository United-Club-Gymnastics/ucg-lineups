# UCG Lineups

Stopgap tool for UCG Nationals: clubs set competing order, UCG builds squads, and the app prints
scorecards and rotation sheets. It will be thrown away once the UCG platform does this, so keep
logic in small pure modules that can be ported. **Read `docs/spec.md` before changing behaviour**;
pivots during the build go in `docs/notes.md`.

React + TypeScript + Vite on GitHub Pages (`lineups.unitedclubgymnastics.org`), Firebase project
`ucg-lineups` (Firestore + Google sign-in). Push to `main` runs tests and deploys the site.
Firestore rules are deployed by hand, only with Julia's go-ahead.

## Where things live

| What | Where |
|---|---|
| Decisions (Julia's rulings) | `docs/spec.md` |
| Deviations / build notes | `docs/notes.md` |
| Files copied from ucg-platform | `docs/provenance.md` |
| Pure logic (import, ordering, squads, rotations, PDF layout, email lists) | `src/lib/` |
| Screens | `src/pages/`, `src/components/` |
| Security | `firestore.rules` (+ `tests/rules/`) |

## Reuse from the UCG platform (read-only)

`~/Developer/ucg-platform` is **read-only** from here: never edit, commit, branch or run git
writes there (another session works in it). Copy files instead of linking, and put this header on
every copied file: `// Copied from ucg-platform@<short sha> <path> — keep in sync by hand`, and
list it in `docs/provenance.md` (with what was changed), so logic can be ported back and forth.
Licensed brand font files must never be committed (EULA); they load from the platform's public
`brand` bucket, with @fontsource fallbacks.

## Working style

- Two equal owners: Julia (domain owner; business rules resolve against her) and Nate. Do as much
  as possible directly; when blocked only on a one-time setup or permission, ask for just that.
- After dev work: verify → merge to `main` → push (deploys) without asking, **except** anything
  that sends real email, touches access control or secrets, or changes `firestore.rules` — those go
  through a PR + code review and Julia's OK. Ask whether Nate is clear before merging when he is
  also working in the repo. Never force-push `main`.
- Live backend deploys (rules) and DNS changes need Julia's explicit go-ahead each time.
- **Email:** never send to a real club without Julia's go-ahead for that send. Until then only to
  `jzsharpe+…@gmail.com` / `nssharpe+…@gmail.com`. Never use the UCG platform's Resend account.
- Never spawn background task chips or unattended offload agents. Implementation is
  subagent-driven, one implementer at a time.
- Title sessions with the owner's initials (`JS: …` / `NS: …`).

## Verification (before every commit)

`npm run build`, `npx eslint <touched files>`, `npm test` (plus a test for any new pure logic).
Report the commands and their output — evidence before assertions. Check text contrast (WCAG AA,
≥ 4.5:1 body, ≥ 3:1 large/UI) on every colour pairing — never text on a same-or-similar colour —
and check pages at 375 / 768 / 1280 px with no horizontal overflow.

## Brand

Navy `#1e2b38`, light blue `#dbebee`, red-orange `#f4694a` (navy text on it; `#bd3f27` for
coral text on light). Pale accents (blue-green, purple, gold) are fills only. Display type =
condensed caps. **Printed exports are black and white only.**
