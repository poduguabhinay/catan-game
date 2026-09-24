import { describe, expect, it } from 'vitest';
import {
  BOARD_CONFIGS,
  boardConfigForPlayers,
  type Resource,
  type Terrain,
} from '../constants';
import { generateBoard, type PlayerCount } from '../board';
import { edgeOf, parseHexId, type HexId } from '../topology';

function terrainCounts(hexes: Record<HexId, { terrain: Terrain }>): Record<Terrain, number> {
  const counts = {
    forest: 0, hills: 0, pasture: 0, fields: 0, mountains: 0, desert: 0,
  } as Record<Terrain, number>;
  for (const h of Object.values(hexes)) counts[h.terrain]++;
  return counts;
}

function tokenMultiset(hexes: Record<HexId, { token: number | null }>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const h of Object.values(hexes)) {
    if (h.token === null) continue;
    out[h.token] = (out[h.token] ?? 0) + 1;
  }
  return out;
}

function configTerrainCounts(config: typeof BOARD_CONFIGS.base): Record<Terrain, number> {
  const counts = {
    forest: 0, hills: 0, pasture: 0, fields: 0, mountains: 0, desert: 0,
  } as Record<Terrain, number>;
  for (const t of config.terrains) counts[t]++;
  return counts;
}

function configTokenMultiset(config: typeof BOARD_CONFIGS.base): Record<number, number> {
  const out: Record<number, number> = {};
  for (const t of config.tokens) out[t] = (out[t] ?? 0) + 1;
  return out;
}

const SEEDS = Array.from({ length: 20 }, (_, i) => `seed-${i}`);

describe.each([3, 4] as PlayerCount[])('base board (players=%i)', (pc) => {
  it('has 19 hexes with correct terrain counts', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(pc, seed);
      const cfg = BOARD_CONFIGS.base;
      expect(Object.keys(b.hexes).length).toBe(19);
      expect(terrainCounts(b.hexes)).toEqual(configTerrainCounts(cfg));
      expect(b.config).toBe('base');
    }
  });

  it('token multiset matches config; desert has null token', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(pc, seed);
      expect(tokenMultiset(b.hexes)).toEqual(configTokenMultiset(BOARD_CONFIGS.base));
      for (const h of Object.values(b.hexes)) {
        if (h.terrain === 'desert') expect(h.token).toBeNull();
        else expect(h.token).not.toBeNull();
      }
    }
  });

  it('never has adjacent 6/8', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(pc, seed);
      for (const h of b.topology.hexes) {
        const t = b.hexes[h]!.token;
        if (t !== 6 && t !== 8) continue;
        for (const n of b.topology.hexNeighbors[h]!) {
          const nt = b.hexes[n]!.token;
          expect(nt === 6 || nt === 8).toBe(false);
        }
      }
    }
  });

  it('harbors: 9 total, 5 specialty (one per resource) + 4 generic', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(pc, seed);
      const all = Object.values(b.harbors);
      expect(all.length).toBe(9);
      const specialty = all.filter((h) => h.type === 'specialty');
      const generic = all.filter((h) => h.type === 'generic');
      expect(specialty.length).toBe(5);
      expect(generic.length).toBe(4);
      const specResources = specialty
        .map((h) => h.resource)
        .filter(Boolean)
        .sort() as Resource[];
      expect(specResources).toEqual(['brick', 'ore', 'sheep', 'wheat', 'wood']);
    }
  });

  it('robber starts on a desert hex', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(pc, seed);
      expect(b.hexes[b.robberHex]!.terrain).toBe('desert');
    }
  });

  it('is deterministic per seed and differs across seeds', () => {
    const a1 = generateBoard(pc, 'same');
    const a2 = generateBoard(pc, 'same');
    expect(a1.hexes).toEqual(a2.hexes);
    expect(a1.harbors).toEqual(a2.harbors);
    const b1 = generateBoard(pc, 'other');
    expect(a1.hexes).not.toEqual(b1.hexes);
  });
});

describe.each([5, 6] as PlayerCount[])('ext56 board (players=%i)', (pc) => {
  it('has 30 hexes with correct terrain counts and 28 tokens', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(pc, seed);
      const cfg = BOARD_CONFIGS.ext56;
      expect(Object.keys(b.hexes).length).toBe(30);
      expect(terrainCounts(b.hexes)).toEqual(configTerrainCounts(cfg));
      expect(tokenMultiset(b.hexes)).toEqual(configTokenMultiset(cfg));
      expect(b.config).toBe('ext56');
    }
  });

  it('never has adjacent 6/8', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(pc, seed);
      for (const h of b.topology.hexes) {
        const t = b.hexes[h]!.token;
        if (t !== 6 && t !== 8) continue;
        for (const n of b.topology.hexNeighbors[h]!) {
          const nt = b.hexes[n]!.token;
          expect(nt === 6 || nt === 8).toBe(false);
        }
      }
    }
  });

  it('harbors: 11 total, 6 specialty (two sheep) + 5 generic', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(pc, seed);
      const all = Object.values(b.harbors);
      expect(all.length).toBe(11);
      const specialty = all.filter((h) => h.type === 'specialty');
      const generic = all.filter((h) => h.type === 'generic');
      expect(specialty.length).toBe(6);
      expect(generic.length).toBe(5);
      const sheep = specialty.filter((h) => h.resource === 'sheep');
      expect(sheep.length).toBe(2);
    }
  });

  it('both deserts have no token; robber on a desert', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(pc, seed);
      const deserts = Object.values(b.hexes).filter((h) => h.terrain === 'desert');
      expect(deserts.length).toBe(2);
      for (const d of deserts) expect(d.token).toBeNull();
      expect(b.hexes[b.robberHex]!.terrain).toBe('desert');
    }
  });
});

