// Seeded deterministic RNG: cyrb128 string hash -> mulberry32.
// No dependencies; Math.imul is mandatory for correct 32-bit multiply
// semantics (canonical bryc implementations).

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Random element of a non-empty array. */
  pick<T>(arr: readonly T[]): T;
  /** Fisher-Yates shuffle returning a new array (input untouched). */
  shuffle<T>(arr: readonly T[]): T[];
  /** Current 32-bit state — snapshot for serialization/debugging. */
  getState(): number;
}

/** cyrb128: string -> 4×32-bit seed parts (h1 best for mulberry32). */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

export function createRng(seed: string): Rng {
  const [initial] = cyrb128(seed);
  let state = initial;
  // Warmup: discard 15 draws to decorrelate low-entropy string seeds.
  for (let i = 0; i < 15; i++) {
    state = (state + 0x6d2b79f5) >>> 0;
  }

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
    pick: <T>(arr: readonly T[]): T => {
      if (arr.length === 0) throw new Error('Rng.pick: empty array');
      return arr[Math.floor(next() * arr.length)] as T;
    },
    shuffle: <T>(arr: readonly T[]): T[] => {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i] as T;
        out[i] = out[j] as T;
        out[j] = tmp;
      }
      return out;
    },
    getState: () => state >>> 0,
  };
}
