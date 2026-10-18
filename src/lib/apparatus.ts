// Copied from ucg-platform@32fb372 src/lib/types.ts — keep in sync by hand
// Changed: only Discipline and APPARATUS extracted (rest of types.ts is platform-specific).
export type Discipline = 'MAG' | 'WAG' | 'TNT';


export const APPARATUS: Record<Discipline, { code: string; name: string }[]> = {
  MAG: [
    { code: 'FX', name: 'Floor' },
    { code: 'PH', name: 'Pommel Horse' },
    { code: 'SR', name: 'Still Rings' },
    { code: 'VT', name: 'Vault' },
    { code: 'PB', name: 'Parallel Bars' },
    { code: 'HB', name: 'High Bar' },
  ],
  WAG: [
    { code: 'VT', name: 'Vault' },
    { code: 'UB', name: 'Uneven Bars' },
    { code: 'BB', name: 'Balance Beam' },
    { code: 'FX', name: 'Floor' },
  ],
  TNT: [
    { code: 'TR', name: 'Trampoline' },
    { code: 'DM', name: 'Double Mini' },
    { code: 'TU', name: 'Tumbling' },
    { code: 'SY', name: 'Synchro Trampoline' },
  ],
};

