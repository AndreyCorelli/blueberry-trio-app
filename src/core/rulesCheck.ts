import { N } from "./blueberryCore";
import type { Puzzle } from "./blueberryCore";

export type PlayerCellState = -1 | 0 | 1; // -1 empty, 0 unknown, 1 berry

export type Violations = {
  row: boolean[];
  col: boolean[];
  block: boolean[];
  clueArea: boolean[][];
};

// Neighbor offsets (8 surrounding cells)
const NEIGHBOR_DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
] as const;

function countLine(values: readonly PlayerCellState[]): { berries: number; unknown: number } {
  let berries = 0;
  let unknown = 0;
  for (const v of values) {
    if (v === 1) berries++;
    else if (v === 0) unknown++;
    // v === -1 is "empty marked", doesn't contribute
  }
  return { berries, unknown };
}

function violatesUnit(berries: number, unknown: number, required: number): boolean {
  // too many berries already
  if (berries > required) return true;

  // even if we fill all unknowns with berries, we still can't reach required
  if (berries + unknown < required) return true;

  // fully decided but wrong
  if (unknown === 0 && berries !== required) return true;

  return false;
}

export function computeViolations(board: PlayerCellState[][], puzzle: Puzzle): Violations {
  const row = new Array<boolean>(N).fill(false);
  const col = new Array<boolean>(N).fill(false);
  const block = new Array<boolean>(N).fill(false);
  const clueArea: boolean[][] = Array.from({ length: N }, () => new Array<boolean>(N).fill(false));

  // --- Row violations (3 berries per row) ---
  for (let r = 0; r < N; r++) {
    const line = board[r] ?? [];
    const vals: PlayerCellState[] = Array.from({ length: N }, (_, c) => (line[c] ?? 0) as PlayerCellState);
    const { berries, unknown } = countLine(vals);
    row[r] = violatesUnit(berries, unknown, 3);
  }

  // --- Column violations (3 berries per column) ---
  for (let c = 0; c < N; c++) {
    const vals: PlayerCellState[] = Array.from({ length: N }, (_, r) => (board[r]?.[c] ?? 0) as PlayerCellState);
    const { berries, unknown } = countLine(vals);
    col[c] = violatesUnit(berries, unknown, 3);
  }

  // --- 3x3 block violations (3 berries per block) ---
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      let berries = 0;
      let unknown = 0;
      for (let r = br * 3; r < br * 3 + 3; r++) {
        for (let c = bc * 3; c < bc * 3 + 3; c++) {
          const v = (board[r]?.[c] ?? 0) as PlayerCellState;
          if (v === 1) berries++;
          else if (v === 0) unknown++;
        }
      }
      const blockIndex = br * 3 + bc;
      block[blockIndex] = violatesUnit(berries, unknown, 3);
    }
  }

  // --- Clue-area violations (Minesweeper-style feasibility) ---
  // Mark violation on the clue cell itself (same as you were highlighting).
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const clue = puzzle.puzzleClues[r][c];
      if (clue === null) continue;

      let berries = 0;
      let unknown = 0;

      for (const [dr, dc] of NEIGHBOR_DIRS) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;

        const v = (board[rr]?.[cc] ?? 0) as PlayerCellState;
        if (v === 1) berries++;
        else if (v === 0) unknown++;
      }

      // Violation if impossible or exceeded
      const violated = berries > clue || (berries + unknown < clue);
      clueArea[r][c] = violated;
    }
  }

  return { row, col, block, clueArea };
}
