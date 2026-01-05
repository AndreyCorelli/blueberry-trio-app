export const N = 9;

// 0 = empty, 1 = berry
export type Board = number[][];
export type ClueGrid = (number | null)[][];

export interface Puzzle {
  solution: Board;
  puzzleClues: ClueGrid;
}

type CellClue = { r: number; c: number; v: number };

// Neighbor offsets (8 surrounding cells)
const NEIGHBOR_DIRS: Array<[number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function clone2D(arr: number[][]): number[][] {
  return arr.map((row) => row.slice());
}

// ---------- Row patterns: all rows with exactly 3 berries ----------

const ROW_PATTERNS: number[][] = (() => {
  const patterns: number[][] = [];
  const indices = Array.from({ length: N }, (_, i) => i);

  function backtrack(start: number, depth: number, current: number[]): void {
    if (depth === 3) {
      const row = new Array<number>(N).fill(0);
      for (const p of current) row[p] = 1;
      patterns.push(row);
      return;
    }
    for (let i = start; i < indices.length; i++) {
      current.push(indices[i]);
      backtrack(i + 1, depth + 1, current);
      current.pop();
    }
  }

  backtrack(0, 0, []);
  return patterns;
})();

// ---------- Step 1: generate a full valid board ----------

export function generateBoard(): Board {
  const colCounts = new Array<number>(N).fill(0);
  const blockCounts = new Array<number>(N).fill(0);
  const boardRows: Board = Array.from({ length: N }, () =>
    new Array<number>(N).fill(0),
  );

  const patternsPerRow: number[][][] = [];
  for (let r = 0; r < N; r++) {
    const copy = ROW_PATTERNS.slice();
    shuffle(copy);
    patternsPerRow.push(copy);
  }

  function backtrack(r: number): boolean {
    if (r === N) {
      if (colCounts.every((c) => c === 3) && blockCounts.every((b) => b === 3)) {
        return true;
      }
      return false;
    }

    const remainingRows = N - (r + 1);

    for (const row of patternsPerRow[r]) {
      let ok = true;
      const addCols = new Array<number>(N).fill(0);
      const addBlocks = new Array<number>(N).fill(0);

      for (let c = 0; c < N; c++) {
        const val = row[c];
        if (!val) continue;
        const blockId = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        const newCol = colCounts[c] + 1;
        const newBlock = blockCounts[blockId] + 1;
        if (newCol > 3 || newBlock > 3) {
          ok = false;
          break;
        }
        addCols[c] += 1;
        addBlocks[blockId] += 1;
      }

      if (!ok) continue;

      // apply
      for (let c = 0; c < N; c++) colCounts[c] += addCols[c];
      for (let b = 0; b < N; b++) blockCounts[b] += addBlocks[b];
      boardRows[r] = row;

      // close 3-row band: each of its three blocks must be exactly 3
      if (r % 3 === 2) {
        const blockRow = Math.floor(r / 3);
        const start = blockRow * 3;
        const end = start + 3;
        if (!blockCounts.slice(start, end).every((bc) => bc === 3)) {
          for (let c = 0; c < N; c++) colCounts[c] -= addCols[c];
          for (let b = 0; b < N; b++) blockCounts[b] -= addBlocks[b];
          continue;
        }
      }

      // column feasibility
      let feasible = true;
      for (let c = 0; c < N; c++) {
        if (colCounts[c] > 3 || colCounts[c] + remainingRows < 3) {
          feasible = false;
          break;
        }
      }

      if (feasible && backtrack(r + 1)) {
        return true;
      }

      // revert
      for (let c = 0; c < N; c++) colCounts[c] -= addCols[c];
      for (let b = 0; b < N; b++) blockCounts[b] -= addBlocks[b];
    }

    return false;
  }

  if (!backtrack(0)) {
    throw new Error("Failed to generate a valid board");
  }

  return clone2D(boardRows);
}

// ---------- Clue computation (Minesweeper-style) ----------

export function computeClues(board: Board): number[][] {
  const clues: number[][] = Array.from({ length: N }, () =>
    new Array<number>(N).fill(0),
  );
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      let cnt = 0;
      for (const [dr, dc] of NEIGHBOR_DIRS) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr][cc] === 1) {
          cnt++;
        }
      }
      clues[r][c] = cnt;
    }
  }
  return clues;
}

