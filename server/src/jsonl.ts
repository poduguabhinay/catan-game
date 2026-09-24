// JSONL event log: one append-only file per room under data/games/<code>.jsonl.

import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameEvent } from '@catan/shared';

export interface JsonlLine {
  seq: number;
  ts: number;
  roomCode: string;
  type: string;
  actorSeat?: number;
  payload: unknown;
}

export class GameLog {
  private streams = new Map<string, WriteStream>();
  private seqs = new Map<string, number>();
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private streamFor(roomCode: string) {
    let s = this.streams.get(roomCode);
    if (s === undefined) {
      s = createWriteStream(join(this.dir, `${roomCode}.jsonl`), { flags: 'a' });
      this.streams.set(roomCode, s);
    }
    return s;
  }

  append(roomCode: string, event: GameEvent): void {
    const seq = (this.seqs.get(roomCode) ?? 0) + 1;
    this.seqs.set(roomCode, seq);
    const line: JsonlLine = {
      seq,
      ts: Date.now(),
      roomCode,
      type: event.type,
      actorSeat: 'seat' in event ? (event as { seat: number }).seat : undefined,
      payload: event,
    };
    const stream = this.streamFor(roomCode);
    stream.write(JSON.stringify(line) + '\n');
  }

  close(roomCode: string): void {
    const s = this.streams.get(roomCode);
    if (s !== undefined) {
      s.end();
      this.streams.delete(roomCode);
    }
  }
}
