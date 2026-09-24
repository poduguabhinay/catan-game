// Balanced dice: 36-card deck (colonist.io published algorithm) reshuffled
// at 12 remaining, with 30% immediate-repeat damping.

import type { Rng } from '@catan/shared';

interface Deck {
  cards: Array<[number, number]>;
  index: number;
}

function fullDeck(): Array<[number, number]> {
  const cards: Array<[number, number]> = [];
  for (let die1 = 1; die1 <= 6; die1++) {
    for (let die2 = 1; die2 <= 6; die2++) cards.push([die1, die2]);
  }
  return cards;
}

/**
 * Roll-dice source implementing the balanced-deck algorithm.
 * Returns a RollDiceFn-compatible source given shared rng draws.
 */
export function createBalancedDiceSource(): {
  roll(rng: Rng, previous: [number, number] | null): { die1: number; die2: number };
} {
  let deck: Deck = { cards: [], index: 0 };

  const draw = (rng: Rng): [number, number] => {
    if (deck.index >= deck.cards.length) {
      deck = { cards: rng.shuffle(fullDeck()), index: 0 };
    }
    const card = deck.cards[deck.index]!;
    deck.index += 1;
    return card;
  };

  return {
    // Repeat damping: after drawing, if the roll equals the previous roll and
    // rng < 0.3, draw the next card instead and return the drawn card to a
    // random position (colonist.io published behavior).
    roll(rng: Rng, prev: [number, number] | null): { die1: number; die2: number } {
      let card = draw(rng);
      if (prev !== null && card[0] + card[1] === prev[0] + prev[1] && rng.next() < 0.3) {
        // Draw the next card; return the first back into a random position.
        const replacement = draw(rng);
        const insertAt = rng.int(deck.cards.length + 1);
        deck.cards.splice(insertAt, 0, card);
        card = replacement;
      }
      return { die1: card[0], die2: card[1] };
    },
  };
}