describe.each([7, 8] as PlayerCount[])('ext78 board (players=%i)', (pc) => {
  it('has 37 hexes on a radius-3 hexagon with correct terrain and 35 tokens', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(pc, seed);
      const cfg = BOARD_CONFIGS.ext78;
      expect(b.config).toBe('ext78');
      expect(Object.keys(b.hexes).length).toBe(37);
      for (const h of b.topology.hexes) {
        const { q, r } = parseHexId(h);
        expect(Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r))).toBeLessThanOrEqual(3);
      }
      expect(terrainCounts(b.hexes)).toEqual({
        forest: 7, hills: 7, pasture: 7, fields: 7, mountains: 7, desert: 2,
      });
      expect(tokenMultiset(b.hexes)).toEqual(configTokenMultiset(cfg));
      expect(tokenMultiset(b.hexes)).toEqual({
        2: 2, 3: 4, 4: 4, 5: 4, 6: 4, 8: 4, 9: 4, 10: 4, 11: 4, 12: 1,
      });
    }
  });

  it('config tokens cover exactly the non-desert hexes', () => {
    const cfg = BOARD_CONFIGS.ext78;
    expect(cfg.tokens.length).toBe(cfg.terrains.filter((t) => t !== 'desert').length);
  });

  it('never has adjacent 6/8', () => {
    for (let i = 0; i < 300; i++) {
      const b = generateBoard(pc, `ext78-${i}`);
      for (const h of b.topology.hexes) {
        const t = b.hexes[h]!.token;
        if (t !== 6 && t !== 8) continue;
        for (const n of b.topology.hexNeighbors[h]!) {
          const nt = b.hexes[n]!.token;
          if (nt === 6 || nt === 8) throw new Error(`adjacent 6/8 for seed ext78-${i}`);
        }
      }
    }
  }, 60000);

  it('harbors: 13 on distinct border edges, 7 specialty (two sheep, two wood) + 6 generic', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(pc, seed);
      const all = Object.values(b.harbors);
      expect(all.length).toBe(13);
      const border = new Set(b.topology.borderEdges.map(edgeOf));
      for (const eid of Object.keys(b.harbors)) expect(border.has(eid)).toBe(true);
      const specialty = all.filter((h) => h.type === 'specialty');
      expect(specialty.length).toBe(7);
      expect(all.filter((h) => h.type === 'generic').length).toBe(6);
      expect(specialty.map((h) => h.resource).sort()).toEqual([
        'brick', 'ore', 'sheep', 'sheep', 'wheat', 'wood', 'wood',
      ]);
    }
  });

  it('both deserts have no token; robber on a desert', () => {
    for (const seed of SEEDS) {
      const b = generateBoard(pc, seed);
      const deserts = Object.values(b.hexes).filter((h) => h.terrain === 'desert');
      expect(deserts.length).toBe(2);
      for (const d of deserts) expect(d.token).toBeNull();
      expect(b.hexes[b.robberHex]!.terrain).toBe('desert');
    }
  });
});

describe('boardConfigForPlayers', () => {
  it('maps 3-4 to base, 5-6 to ext56, 7-8 to ext78', () => {
    expect([3, 4, 5, 6, 7, 8].map((n) => boardConfigForPlayers(n).key)).toEqual([
      'base', 'base', 'ext56', 'ext56', 'ext78', 'ext78',
    ]);
  });
});

describe('6/8 adjacency retry loop', () => {
  it('converges within 500 attempts over 1000 seeds', () => {
    // Instead of exposing attempts, verify all 1000 seeds produce valid boards.
    let valid = 0;
    for (let i = 0; i < 1000; i++) {
      const b = generateBoard(([4, 5, 7] as const)[i % 3]!, `stress-${i}`);
      for (const h of b.topology.hexes) {
        const t = b.hexes[h]!.token;
        if (t !== 6 && t !== 8) continue;
        for (const n of b.topology.hexNeighbors[h]!) {
          const nt = b.hexes[n]!.token;
          if (nt === 6 || nt === 8) throw new Error(`adjacent 6/8 for seed stress-${i}`);
        }
      }
      valid++;
    }
    expect(valid).toBe(1000);
  }, 60000);
});