function checkConstraints(board: Board): void {
  // rows
  for (let r = 0; r < N; r++) {
    const sum = board[r].reduce((a, b) => a + b, 0);
    if (sum !== 3) {
      throw new Error(`Row ${r} has ${sum} berries`);
    }
  }
  // cols
  for (let c = 0; c < N; c++) {
    let sum = 0;
    for (let r = 0; r < N; r++) sum += board[r][c];
    if (sum !== 3) {
      throw new Error(`Col ${c} has ${sum} berries`);
    }
  }
  // 3x3 blocks
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      let sum = 0;
      for (let r = br * 3; r < br * 3 + 3; r++) {
        for (let c = bc * 3; c < bc * 3 + 3; c++) {
          sum += board[r][c];
        }
      }
      if (sum !== 3) {
        throw new Error(`Block (${br},${bc}) has ${sum} berries`);
      }
    }
  }
}

// ---------- Solver: count solutions for a given clue set ----------

export function solveCount(clues: Map<string, number>, maxSolutions = 2): number {
  const clueList: CellClue[] = [];
  const rowForbiddenCols: Map<number, Set<number>> = new Map();

  clues.forEach((v, key) => {
    const [rs, cs] = key.split(",");
    const r = parseInt(rs, 10);
    const c = parseInt(cs, 10);
    clueList.push({ r, c, v });
    if (!rowForbiddenCols.has(r)) rowForbiddenCols.set(r, new Set());
    rowForbiddenCols.get(r)!.add(c);
  });

  const validRows: number[][][] = [];
  for (let r = 0; r < N; r++) {
    const forbidden = rowForbiddenCols.get(r) ?? new Set<number>();
    const rowsForR: number[][] = [];
    for (const pattern of ROW_PATTERNS) {
      let ok = true;
      for (const fc of forbidden) {
        if (pattern[fc] === 1) {
          ok = false;
          break;
        }
      }
      if (ok) rowsForR.push(pattern);
    }
    validRows.push(rowsForR);
  }

  const colCounts = new Array<number>(N).fill(0);
  const blockCounts = new Array<number>(N).fill(0);
  const boardRows: Board = Array.from({ length: N }, () =>
    new Array<number>(N).fill(0),
  );

  let solutions = 0;

  function checkCluesPartial(lastRowIndex: number): boolean {
    for (const clue of clueList) {
      const { r: cr, c: cc, v: clueVal } = clue;

      let current = 0;
      let unknownMaxAdd = 0;

      for (const [dr, dc] of NEIGHBOR_DIRS) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) {
          if (nr <= lastRowIndex) {
            current += boardRows[nr][nc];
          } else {
            unknownMaxAdd++;
          }
        }
      }

      if (current > clueVal) return false;
      if (current + unknownMaxAdd < clueVal) return false;
      if (unknownMaxAdd === 0 && current !== clueVal) return false;
    }
    return true;
  }

  function checkCluesFull(): boolean {
    for (const clue of clueList) {
      const { r: cr, c: cc, v: clueVal } = clue;
      let cnt = 0;
      for (const [dr, dc] of NEIGHBOR_DIRS) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) {
          cnt += boardRows[nr][nc];
        }
      }
      if (cnt !== clueVal) return false;
    }
    return true;
  }

  function backtrack(r: number): void {
    if (solutions >= maxSolutions) return;
    if (r === N) {
      if (!colCounts.every((c) => c === 3)) return;
      if (!blockCounts.every((b) => b === 3)) return;
      if (!checkCluesFull()) return;
      solutions++;
      return;
    }

    const remainingRows = N - (r + 1);

    for (const row of validRows[r]) {
      let ok = true;
      const addCols = new Array<number>(N).fill(0);
      const addBlocks = new Array<number>(N).fill(0);

      for (let c = 0; c < N; c++) {
        const val = row[c];
        if (!val) continue;
        const newCol = colCounts[c] + 1;
        if (newCol > 3) {
          ok = false;
          break;
        }
        const blockId = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        const newBlock = blockCounts[blockId] + 1;
        if (newBlock > 3) {
          ok = false;
          break;
        }
        addCols[c] += 1;
        addBlocks[blockId] += 1;
      }

      if (!ok) continue;

      for (let c = 0; c < N; c++) colCounts[c] += addCols[c];
      for (let b = 0; b < N; b++) blockCounts[b] += addBlocks[b];
      boardRows[r] = row;

      if (r % 3 === 2) {
        const blockRow = Math.floor(r / 3);
        const start = blockRow * 3;
        const end = start + 3;
        if (!blockCounts.slice(start, end).every((bc) => bc === 3)) {
          for (let c = 0; c < N; c++) colCounts[c] -= addCols[c];
          for (let b = 0; b < N; b++) blockCounts[b] -= addBlocks[b];
          continue;
        }
      }

      let feasible = true;
      for (let c = 0; c < N; c++) {
        if (colCounts[c] > 3 || colCounts[c] + remainingRows < 3) {
          feasible = false;
          break;
        }
      }

      if (feasible && checkCluesPartial(r)) {
        backtrack(r + 1);
      }

      for (let c = 0; c < N; c++) colCounts[c] -= addCols[c];
      for (let b = 0; b < N; b++) blockCounts[b] -= addBlocks[b];
    }
  }

  backtrack(0);
  return solutions;
}

