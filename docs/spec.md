# UCG Lineups — spec

Stopgap meet-day tool for UCG Nationals: clubs set competing order, UCG builds squads, and the
app prints scorecards and rotation sheets. It will be replaced by the UCG platform
(`~/Developer/ucg-platform`), so the exports must look like what the platform will produce, and
layout logic lives in pure modules the platform can take over.

Approved prototype: https://claude.ai/artifact/4ar1y7fF9f19xrYYfwzBvX (mock data only).
Decisions below are Julia's unless marked *(assumption)*; they came from the prototype comment
threads on 2026-10-18.

## 1. Stack

- React 19 + TypeScript + Vite, hosted on **GitHub Pages** at `lineups.unitedclubgymnastics.org`
  (repo `United-Club-Gymnastics/ucg-lineups`). Push to `main` → test → build → deploy.
- **Firebase project `ucg-lineups`** (UCG Google Cloud): Firestore + Firebase Auth (Google).
  Security lives in `firestore.rules`. Rules are deployed by hand with Julia's go-ahead.
- Admins: any verified `@unitedclubgymnastics.org` Google account, or an `admins/{email}` doc.
- Sign-in uses `signInWithPopup` through `ucg-lineups.firebaseapp.com` (GitHub Pages has no
  `/__/auth` handler; same as gymact-waiver).
- Email: the signed-in admin's own Gmail via the Gmail API (`gmail.send` scope requested by a
  re-auth popup, short-lived token, nothing stored), From = the admin's *Send mail as* alias
  `info@unitedclubgymnastics.org`. Same pattern as nationals-tools
  (`public/shared/firebase.js` `connectGmail`, `public/registration/admin-email.js`).
- PDFs: jsPDF; "separate PDFs" downloads use JSZip. Spreadsheet import: ExcelJS.
- Synchro pairs are read directly from the Synchro partner tool's public Firestore collection
  `synchroPairs` in project `ucg-nationals-tools` (second Firebase app instance, read-only).

## 2. Import (admin)

Source files are ScoreFlippers/INSIGHT exports. **Never use `NAIGC Nationals_AthleteList`** (it
comes from SF Events and goes stale).

| File | Gives |
|---|---|
| `Athletes_Export.xlsx` | every entry: Bib, FirstName, LastName, Type (WAG/MAG/T&T), Club (**full name — always print this, never Team/short name**), Level, Session (`<session name> - <location>`: `Session 1 - Orange`, `MAG Finals - Orange`, `MAG Session 1 - Dupont`) |
| `WAG_Export.xlsx`, `MAG_Export.xlsx` | per-apparatus `*_Event_Status`: **Included or Excluded = competing that event**, Scratched or blank = not → the athlete's apparatus list |
| `TnT_Export.xlsx` | per-event level and status: Tumbling, Trampoline, Synch_Trampoline, DMT |
| `League_Communications_Export.xlsx` (preferred) or `Club_Emails.xlsx` | club contact emails: League export = Club, Contact, Role (only email roles used); Club_Emails = Club, Email (a cell may hold several, `;`-separated). Clubs in the list with no athletes are summarised in one warning. Editable in the app |

- **UCG doesn't use bibs** (Julia 2026-10-18) — they are ignored everywhere. Athlete key = **discipline + full club name + first/last name**; birth date is added only when two athletes in one club and discipline share a name. Discipline exports are matched the same way (club + name, then name alone, birth date as tiebreak).
- `SquadName` in the export is ignored — squads are built here, not in ScoreFlippers.
- Level `NAIGC Open Scoring` is renamed **Infinity** (WAG). Other levels keep their export names
  with short codes (MAG Dev/Int/Adv; WAG Silver XS, Platinum XP, Diamond XD, Level 9 L9, Infinity
  Inf; T&T NF/IF/HF).
