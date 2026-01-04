import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Puzzle } from "../core/blueberryCore";

export type PlayerCellState = -1 | 0 | 1;

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
};

const STORAGE_KEY = "blueberry:lastGame:v1";

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

  // player board
  if (!is2D<unknown>(o.playerBoard, N, N)) return false;
  if (!o.playerBoard.every((row: unknown[]) => row.every(isPlayerCell))) return false;

  // history/future can be empty; limit depth to avoid accidental huge payloads
  if (!is3D<PlayerCellState>(o.history, 500, N, N)) return false;
  if (!is3D<PlayerCellState>(o.future, 500, N, N)) return false;

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