// ---------- Puzzle generator with clue minimization + density ----------

function cellsToMap(cells: CellClue[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const cell of cells) {
    m.set(`${cell.r},${cell.c}`, cell.v);
  }
  return m;
}

function cellKey(cell: CellClue): string {
  return `${cell.r},${cell.c}`;
}

const MIN_DENSE_CLUES = 22; // heuristic; adjust if you like

export function makePuzzle(options?: { dense?: boolean }): Puzzle {
  const dense = options?.dense ?? false;

  const board = generateBoard();
  checkConstraints(board);
  const cluesFull = computeClues(board);

  const clueCells: CellClue[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (board[r][c] === 0) {
        clueCells.push({ r, c, v: cluesFull[r][c] });
      }
    }
  }

  let active: CellClue[] = clueCells.slice();
  const baseMap = cellsToMap(active);
  solveCount(baseMap, 2); // warmup / sanity

  const order = clueCells.slice();
  shuffle(order);

  // Minimalise: remove clues while uniqueness stays == 1
  for (const cell of order) {
    const { r, c } = cell;
    const trial = active.filter((cl) => !(cl.r === r && cl.c === c));
    const trialMap = cellsToMap(trial);
    const sols = solveCount(trialMap, 2);
    if (sols === 1) {
      active = trial; // still unique, so remove
    }
  }

  // --- Reasonable clue density heuristic (optional) ---
  if (dense) {
    const activeSet = new Set(active.map(cellKey));
    let removed = clueCells.filter((cl) => !activeSet.has(cellKey(cl)));

    // Ensure each 3x3 block has at least one clue
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const hasActiveInBlock = active.some(
          (cl) =>
            Math.floor(cl.r / 3) === br && Math.floor(cl.c / 3) === bc,
        );
        if (!hasActiveInBlock) {
          const idx = removed.findIndex(
            (cl) =>
              Math.floor(cl.r / 3) === br && Math.floor(cl.c / 3) === bc,
          );
          if (idx !== -1) {
            const picked = removed[idx];
            active.push(picked);
            activeSet.add(cellKey(picked));
            removed.splice(idx, 1);
          }
        }
      }
    }

    // Ensure at least MIN_DENSE_CLUES clues total
    if (active.length < MIN_DENSE_CLUES) {
      shuffle(removed);
      while (active.length < MIN_DENSE_CLUES && removed.length > 0) {
        const picked = removed.pop()!;
        if (!activeSet.has(cellKey(picked))) {
          active.push(picked);
          activeSet.add(cellKey(picked));
        }
      }
    }
    // Adding clues never breaks uniqueness (only makes puzzle easier).
  }

  const puzzleClues: ClueGrid = Array.from({ length: N }, () =>
    new Array<number | null>(N).fill(null),
  );
  for (const cl of active) {
    puzzleClues[cl.r][cl.c] = cl.v;
  }

  return { solution: board, puzzleClues };
}

// ---------- Solver: produce one solution board for a given clue grid ----------

