// Core domain types for the Catan engine. Server-authoritative; shared with
// the client for legal-move highlighting and rendering.

export type Resource = 'wood' | 'brick' | 'sheep' | 'wheat' | 'ore';
export const RESOURCES: readonly Resource[] = ['wood', 'brick', 'sheep', 'wheat', 'ore'] as const;

export type Terrain =
  | 'forest' // produces wood
  | 'hills' // produces brick
  | 'pasture' // produces sheep
  | 'fields' // produces wheat
  | 'mountains' // produces ore
  | 'desert'; // produces nothing

export type DevCardType = 'knight' | 'victoryPoint' | 'roadBuilding' | 'monopoly' | 'yearOfPlenty';

export type PlayerColor =
  | 'red'
  | 'blue'
  | 'orange'
  | 'white'
  | 'green'
  | 'brown'
  | 'purple'
  | 'pink';
export const PLAYER_COLORS: readonly PlayerColor[] = [
  'red',
  'blue',
  'orange',
  'white',
  'green',
  'brown',
  'purple',
  'pink',
] as const;

/** Pips printed on number tokens = ways to roll that number out of 36. */
export const PIPS: Readonly<Record<number, number>> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
} as const;

export type ResourceBag = Record<Resource, number>;

export function emptyResourceBag(): ResourceBag {
  return { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
}

/** Immutable add: returns a new bag with `amount` added to `res`. */
export function addResource(bag: ResourceBag, res: Resource, amount: number): ResourceBag {
  return { ...bag, [res]: bag[res] + amount };
}

/** True if bag has at least `cost` of every resource. */
export function canAfford(bag: ResourceBag, cost: Partial<ResourceBag>): boolean {
  return (Object.keys(cost) as Resource[]).every((k) => bag[k] >= (cost[k] ?? 0));
}

/** Immutable subtract (caller must have checked canAfford). */
export function subtractCost(bag: ResourceBag, cost: Partial<ResourceBag>): ResourceBag {
  const next = { ...bag };
  for (const k of Object.keys(cost) as Resource[]) next[k] -= cost[k] ?? 0;
  return next;
}

export function bagTotal(bag: ResourceBag): number {
  return RESOURCES.reduce((sum, r) => sum + bag[r], 0);
}

export const BUILD_COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
  city: { wheat: 2, ore: 3 },
  devCard: { sheep: 1, wheat: 1, ore: 1 },
} as const satisfies Record<string, Partial<ResourceBag>>;

export const PIECE_LIMITS = { roads: 15, settlements: 5, cities: 4 } as const;

export interface GameRules {
  /** Victory points needed to win (checked on the acting player's own turn). */
  victoryPointsToWin: number;
  /** On a 7, players holding MORE than this many cards discard half. */
  discardLimit: number;
}

export const DEFAULT_RULES: Readonly<GameRules> = { victoryPointsToWin: 10, discardLimit: 7 };

export type BoardConfigKey = 'base' | 'ext56' | 'ext78';

export interface BoardConfig {
  key: BoardConfigKey;
  minPlayers: number;
  maxPlayers: number;
  /** Terrain multiset laid on the board. */
  terrains: readonly Terrain[];
  /** Number tokens for all non-desert hexes (includes duplicates). */
  tokens: readonly number[];
  /** Harbor types: specialty 2:1 per listed resource + N generic 3:1. */
  specialtyHarbors: readonly Resource[]; // one entry per specialty harbor (extensions repeat resources)
  genericHarbors: number;
  resourceBank: number; // per resource
  devDeck: Readonly<Record<DevCardType, number>>;
}

export const BOARD_CONFIGS: Record<BoardConfigKey, BoardConfig> = {
  base: {
    key: 'base',
    minPlayers: 3,
    maxPlayers: 4,
    terrains: [
      'forest', 'forest', 'forest', 'forest',
      'hills', 'hills', 'hills',
      'pasture', 'pasture', 'pasture', 'pasture',
      'fields', 'fields', 'fields', 'fields',
      'mountains', 'mountains', 'mountains',
      'desert',
    ],
    tokens: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    specialtyHarbors: ['wood', 'brick', 'sheep', 'wheat', 'ore'],
    genericHarbors: 4,
    resourceBank: 19,
    devDeck: { knight: 14, victoryPoint: 5, roadBuilding: 2, monopoly: 2, yearOfPlenty: 2 },
  },
  ext56: {
    key: 'ext56',
    minPlayers: 5,
    maxPlayers: 6,
    terrains: [
      'forest', 'forest', 'forest', 'forest', 'forest', 'forest',
      'hills', 'hills', 'hills', 'hills', 'hills',
      'pasture', 'pasture', 'pasture', 'pasture', 'pasture', 'pasture',
      'fields', 'fields', 'fields', 'fields', 'fields', 'fields',
      'mountains', 'mountains', 'mountains', 'mountains', 'mountains',
      'desert', 'desert',
    ],
    tokens: [
      2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6,
      8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12,
    ],
    specialtyHarbors: ['wood', 'brick', 'sheep', 'wheat', 'ore', 'sheep'],
    genericHarbors: 5,
    resourceBank: 24,
    devDeck: { knight: 20, victoryPoint: 5, roadBuilding: 3, monopoly: 3, yearOfPlenty: 3 },
  },
  ext78: {
    key: 'ext78',
    minPlayers: 7,
    maxPlayers: 8,
    terrains: [
      'forest', 'forest', 'forest', 'forest', 'forest', 'forest', 'forest',
      'hills', 'hills', 'hills', 'hills', 'hills', 'hills', 'hills',
      'pasture', 'pasture', 'pasture', 'pasture', 'pasture', 'pasture', 'pasture',
      'fields', 'fields', 'fields', 'fields', 'fields', 'fields', 'fields',
      'mountains', 'mountains', 'mountains', 'mountains', 'mountains', 'mountains', 'mountains',
      'desert', 'desert',
    ],
    tokens: [
      2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6,
      8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12,
    ],
    specialtyHarbors: ['wood', 'brick', 'sheep', 'wheat', 'ore', 'sheep', 'wood'],
    genericHarbors: 6,
    resourceBank: 29,
    devDeck: { knight: 26, victoryPoint: 6, roadBuilding: 4, monopoly: 4, yearOfPlenty: 4 },
  },
} as const;

/** Board config by seat count: 3-4 base, 5-6 ext56, 7-8 ext78. */
export function boardConfigForPlayers(playerCount: number): BoardConfig {
  if (playerCount >= 7) return BOARD_CONFIGS.ext78;
  if (playerCount >= 5) return BOARD_CONFIGS.ext56;
  return BOARD_CONFIGS.base;
}

/** Terrain -> produced resource (desert maps to null). */
export const TERRAIN_RESOURCE: Record<Terrain, Resource | null> = {
  forest: 'wood',
  hills: 'brick',
  pasture: 'sheep',
  fields: 'wheat',
  mountains: 'ore',
  desert: null,
};
