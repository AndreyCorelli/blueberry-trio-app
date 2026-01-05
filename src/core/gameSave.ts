import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Puzzle } from "../core/blueberryCore";

export type PlayerCellState = -1 | 0 | 1;

export type PuzzleSource = "generated" | "pool";

export type SavedGameV1 = {
  v: 1;
  savedAt: number;

  // puzzle setup
  puzzle: Puzzle;

  // player progress
  playerBoard: PlayerCellState[][];
  history: PlayerCellState[][][];
  future: PlayerCellState[][][];

  // optional: remember what "next puzzle difficulty" was set to
  useDense: boolean;
  puzzleSource?: PuzzleSource;
  poolIndex?: number | null; // 0-based index in pool
};

// ---------- Pool types ----------

export type PuzzleEntryV1 = {
  genSeconds: number;
  humanComplex: number;
  clues81: number[]; // length 81; -1 = empty, 0..8 = clue
};

export type PuzzlePoolV1 = {
  version: 1;
  N: number;                 // expected 9
  generatedAtUtc: string;
  puzzles: PuzzleEntryV1[];
};

export type PoolProgressV1 = {
  v: 1;
  poolVersion: string;     // you decide what to put here (e.g. generatedAtUtc or your own string)

  loaded: number[];        // indexes already loaded (sorted not required)
  solved: number[];        // indexes solved (optional usage now)
};


type SolveFromCluesFn = (puzzleClues: (number | null)[][]) => number[][]; // returns solution board (0/1)

export function decodeClues81ToGrid(clues81: number[], N: number): (number | null)[][] {
  if (clues81.length !== N * N) {
    throw new Error(`clues81 length mismatch: got ${clues81.length}, expected ${N * N}`);
  }
  const grid: (number | null)[][] = Array.from({ length: N }, () => new Array<number | null>(N).fill(null));
  let k = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = clues81[k++];
      if (v === -1) grid[r][c] = null;
      else {
        if (!Number.isInteger(v) || v < 0 || v > 8) {
          throw new Error(`Invalid clue value in pool: ${v}`);
        }
        grid[r][c] = v;
      }
    }
  }
  return grid;
}

const STORAGE_KEY = "blueberry:lastGame:v1";
const POOL_PROGRESS_KEY = "blueberry:poolProgress:v1";

// ---------- helpers ----------

function is2D<T>(x: unknown, rows: number, cols: number): x is T[][] {
  if (!Array.isArray(x) || x.length !== rows) return false;
  return x.every((row) => Array.isArray(row) && row.length === cols);
}

function is3D<T>(x: unknown, depthMax: number, rows: number, cols: number): x is T[][][] {
  if (!Array.isArray(x) || x.length > depthMax) return false;
  return x.every((board) => is2D<T>(board, rows, cols));
}

function isPlayerCell(v: unknown): v is PlayerCellState {
  return v === -1 || v === 0 || v === 1;
}

function validateSavedGameV1(x: unknown, N: number): x is SavedGameV1 {
  if (!x || typeof x !== "object") return false;
  const o = x as any;
  if (o.v !== 1) return false;
  if (typeof o.savedAt !== "number") return false;
  if (typeof o.useDense !== "boolean") return false;

  // puzzle: minimal sanity (shape)
  const p = o.puzzle as Puzzle;
  if (!p || typeof p !== "object") return false;
  if (!is2D<number>(p.solution, N, N)) return false;
  if (!is2D<number | null>(p.puzzleClues, N, N)) return false;
  if (o.puzzleSource !== undefined && o.puzzleSource !== "generated" && o.puzzleSource !== "pool") {
    return false;
  }
  if (o.poolIndex !== undefined && o.poolIndex !== null && typeof o.poolIndex !== "number") {
    return false;
  }
  if (typeof o.poolIndex === "number" && (!Number.isInteger(o.poolIndex) || o.poolIndex < 0)) {
    return false;
  }

  // player board
  if (!is2D<unknown>(o.playerBoard, N, N)) return false;
  if (!o.playerBoard.every((row: unknown[]) => row.every(isPlayerCell))) return false;

  // history/future can be empty; limit depth to avoid accidental huge payloads
  if (!is3D<PlayerCellState>(o.history, 1500, N, N)) return false;
  if (!is3D<PlayerCellState>(o.future, 1500, N, N)) return false;

  // validate history/future cell values too
  for (const board of o.history) {
    for (const row of board) for (const cell of row) if (!isPlayerCell(cell)) return false;
  }
  for (const board of o.future) {
    for (const row of board) for (const cell of row) if (!isPlayerCell(cell)) return false;
  }

  return true;
}

// ---------- API ----------

export async function loadSavedGame(N: number): Promise<SavedGameV1 | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!validateSavedGameV1(parsed, N)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveGame(game: SavedGameV1): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(game));
}

export async function clearSavedGame(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

// ---------- debounced saver ----------

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: SavedGameV1 | null = null;

export function scheduleSave(game: SavedGameV1, delayMs = 120): void {
  pending = game;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const toSave = pending;
    pending = null;
    timer = null;
    if (toSave) void saveGame(toSave);
  }, delayMs);
}

export function createEmptyPlayerBoard(N: number): PlayerCellState[][] {
  return Array.from({ length: N }, () => new Array<PlayerCellState>(N).fill(0));
}