export function solveOneFromClueGrid(puzzleClues: ClueGrid): Board | null {
  // Build clues map: key "r,c" -> clue value.
  // Any cell with a clue is guaranteed to be empty (forbidden berry).
  const clues = new Map<string, number>();
  const rowForbiddenCols: Map<number, Set<number>> = new Map();

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = puzzleClues[r][c];
      if (v === null) continue;
      clues.set(`${r},${c}`, v);
      if (!rowForbiddenCols.has(r)) rowForbiddenCols.set(r, new Set());
      rowForbiddenCols.get(r)!.add(c);
    }
  }

  // Convert clues to list for faster iteration in checks
  type CellClue = { r: number; c: number; v: number };
  const clueList: CellClue[] = [];
  clues.forEach((v, key) => {
    const [rs, cs] = key.split(",");
    clueList.push({ r: parseInt(rs, 10), c: parseInt(cs, 10), v });
  });

  // Precompute allowed row patterns for each row (respecting forbidden cols)
  const validRows: number[][][] = [];
  for (let r = 0; r < N; r++) {
    const forbidden = rowForbiddenCols.get(r) ?? new Set<number>();
    const rowsForR: number[][] = [];
    for (const pattern of ROW_PATTERNS) {
      let ok = true;
      for (const fc of forbidden) {
        if (pattern[fc] === 1) {
          ok = false;
          break;
        }
      }
      if (ok) rowsForR.push(pattern);
    }
    validRows.push(rowsForR);
  }

  const colCounts = new Array<number>(N).fill(0);
  const blockCounts = new Array<number>(N).fill(0);
  const boardRows: Board = Array.from({ length: N }, () => new Array<number>(N).fill(0));

  function checkCluesPartial(lastRowIndex: number): boolean {
    for (const clue of clueList) {
      const { r: cr, c: cc, v: clueVal } = clue;

      let current = 0;
      let unknownMaxAdd = 0;

      for (const [dr, dc] of NEIGHBOR_DIRS) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) {
          if (nr <= lastRowIndex) {
            current += boardRows[nr][nc];
          } else {
            unknownMaxAdd++;
          }
        }
      }

      if (current > clueVal) return false;
      if (current + unknownMaxAdd < clueVal) return false;
      if (unknownMaxAdd === 0 && current !== clueVal) return false;
    }
    return true;
  }

  function checkCluesFull(): boolean {
    for (const clue of clueList) {
      const { r: cr, c: cc, v: clueVal } = clue;
      let cnt = 0;
      for (const [dr, dc] of NEIGHBOR_DIRS) {
        const nr = cr + dr;
        const nc = cc + dc;
        if (nr >= 0 && nr < N && nc >= 0 && nc < N) {
          cnt += boardRows[nr][nc];
        }
      }
      if (cnt !== clueVal) return false;
    }
    return true;
  }

  function cloneBoardRows(): Board {
    return boardRows.map((row) => row.slice());
  }

  function backtrack(r: number): Board | null {
    if (r === N) {
      if (!colCounts.every((c) => c === 3)) return null;
      if (!blockCounts.every((b) => b === 3)) return null;
      if (!checkCluesFull()) return null;
      return cloneBoardRows();
    }

    const remainingRows = N - (r + 1);

    for (const row of validRows[r]) {
      let ok = true;
      const addCols = new Array<number>(N).fill(0);
      const addBlocks = new Array<number>(N).fill(0);

      for (let c = 0; c < N; c++) {
        const val = row[c];
        if (!val) continue;

        const newCol = colCounts[c] + 1;
        if (newCol > 3) {
          ok = false;
          break;
        }

        const blockId = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        const newBlock = blockCounts[blockId] + 1;
        if (newBlock > 3) {
          ok = false;
          break;
        }

        addCols[c] += 1;
        addBlocks[blockId] += 1;
      }

      if (!ok) continue;

      // apply
      for (let c = 0; c < N; c++) colCounts[c] += addCols[c];
      for (let b = 0; b < N; b++) blockCounts[b] += addBlocks[b];
      boardRows[r] = row;

      // close 3-row band: each of its three blocks must be exactly 3
      if (r % 3 === 2) {
        const blockRow = Math.floor(r / 3);
        const start = blockRow * 3;
        const end = start + 3;
        if (!blockCounts.slice(start, end).every((bc) => bc === 3)) {
          for (let c = 0; c < N; c++) colCounts[c] -= addCols[c];
          for (let b = 0; b < N; b++) blockCounts[b] -= addBlocks[b];
          continue;
        }
      }

      // column feasibility
      let feasible = true;
      for (let c = 0; c < N; c++) {
        if (colCounts[c] > 3 || colCounts[c] + remainingRows < 3) {
          feasible = false;
          break;
        }
      }

      if (feasible && checkCluesPartial(r)) {
        const res = backtrack(r + 1);
        if (res) return res;
      }

      // revert
      for (let c = 0; c < N; c++) colCounts[c] -= addCols[c];
      for (let b = 0; b < N; b++) blockCounts[b] -= addBlocks[b];
    }

    return null;
  }

  return backtrack(0);
}
