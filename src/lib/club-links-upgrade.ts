// Pure: "Upgrade club links" (spec §7c). Before 2026-10-19 a club had one link PER MEET (`clubLinks/{token}` with a `meetId`, orders at
// `clubOrders/{token}/levels/*`). Now a club has one link for all meets. This plans the one-time move; the store applies it.
//   1. pick one token per club: the one already in `clubTokens`, else the token of the club's newest meet;
//   2. copy every old per-meet order to `clubOrders/{token}/meets/{meetId}/levels/{levelKey}` (never over one already there);
//   3. write the combined link documents;
//   4. delete the other old per-meet link documents (old links stop working). Nothing else is deleted.
import type { ClubLinkDoc, MeetLinkEntry, OldClubLinkDoc } from './club-links';

export interface UpgradeMeet { id: string; name: string; createdAt: number; archived: boolean }
export interface OldLink { token: string; data: OldClubLinkDoc }

export interface UpgradeInput {
  oldLinks: OldLink[];
  /** Link documents already in the new shape, by token (a re-run after a part-way failure finds some). */
  newLinks: Record<string, ClubLinkDoc>;
  meets: UpgradeMeet[];
  /** clubId -> token, from `clubTokens`. */
  clubTokens: Record<string, string>;
  /** old token -> level keys that have a saved order at `clubOrders/{oldToken}/levels`. */
  oldOrders: Record<string, string[]>;
  /** `<token>|<meetId>` -> level keys that already exist at `clubOrders/{token}/meets/{meetId}/levels`. */
  existingOrders: Record<string, string[]>;
}

export interface OrderCopy { fromToken: string; toToken: string; meetId: string; levelKey: string }

export interface UpgradePlan {
  /** `clubTokens/{clubId}` documents to create (clubs that have none yet). */
  newTokens: { clubId: string; token: string }[];
  orderCopies: OrderCopy[];
  /** The combined link document per club, written whole. */
  links: { token: string; doc: ClubLinkDoc }[];
  /** Old per-meet link documents to delete (not the ones reused as the combined link). */
  deleteLinks: string[];
  /** Old links left alone (their meet is unknown): { token, meetId }. */
  skipped: { token: string; meetId: string }[];
  counts: { clubs: number; oldLinks: number; meets: number; ordersToCopy: number; ordersAlreadyThere: number; tokensReused: number; tokensNew: number; linksToDelete: number };
}

/** One token per club: `clubTokens` wins; else the token of the club's newest meet (ties: larger meet id). */
export function pickClubTokens(oldLinks: OldLink[], meets: UpgradeMeet[], clubTokens: Record<string, string>): Record<string, string> {
  const created = new Map(meets.map((m) => [m.id, m.createdAt]));
  const known = oldLinks.filter((l) => created.has(l.data.meetId));
  const out: Record<string, string> = {};
  const best = new Map<string, OldLink>();
  for (const l of known) {
    const cur = best.get(l.data.clubId);
    const a = created.get(l.data.meetId)!;
    const b = cur ? created.get(cur.data.meetId)! : -Infinity;
    if (!cur || a > b || (a === b && l.data.meetId > cur.data.meetId)) best.set(l.data.clubId, l);
  }
  for (const [clubId, l] of best) out[clubId] = clubTokens[clubId] || l.token;
  return out;
}

export function planUpgrade(input: UpgradeInput): UpgradePlan {
  const meetById = new Map(input.meets.map((m) => [m.id, m]));
  const usable = input.oldLinks.filter((l) => meetById.has(l.data.meetId));
  const skipped = input.oldLinks.filter((l) => !meetById.has(l.data.meetId)).map((l) => ({ token: l.token, meetId: l.data.meetId }));
  const chosen = pickClubTokens(usable, input.meets, input.clubTokens);

  const plan: UpgradePlan = {
    newTokens: [], orderCopies: [], links: [], deleteLinks: [], skipped,
    counts: { clubs: 0, oldLinks: usable.length, meets: 0, ordersToCopy: 0, ordersAlreadyThere: 0, tokensReused: 0, tokensNew: 0, linksToDelete: 0 },
  };
  const meetsSeen = new Set<string>();
  const byClub = new Map<string, OldLink[]>();
  for (const l of usable) byClub.set(l.data.clubId, [...(byClub.get(l.data.clubId) ?? []), l]);

  for (const [clubId, links] of [...byClub].sort(([a], [b]) => a.localeCompare(b))) {
    const token = chosen[clubId];
    plan.counts.clubs++;
    if (input.clubTokens[clubId]) plan.counts.tokensReused++;
    else { plan.newTokens.push({ clubId, token }); plan.counts.tokensNew++; }

    const existing = input.newLinks[token];
    const meets: Record<string, MeetLinkEntry> = { ...(existing?.meets ?? {}) };
    for (const l of [...links].sort((a, b) => a.data.meetId.localeCompare(b.data.meetId))) {
      const meet = meetById.get(l.data.meetId)!;
      meetsSeen.add(meet.id);
      // An archived meet is not listed to clubs (archiving removes it from the link), but its orders still move.
      if (!meet.archived && !meets[meet.id]) meets[meet.id] = { meetName: meet.name, createdAt: meet.createdAt, sessions: l.data.sessions, levelKeys: l.data.levelKeys };
      const there = new Set(input.existingOrders[`${token}|${meet.id}`] ?? []);
      for (const levelKey of [...(input.oldOrders[l.token] ?? [])].sort()) {
        if (there.has(levelKey)) plan.counts.ordersAlreadyThere++;
        else { plan.orderCopies.push({ fromToken: l.token, toToken: token, meetId: meet.id, levelKey }); plan.counts.ordersToCopy++; }
      }
      if (l.token !== token) { plan.deleteLinks.push(l.token); plan.counts.linksToDelete++; }
    }
    plan.links.push({ token, doc: { clubId, clubName: links[0].data.clubName, meets } });
  }
  plan.counts.meets = meetsSeen.size;
  return plan;
}