export function createNewSavedGameFromPuzzle(puzzle: Puzzle, useDense: boolean): SavedGameV1 {
  const N = puzzle.puzzleClues.length;
  return {
    v: 1,
    savedAt: Date.now(),
    puzzle,
    playerBoard: createEmptyPlayerBoard(N),
    history: [],
    future: [],
    useDense,
  };
}

export function buildPuzzleFromPoolIndex(
  pool: PuzzlePoolV1,
  index: number,
  options?: { solveFromClues?: SolveFromCluesFn },
): Puzzle {
  if (pool.version !== 1) throw new Error(`Unsupported pool version: ${pool.version}`);
  if (pool.N <= 0) throw new Error(`Invalid pool N: ${pool.N}`);
  if (index < 0 || index >= pool.puzzles.length) {
    throw new Error(`Pool index out of range: ${index} / ${pool.puzzles.length}`);
  }

  const entry = pool.puzzles[index];
  const puzzleClues = decodeClues81ToGrid(entry.clues81, pool.N);

  // If you can solve, populate solution; otherwise keep a placeholder.
  // App logic that relies on solution (Check / Show solution) should be disabled
  // until solveFromClues is implemented, OR you can add "solution81" to the pool later.
  const solution =
    options?.solveFromClues
      ? options.solveFromClues(puzzleClues)
      : Array.from({ length: pool.N }, () => new Array<number>(pool.N).fill(0));

  return { puzzleClues, solution };
}

function uniqSorted(nums: number[]): number[] {
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

function toSet(nums: number[]): Set<number> {
  return new Set(nums);
}

function validatePoolProgressV1(x: unknown): x is PoolProgressV1 {
  if (!x || typeof x !== "object") return false;
  const o = x as any;
  if (o.v !== 1) return false;
  if (typeof o.poolVersion !== "string") return false;
  if (!Array.isArray(o.loaded) || !o.loaded.every(Number.isInteger)) return false;
  if (!Array.isArray(o.solved) || !o.solved.every(Number.isInteger)) return false;
  return true;
}

// You can choose how to define "poolVersion". A pragmatic default is pool.generatedAtUtc.
export function getPoolVersion(pool: PuzzlePoolV1): string {
  return `v${pool.version}|N${pool.N}|t${pool.generatedAtUtc}`;
}

export async function loadPoolProgress(pool: PuzzlePoolV1): Promise<PoolProgressV1> {
  const poolVersion = getPoolVersion(pool);

  const raw = await AsyncStorage.getItem(POOL_PROGRESS_KEY);
  if (!raw) {
    return { v: 1, poolVersion, loaded: [], solved: [] };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!validatePoolProgressV1(parsed)) {
      return { v: 1, poolVersion, loaded: [], solved: [] };
    }

    if (parsed.poolVersion !== poolVersion) {
      return { v: 1, poolVersion, loaded: [], solved: [] };
    }

    return {
      ...parsed,
      loaded: uniqSorted(parsed.loaded),
      solved: uniqSorted(parsed.solved),
    };
  } catch {
    return { v: 1, poolVersion, loaded: [], solved: [] };
  }
}

export async function savePoolProgress(progress: PoolProgressV1): Promise<void> {
  await AsyncStorage.setItem(POOL_PROGRESS_KEY, JSON.stringify(progress));
}

export async function markPoolIndexLoaded(pool: PuzzlePoolV1, index: number): Promise<PoolProgressV1> {
  const progress = await loadPoolProgress(pool);
  progress.loaded = uniqSorted([...progress.loaded, index]);
  await savePoolProgress(progress);
  return progress;
}

export async function markPoolIndexSolved(pool: PuzzlePoolV1, index: number): Promise<PoolProgressV1> {
  const progress = await loadPoolProgress(pool);
  progress.solved = uniqSorted([...progress.solved, index]);
  await savePoolProgress(progress);
  return progress;
}

export function getNextNotLoadedIndex(pool: PuzzlePoolV1, progress: PoolProgressV1): number | null {
  const loaded = toSet(progress.loaded);
  for (let i = 0; i < pool.puzzles.length; i++) {
    if (!loaded.has(i)) return i;
  }
  return null;
}

export function getRandomNotLoadedIndex(pool: PuzzlePoolV1, progress: PoolProgressV1): number | null {
  const loaded = toSet(progress.loaded);
  const remaining: number[] = [];
  for (let i = 0; i < pool.puzzles.length; i++) {
    if (!loaded.has(i)) remaining.push(i);
  }
  if (remaining.length === 0) return null;
  const pick = remaining[Math.floor(Math.random() * remaining.length)];
  return pick;
}

// Reset progress for the CURRENT pool version.
// If the stored progress belongs to another pool version, we also clear it (safe).
export async function resetPoolProgress(pool: PuzzlePoolV1): Promise<void> {
  const raw = await AsyncStorage.getItem(POOL_PROGRESS_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as any;

    // If you store poolVersion in progress (recommended), clear only if it matches.
    // If you don't store poolVersion, just remove the key.
    const currentVersion = getPoolVersion(pool);
    const storedVersion = typeof parsed?.poolVersion === "string" ? parsed.poolVersion : null;

    if (!storedVersion || storedVersion === currentVersion) {
      await AsyncStorage.removeItem(POOL_PROGRESS_KEY);
      return;
    }

    // Stored progress belongs to some other pool; still OK to clear (simplifies UX).
    await AsyncStorage.removeItem(POOL_PROGRESS_KEY);
  } catch {
    // Corrupt payload → clear it
    await AsyncStorage.removeItem(POOL_PROGRESS_KEY);
  }
}