- An athlete with no Included apparatus left is not placed (platform `competesAtLevel`).
- Re-import updates in place (upsert by key), never duplicates, and never loses saved orders,
  groups or squads. Athletes missing from a new import are marked removed (not deleted) and drop
  out of groups/squads through the platform's reconcile rules. The import screen shows a summary:
  added, changed, removed, unmatched rows.
- **Name fixes (per meet).** ScoreFlippers exports and the Synchro tool drop the spaces from some names ("MurrayMetzger",
  "StPierre"), and no source has the right spelling, so the host enters each fix once per meet on the Import tab: a first-name or
  last-name fix `{ field, from (as in the export), to (shown as) }`. `from` matches on the compact form (lowercase letters and
  digits), and `to` must keep the same compact form (only spaces, capitals, hyphens, accents change), so matching, ids, A–Z sort keys and
  saved orders never move: a fix is display only, and it applies everywhere a name is shown (club page, squads, competing order,
  synchro pairs, "Needs a session" and problem texts, emails, every PDF, Clubs & Emails). The Import tab suggests fixes for last
  names and first names with an inner capital after a lowercase letter (not Mc, Mac, De, Di, Da, Du, La, Le, Lo, Van, Von, O'),
  with the number of athletes; nothing applies until the host accepts one. Saving republishes the affected clubs' links. Fixes
  survive re-imports (the import compares and stores the export's spelling).
- **Sessions (`src/lib/session-names.ts`).** The export's session is `<session name> - <location>`: the name is anything, the
  location is a gym colour or a venue. It is split at the **last** ` - ` (` – ` and ` — ` too, spaces required), so names may
  hold hyphens ("Xcel Platinum - Day 2 - Green" = name "Xcel Platinum - Day 2", location "Green"). No separator = the whole
  string is the name, the location is empty, and the import warns once per such string. A session is `{ id, name, location,
  number?, discipline, levelCodes }` (`gym` is kept as an alias of `location` in stored documents and link documents).
  - **Back-compat (live data):** when the name is exactly `Session N`, the id stays `s<N>-<location lowercased>` (`s1-orange`),
    `number` is set, and the schedule key stays `"<N>"`. Sessions stored before names existed (`number` + `gym` only) read as
    `Session N` at that gym. Any other name: id `<slug(name)>--<slug(location)>`, schedule key = the name (matched ignoring case).
    The older loose forms ("Session 1-Orange", "Session 1: Orange", "Session 1 Orange") still read as `Session 1` / Orange.
  - **Location order** (`settings/meet.gymOrder`, default Green, Red, Yellow, Orange, Purple) takes any location names; locations
    not in it sort after, A–Z. Sessions sort by location, then name in natural numeric order (Session 2 before Session 10);
    club-facing lists (club page, Clubs & Emails, emails) sort by name, then location (the old number-then-gym order).
  - **Labels:** a session prints as `<name> – <location>`. A location that is a single colour word (Green, Red, Yellow, Orange,
    Purple, Blue, Teal, Pink, White, Black, Gray/Grey, Brown, Gold, Silver) prints as `<Colour> Gym` where the gym line showed
    ("Orange Gym"); a venue prints as written ("Dupont").

## 3. Club page (private link)

- One unguessable link per club **per meet**: `/#/c/<token>` (see §7a). It covers **all of the club's sessions** across
  MAG and WAG; each session shows its own status. T&T sessions show "Set by UCG" (clubs never order T&T).
- Order model = the platform's competition **groups** (`competition-order.ts`): a level's groups are
  the same athletes on every apparatus; only the order differs per apparatus. Per-apparatus cap
  12 WAG / 15 MAG inside a group.
- **Default order: A–Z by first name** (then last name) until the club changes something.
- **No submit step** — every change autosaves.
- Drag to reorder (dnd-kit; touch + keyboard). **No arrow buttons.** A drop line shows where the
  athlete lands. Athletes can be dragged between groups (and moved with a group menu); an athlete
  new to a group goes first on every other apparatus (platform rule). Moving an athlete between
  groups counts as deciding the split.
- When a level has more athletes than fit one squad (busiest apparatus > cap), the club sees the
  suggested split (`splitEvenly`) and **Keep this split**.
- Orders lock at the order deadline (enforced in rules); the host can still edit afterwards.
- The host can regenerate a club's token (old link stops working).

### Club status (derived, per session)
- **Needs to decide a split** — a level is over one squad's cap and the club hasn't kept/changed the split.
- **Still A–Z (default)** — nothing differs from the default groups and A–Z orders.
- **Order set** — something differs from the default.
- **Nothing to order** — every apparatus list has at most one athlete (no reminders).
- **Set by UCG** — T&T (no reminders).

## 4. Host — artistic squads (MAG/WAG)

Copied from the platform's `squad-builder.ts` / `ClubGroupSquadBuilder.tsx`: whole club groups
are placed into squads; independents are cards of one.

- **Rotation pattern per session**, picked on the Squads screen from the list for the session's
  discipline. Patterns are data (id, label, squad count, each squad's competing order, optional
  timeline, optional per-squad notes, equipment names); everything downstream (auto-balance, routines
  table, scorecard order and band, rotation sheet) reads the definition. The saved plan keeps the id;
  an id that is unknown for the discipline opens as the discipline's default, with a notice.
  - **Both disciplines:** one flight (WAG 4, MAG 6 squads) or two flights on A/B equipment (WAG 8,
    MAG 12; the only pattern with flights). **New/unsaved sessions default to WAG two flights on A/B
    equipment (8 squads) and MAG one flight (6 squads).** The 2024 "two flights with byes" pattern was
    removed (2026-10-18); a saved plan that used it opens as two flights on A/B equipment with a
    one-time notice.
  - **WAG, "7 squads (2 vaults, 2 beams)"** (from the NE Regionals 2026 sheet): equipment VT-Platform,
    VT-Ground, UB, BB-A, BB-B, FX. Squads A–G compete A VT-P UB BB-B FX; B BYE VT-G UB BB-A FX;
    C UB BB-A FX VT-P; D BB-A FX VT-P UB; E BYE BB-B FX VT-G UB; F FX VT-P UB BB-B; G BYE FX VT-G UB
    BB-A. It also has the 8-slot warm-up/compete timeline (W, C, W/C, BYE, -) and the per-squad notes
    from that sheet (see §6).
  - **MAG, three more:** "2 squads" (A FX PH SR VT PB HB; B PH FX VT SR HB PB), "3 squads" (A FX PH SR
    VT PB HB; B PH SR FX PB HB VT; C SR FX PH HB VT PB) and "3 squads, WAG overlap" (A FX VT PB PH SR HB;
    B VT PB FX SR HB PH; C PB FX VT HB PH SR). Fixed orders, no A/B equipment.
  Squads named A, B, C…
- **Auto-balance, in priority order:**
  1. never over the per-apparatus cap (12 WAG / 15 MAG) when avoidable;
  2. a club's groups stay together — whole club in one squad if it fits; else each level as a
     unit; else per group, and later pieces prefer a squad already holding that club;
  3. squads single-level where possible; **Infinity is never mixed with other levels** (hard rule;
     a manual mix is flagged, not blocked);
  4. athletes on only 1–2 apparatus go where their first apparatus comes earliest (the squad's first
     competing slot on it: its position in the order, or its timeline slot when the pattern has one);
  5. then even out the busiest apparatus.
- Within a squad, groups are listed by level, then club name (independents after clubs).
- **Swap all groups with** another squad (squads keep letter + start apparatus).
- **Routines per rotation** table (rotation × equipment, squad letter, totals, over-cap highlight).
  With a timeline (7 squads) the rows are its 8 slots and a squad counts where it competes (C or
  W/C); a warm-up-only slot adds nothing. The cap is per squad per apparatus (VT-Platform and
  VT-Ground are both Vault).
- Capacity guide: **MAG up to 80 in 6 squads, 160 in 12; WAG up to 85 in 8** (40 in 4 is the
  platform figure *(assumption)*). The other patterns use the same athletes-per-squad *(assumption)*
  (MAG 80/6, WAG 85/8 per squad: 7 squads ≈ 74, MAG 2 ≈ 26, 3 ≈ 40) and say it is an estimate. Warn
  above, never block.
- Dates and times are not entered here any more: see the **Session schedule** (§6). The Squads screen links to it.

## 5. Host — T&T

- Clubs don't order T&T. **3 squads** (A, B, C), usually 10–12 athletes, **max 15**.
  Rotation: A TR→DM→TU, B DM→TU→TR, C TU→TR→DM.
- **Auto-balance:** never over 15; a club's athletes together (a club over 15 splits by level,
  pieces kept close); then levels together by each athlete's **most common level** across
  TR/DM/TU (tie → higher); then even sizes.
- "Mixed levels" flag is per event (any event with more than one level in the squad).
- **Order per squad per event**, set by the admin by drag; default **HF > IF > NF, then club A–Z,
  then first name**. Only athletes entered on that event.
- Athletes entered only in synchro are not in a squad (listed as "Synchro only").
- **Synchro:** separate **flights** of pairs per T&T session, read from the Synchro tool (Refresh
  pairs: new pairs join the end of their level's flight, deleted pairs drop out, order otherwise
  kept). Admin drags order / moves between flights. Default: HF > IF > NF, then club, split evenly
  into two flights.
- **Synchro pair sessions:** people sometimes compete synchro in a different session than their
  other T&T events. A pair's default session is the T&T session both athletes are assigned to. If
  they are in different sessions, or the pair can't be matched, it goes to **"Needs a session"**
  (top of the Synchro flights section) until the host chooses one: no guessing. Every pair has a
  **Move to session** select (any T&T session); the choice is stored and Refresh pairs keeps it.
  Pair athletes are matched by club + name, then by name alone when exactly one T&T athlete has it
  (clubs get renamed after the Synchro tool read the roster; same-name ties are broken by the
  partner's club, then session, else unmatched). A pair is flagged **Check pair** when an athlete
  can't be matched or is on the roster but not entered in synchro. Exports put each pair on its
  session's synchro and rotation sheets and warn about pairs still needing a session.

## 6. Exports (print-ready PDF, black & white)

**Session schedule (Exports screen).** The meet date depends on the session and times repeat by session
number, so there is ONE table with a row per distinct session **name** (date, open stretch, timed warm-ups,
competition) that applies to every location's session with that name (every "Session 1", every "MAG Finals"), artistic and T&T. A session can
carry an optional **override** (empty by default) for any of the four fields; an override wins per
field. The resolved date prints in every sheet's header (the single meet date is only a fallback for a
session with no date); the artistic rotation sheet prints the three times; the T&T rotation sheet title
is weekday + competition (`T&T Session 1 – Purple · Thursday 7:30 AM` (`T&T <name> – <location> · …`)). Stored in `settings/meet.schedule`
(map by schedule key: `"<N>"` for `Session N`, else the session name as typed, matched ignoring case; public-read like the meet name) and `sessions/{id}.scheduleOverride`. Times
saved the older way (Squads screen, T&T competition time) move into the schedule only through the
explicit "Move existing times into the schedule" action.

General: **black and white only** (no colour fills, no solid ink bands), UCG logo + wording (no
NAIGC), full club names. Layout lives in pure `*-pdf-content.ts` modules; jsPDF only draws.
Heavy-bordered boxes = **values entered in ScoreFlippers**, with a key on the page.

Downloads: **this session** (`<name> - <location> - Scorecards.pdf` /
`<name> - <location> - Rotation Sheet.pdf`, e.g. `Session 1 - Green - Scorecards.pdf`, `MAG Finals - Orange - Rotation Sheet.pdf`; characters a file name cannot hold are stripped; zip entries are the same), **all sessions as one PDF** (printing), **all sessions
as separate PDFs** in a zip (web posting). No single-page download. Preview shows every page of
the session, scrollable, with a sticky jump bar.

Collation for all sessions: **scorecards by location** (the meet's location order) then session name (natural order);
**rotation sheets by session name** (natural order; every location's Session 1, then Session 2…) then location order.

### Artistic scorecards (landscape, one page per squad per apparatus)
- Pages per apparatus in Olympic order; within an apparatus, squads **in the order they compete on
  it** (one flight MAG floor: A, F, E, D, C, B; WAG 7 squads vault: A, B, F, G, D, E, C, by
  timeline slot, VT-Platform and VT-Ground pages mixed in that order).
- Header: meet + date, UCG logo, location (`Orange Gym` / `Dupont`), session (`<name> – <location>`); band with squad letter, apparatus, rotation and the
  equipment name when the pattern names it (`VT-A`, `VT-Platform`, `BB-B`).
- Columns: Level, Athlete, Club, **SV**, ND, J1 Score *(incl. ND)*, J2 Score *(incl. ND)*,
  **Final Score**, Scratch?. Heavy = SV, Final Score.
- **Infinity** columns: **SV** *(10 + D-score)*, E-score *(incl. ND)*, ND, **Final Score**, Scratch?
- Names in competing order: each club group's order for that apparatus, groups in squad order.
- **Always exactly 15 rows** (athletes, then blanks).
- Heavy double rule where the level changes (never in Infinity).

### Artistic rotation sheet (portrait, one page per session)
- Title `<meet> – <name> – <location>` (`… – Session 1 – Orange`); subtitle `MAG – Orange Gym – Dev, Int, Adv` (`MAG – Dupont – …` for a venue); schedule;
  session athlete count. (No "Session Rotation Report" line.)
- Per squad: header row `Squad A` (no "(MAG)") + apparatus in rotation order (A-B equipment
  as the pattern says), grey band + heavy frame; rows `Level – Club` (+ `· Group B`; level code first, Julia 2026-10-19) with routine
  counts; **light dashed rule** between levels; clear space between squads.
- Patterns with BYEs (WAG 7 squads): a leading **BYE** column (squads without one start a column
  later), equipment printed by name (`VT-Platform`, `VT-Ground`, `BB-A`, `BB-B`), the pattern's
  **per-squad notes** in a column to the right of each squad (exact wording from the NE sheet), and the
  **8-slot timeline** (squad letter × slot 1–8, cells `(W) VT-P`, `(C) VT-P`, `(W/C) UB`, `BYE`, `-`)
  under the last squad. Black and white; competing cells in bold. Patterns without these print as before.

### T&T scorecards (landscape, 10 rows a page)
- Per event (TR, DM, TU), squads in arrival order (TR: A, C, B); pages `page n of m`.
- Columns: Scratch?, Name/Club, Level, then TR **E1 E2 HD SJ ND** Final; DM/TU **E1 E2 E3 SJ ND**
  Final with **two rows per athlete** (one per pass). Heavy = E-scores, HD, SJ, ND (not Final).
- **5 blank rows** at the end of each squad list, kept together on its last page with ≥1 athlete
  above them.
- Synchro sheet (portrait, 7 pairs a page, by flight): Pair/Club, Level; row 1 **A1-E1 A1-E2
  A1-HD SJ ND**; row 2 **A2-E1 A2-E2 A2-HD Sync** Final. Heavy = all but Final.
- Heavy rule where the level changes.

### T&T rotation sheet (portrait)
- `T&T Session 1 – Purple · Thursday 7:30 AM`; per squad `Squad A: Trampoline > Double Mini >
  Tumbling`, rows Athlete | Club | Squad | TR DM TU SY levels; then Synchro only; then flights.

## 7. Clubs & email (admin)

The **Clubs & email** tab works on the selected meet (§7a).

- **Order deadline:** date + time in Pacific, saved to `meets/{id}/settings/meet.orderDeadline` as a Timestamp (it can be removed: no deadline).
- **Clubs table**, one row per club: full name; per session the levels with athlete counts and the status the club sees (§3); last change (latest save of the club's orders); contact emails (editable inline, saved to `meets/{id}/clubs/{clubId}.emails`); the private link with **Copy** and **Regenerate link**. Filters: by status (or "No email") and a text search (club name or email).
- **Regenerate link** asks first, then: copies the club's saved orders to the new token, publishes the new `clubLinks/{new}`, points the club at the new token, and only then deletes `clubLinks/{old}`. A failure before the last step leaves the old link working and nothing lost.
- **Two reminder lists** (pure, `src/lib/reminders.ts`): **Still A–Z** = clubs with at least one MAG/WAG session still default and no split pending; the email lists only those sessions. **Needs to decide a split** = clubs with a level over one squad's cap they haven't kept or changed; they get only the split email, naming the levels that are too big (and are not on the A–Z list). Clubs with no contact email are listed apart ("No email — add one above") and are never sent to. T&T, "Nothing to order" and "Order set" get no reminder.
- **Templates:** editable subject and body for each reminder, saved to `meets/{id}/emailSettings/main`, with `{club}`, `{sessions}`, `{levels}`, `{deadline}`, `{link}`, `{meet}`. Defaults are the prototype's wording (plain, friendly, A–Z is fine if they do nothing, keep the link private). Body markup: blank line = paragraph, `- ` bullets, `**bold**`, bare links. Per-club preview shows From, To (test alias plus the real address struck through) and Subject, the HTML body and the plain-text alternative. Sent messages are multipart/alternative.
- **Test mode is the default and the only mode until Julia approves real sends:** every recipient is rewritten to `jzsharpe+<club id>@gmail.com` (or `nssharpe+…`, the admin's choice). There is **no code path that sends to a club's real address** in this version; the "Send to real club addresses" control is disabled ("Needs Julia's go-ahead for each send"). Real sending is a separate switch that ships via PR + review, and each real send needs Julia's go-ahead.
- **Sending:** "Connect Gmail" (`connectGmail()`), then the selected list goes out one message at a time (about 400 ms apart) from the admin's Gmail as `info@unitedclubgymnastics.org`, with a progress bar and a result per club; an expired connection (401) stops the run. Each success is logged to `meets/{id}/emailLog` (template, club, test alias, subject, time, admin email, `mode: 'test'`); a log table is shown, and **Skip clubs already sent this reminder today** (Pacific day) is on by default. Never uses the platform's Resend account.

## 7a. Meets (several meets, one app)

Julia runs this for more than one meet (Nationals, NE Regionals, …) without losing one meet's imports
and work when she switches to another.

- **Everything meet-specific lives under `meets/{meetId}/…`**: settings, athletes, clubs (with tokens),
  sessions, squads, synchro choices, email log and templates. Switching meets never touches another
  meet's data, and nothing is shared between meets.
- **Admin header:** a meet dropdown (newest first; the current meet is remembered per browser in
  `localStorage`, with a safe fallback to the newest), **New meet** (name → `meets/{slug}-{4 random
  chars}` plus default settings), **Rename**, **Archive** (hides it from the list, never deletes).
  With no meets the admin sees "Create your first meet". Import, Squads, T&T, Exports (and Clubs &
  email later) all work on the selected meet. Archived meets can only be un-hidden in the Firebase
  console (`archived: false` on `meets/{id}`); there is no UI for it yet.
- **Club links stay top-level** (`clubLinks/{token}`, `clubOrders/{token}/levels/{levelKey}`): the club
  page has only a token. Each link document carries its `meetId`. Tokens are per club **per meet**, so a
  club gets a different link for each meet. The club page reads the meet's public settings (name,
  order deadline) from `meets/{link.meetId}/settings/meet`, and works from the link alone as before.
  A link without a `meetId` (made before meets existed) shows "This link isn't valid".
- **Rules:** everything under `meets/**` is admin-only except `meets/{meetId}/settings/meet`, which is
  public read (name, dates, deadline are public facts) and admin write. The `clubOrders` write check
  reads the deadline from the meet named in the club's link: a club in meet X is locked by X's
  deadline, never Y's. A link with no `meetId`, or whose meet has no settings, cannot write.
- **Old data:** the top-level test import from 2026 (`athletes`, `clubs`, `sessions`, `squads`,
  `settings`, …) is **not migrated** and is no longer readable by the app or the public. Julia creates a
  meet and re-imports once. Nothing deletes the old documents; they can be removed in the console.

## 8. Data model (Firestore)

Firestore has no nested arrays, so `string[][]` is stored as `{ ids: string[] }[]`.

| Path | Who | Contents |
|---|---|---|
| `meets/{meetId}` | admin | `{ name, createdAt, archived? }` |
| `meets/{meetId}/settings/meet` | admin write, **public read** | meet name/date (fallback), order deadline, gym order, capacity settings, `schedule` (date and times by schedule key: session number or name) |
| `meets/{meetId}/sessions/{id}` | admin | name, location, gym (= location), number (only `Session N`), discipline, levels, `scheduleOverride` (optional date/times) |
| `meets/{meetId}/athletes/{id}` | admin | names, club id + full name, level, session, apparatus / T&T levels, removed flag (id `<DISC>_<club>_<first-last>`; see notes) |
| `meets/{meetId}/clubs/{clubId}` | admin | full name, contact emails, token |
| `meets/{meetId}/squads/{sessionId}` | admin | artistic plan (squad → card keys) or T&T squads + per-event orders + synchro flights |
| `meets/{meetId}/synchroSessions/main` | admin | `{ assignments: { <pairId>: <sessionId> } }`: the host's session choice per synchro pair |
| `meets/{meetId}/nameFixes/main` | admin (catch-all; not in the public settings) | `{ fixes: [{ field: 'first'\|'last', from, to }], updatedAt }`: display-only name fixes (spec §2) |
| `meets/{meetId}/emailLog/{id}` | admin | one row per message sent: `{ template: 'az'\|'split', clubId, club, to (the test alias), subject, at, by (admin email), mode: 'test' }` |
| `meets/{meetId}/emailSettings/main` | admin | `{ templates: { az: { subject, body }, split: { subject, body } } }` |
| `clubLinks/{token}` | public **get** only (no list) | **meetId**, clubId, club name, the club's roster per session (names, levels, apparatus — no emails/DOB) |
| `clubOrders/{token}/levels/{sessionId_level}` | club with token (until its meet's deadline), admin | groups, per-apparatus sections, splitDecided, updatedAt |
| `admins/{email}` | console only | extra admins |

Token = 128-bit random (base64url). Knowing it is the only club credential.

## 9. Reuse

Copied (not linked) from ucg-platform, each with a provenance header, listed in
`docs/provenance.md`: `src/lib/competition-order.ts`, `src/components/CompetitionOrderCard.tsx`,
`src/lib/squad-builder.ts`, `src/components/ClubGroupSquadBuilder.tsx`, the T&T builder pieces,
`APPARATUS` from `src/lib/types.ts`, brand tokens from `src/index.css`, `Field`/`Modal`/`Badge`/
`Tabs` from `src/components/ui.tsx`, and their tests. Licensed brand fonts are loaded from the
platform's public `brand` bucket, never committed.

## 10. Out of scope (v1)

Scoring, results, check-in, any export back into ScoreFlippers (none exists). Data is reset per meet.
