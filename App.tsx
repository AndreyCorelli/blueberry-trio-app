import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  Pressable,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Animated,
  Easing,
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";
import { makePuzzle, N, solveOneFromClueGrid } from "./src/core/blueberryCore";
import type { Puzzle } from "./src/core/blueberryCore";
import { computeClueAreaViolations } from "./src/core/clueCheck";
import {
  scheduleSave,
  clearSavedGame,
  loadPoolProgress,
  getNextNotLoadedIndex,
  getRandomNotLoadedIndex,
  markPoolIndexLoaded,
  markPoolIndexSolved,
  resetPoolProgress,
} from "./src/core/gameSave";

import type { PuzzlePoolV1 } from "./src/core/gameSave";

type PlayerCellState = -1 | 0 | 1; // -1 = marked empty, 0 = unknown, 1 = berry

type Violations = {
  row: boolean[];
  col: boolean[];
  block: boolean[];
  clueArea: boolean[][];
};

// Pool JSON is bundled into the app
const RAW_POOL_JSON = require("./assets/pool/puzzlePool.v1.json");

function computeViolations(board: PlayerCellState[][], puzzle: Puzzle): Violations {
  const row = new Array<boolean>(N).fill(false);
  const col = new Array<boolean>(N).fill(false);
  const block = new Array<boolean>(N).fill(false);
  const { clueArea } = computeClueAreaViolations(board, puzzle.puzzleClues);

  // --- Row violations ---
  for (let r = 0; r < N; r++) {
    let berries = 0;
    let unknown = 0;
    for (let c = 0; c < N; c++) {
      const v = board[r]?.[c] ?? 0;
      if (v === 1) berries++;
      else if (v === 0) unknown++;
    }
    if (berries > 3 || (unknown === 0 && berries !== 3)) {
      row[r] = true;
    }
  }

  // --- Column violations ---
  for (let c = 0; c < N; c++) {
    let berries = 0;
    let unknown = 0;
    for (let r = 0; r < N; r++) {
      const v = board[r]?.[c] ?? 0;
      if (v === 1) berries++;
      else if (v === 0) unknown++;
    }
    if (berries > 3 || (unknown === 0 && berries !== 3)) {
      col[c] = true;
    }
  }

  // --- 3x3 block violations ---
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      let berries = 0;
      let unknown = 0;
      for (let r = br * 3; r < br * 3 + 3; r++) {
        for (let c = bc * 3; c < bc * 3 + 3; c++) {
          const v = board[r]?.[c] ?? 0;
          if (v === 1) berries++;
          else if (v === 0) unknown++;
        }
      }
      const blockIndex = br * 3 + bc;
      if (berries > 3 || (unknown === 0 && berries !== 3)) {
        block[blockIndex] = true;
      }
    }
  }

  return { row, col, block, clueArea };
}

function isInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x);
}

function validatePoolOrThrow(x: unknown): PuzzlePoolV1 {
  if (!x || typeof x !== "object") throw new Error("Pool JSON is not an object");
  const o = x as any;

  if (o.version !== 1) throw new Error(`Unsupported pool version: ${String(o.version)}`);
  if (!isInt(o.N) || o.N !== N) throw new Error(`Pool N mismatch: file=${String(o.N)} code=${N}`);
  if (typeof o.generatedAtUtc !== "string") throw new Error("Pool generatedAtUtc missing/invalid");

  if (!Array.isArray(o.puzzles)) throw new Error("Pool puzzles must be an array");
  if (o.puzzles.length === 0) throw new Error("Pool puzzles is empty");

  for (let i = 0; i < o.puzzles.length; i++) {
    const p = o.puzzles[i];
    if (!p || typeof p !== "object") throw new Error(`Puzzle[${i}] is not an object`);
    if (typeof p.genSeconds !== "number" || !Number.isFinite(p.genSeconds) || p.genSeconds < 0) {
      throw new Error(`Puzzle[${i}].genSeconds invalid`);
    }
    if (typeof p.humanComplex !== "number" || !Number.isFinite(p.humanComplex)) {
      throw new Error(`Puzzle[${i}].humanComplex invalid`);
    }
    if (!Array.isArray(p.clues81) || p.clues81.length !== N * N) {
      throw new Error(`Puzzle[${i}].clues81 must be length ${N * N}`);
    }
    for (const v of p.clues81) {
      if (!isInt(v) || (v !== -1 && (v < 0 || v > 8))) {
        throw new Error(`Puzzle[${i}].clues81 contains invalid value: ${String(v)}`);
      }
    }
  }

  return o as PuzzlePoolV1;
}


function decodeClues81ToGrid(clues81: number[]): (number | null)[][] {
  if (clues81.length !== N * N) {
    throw new Error(`clues81 length mismatch: got ${clues81.length}, expected ${N * N}`);
  }
  const grid: (number | null)[][] = Array.from({ length: N }, () =>
    new Array<number | null>(N).fill(null),
  );
  let k = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = clues81[k++];
      grid[r][c] = v === -1 ? null : v;
    }
  }
  return grid;
}

function createEmptyPlayerBoard(): PlayerCellState[][] {
  return Array.from({ length: N }, () => new Array<PlayerCellState>(N).fill(0));
}

const CELL_SIZE = 32;
const TOTAL_BERRIES_REQUIRED = 27;

type Screen = "start" | "game";
type PuzzleSource = "generated" | "pool";

export default function App() {
  const [screen, setScreen] = useState<Screen>("start");

  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [puzzleSource, setPuzzleSource] = useState<PuzzleSource>("generated");

  const [playerBoard, setPlayerBoard] = useState<PlayerCellState[][]>([]);
  const [showSolution, setShowSolution] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [statusOk, setStatusOk] = useState<boolean | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [violations, setViolations] = useState<Violations>({
    row: new Array<boolean>(N).fill(false),
    col: new Array<boolean>(N).fill(false),
    block: new Array<boolean>(N).fill(false),
    clueArea: Array.from({ length: N }, () => new Array<boolean>(N).fill(false)),
  });

  const [history, setHistory] = useState<PlayerCellState[][][]>([]);
  const [future, setFuture] = useState<PlayerCellState[][][]>([]);

  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  const totalBerries = playerBoard.reduce(
    (acc, row) => acc + row.filter((v) => v === 1).length,
    0,
  );

  const readyToCheck = !!puzzle && !showSolution && totalBerries === TOTAL_BERRIES_REQUIRED;

  const checkPulse = useRef(new Animated.Value(1)).current;

  const [pool, setPool] = useState<PuzzlePoolV1 | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);

  const poolSize = pool?.puzzles.length ?? 0;  

  const poolAvailable = useMemo(() => !!pool && poolSize > 0, [pool, poolSize]);
  const [currentPoolIndex, setCurrentPoolIndex] = useState<number | null>(null);
  const [poolProgressLoadedCount, setPoolProgressLoadedCount] = useState<number>(0);
  const poolRemaining = pool ? Math.max(0, poolSize - poolProgressLoadedCount) : 0;
  const poolHasRemaining = poolAvailable && poolRemaining > 0; 
  const [isSolved, setIsSolved] = useState(false); 


  function resetGameState() {
    setPuzzle(null);
    setPlayerBoard([]);
    setShowSolution(false);
    setStatus("");
    setStatusOk(null);
    setHistory([]);
    setFuture([]);
    setViolations({
      row: new Array<boolean>(N).fill(false),
      col: new Array<boolean>(N).fill(false),
      block: new Array<boolean>(N).fill(false),
      clueArea: Array.from({ length: N }, () => new Array<boolean>(N).fill(false)),
    });
  }

  function startGameWithPuzzle(p: Puzzle, source: PuzzleSource) {
    const empty = createEmptyPlayerBoard();
    setPuzzle(p);
    setPuzzleSource(source);
    setPlayerBoard(empty);
    setViolations(computeViolations(empty, p));
    setHistory([]);
    setFuture([]);
    setShowSolution(false);
    setIsSolved(false);
    setStatus("");
    setStatusOk(null);
    setScreen("game");
  }

  function generatePuzzle(dense: boolean) {
    setIsGenerating(true);
    setStatus("");
    setStatusOk(null);
    setShowSolution(false);

    setTimeout(() => {
      const p = makePuzzle({ dense });
      startGameWithPuzzle(p, "generated");
      setIsGenerating(false);
    }, 0);
  }

  async function loadNextPuzzleFromPool() {
    if (!poolAvailable) return;
    setIsGenerating(true);
    setStatus("");
    setStatusOk(null);
  
    try {
      const progress = await loadPoolProgress(pool!);
      const idx = getNextNotLoadedIndex(pool!, progress);
  
      if (idx === null) {
        setStatus("Pool exhausted. No new puzzles left.");
        setStatusOk(null);
        return;
      }
  
      const entry = pool!.puzzles[idx];
      const puzzleClues = decodeClues81ToGrid(entry.clues81);
  
      const solution = solveOneFromClueGrid(puzzleClues);
      if (!solution) {
        setStatus(`Pool puzzle #${idx} could not be solved. Skipping.`);
        setStatusOk(false);
        // mark it loaded so you don't get stuck hitting it repeatedly
        await markPoolIndexLoaded(pool!, idx);
        return;
      }
  
      const p: Puzzle = { puzzleClues, solution };
      startGameWithPuzzle(p, "pool");
      setCurrentPoolIndex(idx);
  
      const updated = await markPoolIndexLoaded(pool!, idx);
      setPoolProgressLoadedCount(updated.loaded.length);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Failed to load next pool puzzle: ${msg}`);
      setStatusOk(false);
    } finally {
      setIsGenerating(false);
    }
  }
  

  async function loadRandomPuzzleFromPool() {
    if (!poolAvailable) return;
    setIsGenerating(true);
    setStatus("");
    setStatusOk(null);
  
    try {
      const progress = await loadPoolProgress(pool!);
      const idx = getRandomNotLoadedIndex(pool!, progress);
  
      if (idx === null) {
        setStatus("Pool exhausted. No new puzzles left.");
        setStatusOk(null);
        return;
      }
  
      const entry = pool!.puzzles[idx];
      const puzzleClues = decodeClues81ToGrid(entry.clues81);
  
      const solution = solveOneFromClueGrid(puzzleClues);
      if (!solution) {
        setStatus(`Pool puzzle #${idx} could not be solved. Skipping.`);
        setStatusOk(false);
        await markPoolIndexLoaded(pool!, idx);
        return;
      }
  
      const p: Puzzle = { puzzleClues, solution };
      startGameWithPuzzle(p, "pool");
      setCurrentPoolIndex(idx);
  
      const updated = await markPoolIndexLoaded(pool!, idx);
      setPoolProgressLoadedCount(updated.loaded.length);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Failed to load random pool puzzle: ${msg}`);
      setStatusOk(false);
    } finally {
      setIsGenerating(false);
    }
  }
  

  function newGame() {
    setCurrentPoolIndex(null);
    resetGameState();
    setIsSolved(false);
    void clearSavedGame();
    setScreen("start");
  }

  function handleCellPress(r: number, c: number) {
    if (!puzzle) return;
    const clue = puzzle.puzzleClues[r][c];
    if (clue !== null) return; // fixed clue, not editable
    if (showSolution) return; // don't edit while showing solution

    setStatus("");
    setStatusOk(null);

    setPlayerBoard((prevBoard) => {
      const prevSnapshot = prevBoard.map((row) => row.slice());
      const nextBoard = prevBoard.map((row) => row.slice());

      const current = nextBoard[r][c];
      let nextVal: PlayerCellState;
      if (current === 0) nextVal = 1;
      else if (current === 1) nextVal = -1;
      else nextVal = 0;
      nextBoard[r][c] = nextVal;

      setHistory((h) => [...h, prevSnapshot]);
      setFuture([]);
      setViolations(computeViolations(nextBoard, puzzle));

      return nextBoard;
    });
  }

  function clearBoard() {
    if (!puzzle) return;
    const empty = createEmptyPlayerBoard();
    setPlayerBoard((prevBoard) => {
      const prevSnapshot = prevBoard.map((row) => row.slice());
      setHistory((h) => [...h, prevSnapshot]);
      setFuture([]);
      setViolations(computeViolations(empty, puzzle));
      setStatus("");
      setStatusOk(null);
      return empty;
    });
  }

  function undo() {
    if (!puzzle) return;
    setHistory((prevHist) => {
      if (prevHist.length === 0) return prevHist;
      const newHist = [...prevHist];
      const lastBoard = newHist.pop()!;
      setPlayerBoard((currentBoard) => {
        const currentSnapshot = currentBoard.map((row) => row.slice());
        setFuture((f) => [...f, currentSnapshot]);
        setViolations(computeViolations(lastBoard, puzzle));
        return lastBoard;
      });
      setStatus("");
      setStatusOk(null);
      return newHist;
    });
  }

  function redo() {
    if (!puzzle) return;
    setFuture((prevFuture) => {
      if (prevFuture.length === 0) return prevFuture;
      const newFuture = [...prevFuture];
      const nextBoard = newFuture.pop()!;
      setPlayerBoard((currentBoard) => {
        const currentSnapshot = currentBoard.map((row) => row.slice());
        setHistory((h) => [...h, currentSnapshot]);
        setViolations(computeViolations(nextBoard, puzzle));
        return nextBoard;
      });
      setStatus("");
      setStatusOk(null);
      return newFuture;
    });
  }

  function checkSolution() {
    if (!puzzle) return;
    const { solution } = puzzle;

    let allMatch = true;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const solBerry = solution[r][c] === 1;
        const state = playerBoard[r]?.[c] ?? 0;
        const playerBerry = state === 1;

        if (solBerry !== playerBerry) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) break;
    }

    setViolations(computeViolations(playerBoard, puzzle));

    if (allMatch) {
      if (puzzleSource === "pool" && currentPoolIndex !== null && pool) {
        void markPoolIndexSolved(pool, currentPoolIndex);
      }
      setIsSolved(true);
      setStatus("✅ Correct! Puzzle solved.");
      setStatusOk(true);
    } else {
      setStatus("❌ Not solved yet.");
      setStatusOk(false);
    }
  }

  function toggleShowSolution() {
    setShowSolution((prev) => !prev);
    setStatus("");
    setStatusOk(null);
  }

  function getCellBorderStyle(r: number, c: number) {
    const top = r === 0 ? 2 : r % 3 === 0 ? 2 : 1;
    const left = c === 0 ? 2 : c % 3 === 0 ? 2 : 1;
    const right = c === N - 1 ? 2 : (c + 1) % 3 === 0 ? 2 : 1;
    const bottom = r === N - 1 ? 2 : (r + 1) % 3 === 0 ? 2 : 1;

    return {
      borderTopWidth: top,
      borderLeftWidth: left,
      borderRightWidth: right,
      borderBottomWidth: bottom,
    };
  }

  function renderCell(r: number, c: number) {
    if (!puzzle) return null;

    const clue = puzzle.puzzleClues[r][c];
    const solutionBerry = puzzle.solution[r][c] === 1;
    const state = playerBoard[r]?.[c] ?? 0;

    const blockIndex = Math.floor(r / 3) * 3 + Math.floor(c / 3);
    const isUnitViolated = violations.row[r] || violations.col[c] || violations.block[blockIndex];
    const isClueAreaViolated = violations.clueArea[r]?.[c] ?? false;

    let text = "";

    const cellStyles: StyleProp<ViewStyle>[] = [styles.cell, getCellBorderStyle(r, c)];
    const textStyles: StyleProp<TextStyle>[] = [styles.cellText];

    if (showSolution) {
      if (solutionBerry) {
        text = "●";
        cellStyles.push(styles.cellSolutionBerry);
      } else if (clue !== null) {
        text = String(clue);
        textStyles.push(styles.cellClue);
      }
    } else {
      if (clue !== null) {
        text = String(clue);
        textStyles.push(styles.cellClue);
      } else if (state === 1) {
        text = "●";
        cellStyles.push(styles.cellPlayerBerry);
      } else if (state === -1) {
        text = "×";
        textStyles.push(styles.cellPlayerEmpty);
      }

      if (isUnitViolated) {
        cellStyles.push(styles.cellViolation);
      }
      if (isClueAreaViolated) {
        cellStyles.push(styles.cellClueAreaViolation);
      }
    }

    return (
      <Pressable
        key={`${r}-${c}`}
        style={cellStyles}
        onPress={() => handleCellPress(r, c)}
      >
        <Text style={textStyles}>{text}</Text>
      </Pressable>
    );
  }

  async function handleResetPoolProgress() {
    if (!pool) return;
    setStatus("");
    setStatusOk(null);
  
    try {
      await resetPoolProgress(pool);
  
      // Update UI immediately
      setPoolProgressLoadedCount(0);
  
      setStatus("Pool progress reset.");
      setStatusOk(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus(`Failed to reset pool progress: ${msg}`);
      setStatusOk(false);
    }
  }

  // Pulse animation for Check button
  useEffect(() => {
    if (!readyToCheck) {
      checkPulse.stopAnimation();
      checkPulse.setValue(1);
      return;
    }

    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(checkPulse, {
          toValue: 1.12,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(checkPulse, {
          toValue: 1,
          duration: 220,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(200),
      ]),
    );

    anim.start();

    return () => {
      anim.stop();
      checkPulse.stopAnimation();
      checkPulse.setValue(1);
    };
  }, [readyToCheck, checkPulse]);

  // Autosave current game state (only while on game screen and puzzle exists)
  useEffect(() => {
    if (!puzzle) return;

    scheduleSave({
      v: 1,
      savedAt: Date.now(),
      puzzle,
      playerBoard,
      history,
      future,
      useDense: false, // no longer in UI; keep field for compatibility
    });
  }, [puzzle, playerBoard, history, future]);

  // Load + validate pool once
  useEffect(() => {
    try {
      const validated = validatePoolOrThrow(RAW_POOL_JSON);
      setPool(validated);
      setPoolError(null);
      console.log(`Pool loaded: ${validated.puzzles.length} puzzles`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPool(null);
      setPoolError(msg);
      console.warn("Failed to load puzzle pool:", msg);
    }
  }, []);

  useEffect(() => {
    if (!pool) return;
    (async () => {
      const progress = await loadPoolProgress(pool);
      setPoolProgressLoadedCount(progress.loaded.length);
    })();
  }, [pool]);
  

  const startDisabled = isGenerating;
  const poolDisabled = !poolHasRemaining || startDisabled;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.container}>
        <Text style={styles.title}>Blueberry Puzzle</Text>
        <Text style={styles.subtitle}>3 berries per row, column & block</Text>

        {isGenerating && (
          <View style={styles.generating}>
            <ActivityIndicator size="small" />
            <Text style={styles.generatingText}>Preparing game…</Text>
          </View>
        )}

        {poolError && (
          <Text style={[styles.status, styles.statusError]}>
            Pool load failed; pool buttons disabled. ({poolError})
          </Text>
        )}

        {screen === "start" && (
          <>
            <View style={styles.startWrap}>
              <Text style={styles.startHint}>Choose how to start a new game:</Text>
              {pool && (
                <Text style={styles.startNote}>
                  Pool progress: {poolProgressLoadedCount} / {poolSize} used
                </Text>
              )}

              <Pressable
                style={[styles.buttonWide, poolDisabled && styles.buttonDisabled]}
                onPress={loadNextPuzzleFromPool}
                disabled={poolDisabled}
              >
                <Text style={styles.buttonText}>
                  Next puzzle {pool ? `(${poolRemaining} left)` : "(pool unavailable)"}
                </Text>
              </Pressable>

              {poolAvailable && (
                <Pressable
                  onPress={handleResetPoolProgress}
                  disabled={startDisabled}
                  style={[styles.linkWrap, startDisabled && styles.buttonDisabled]}
                >
                  <Text style={styles.linkText}>Reset pool progress</Text>
                </Pressable>
              )}

              <Pressable
                style={[styles.buttonWide, poolDisabled && styles.buttonDisabled]}
                onPress={loadRandomPuzzleFromPool}
                disabled={poolDisabled}
              >
                <Text style={styles.buttonText}>
                  Random puzzle {pool ? `(${poolRemaining} left)` : "(pool unavailable)"}
                </Text>
              </Pressable>

              <Pressable
                style={[styles.buttonWide, startDisabled && styles.buttonDisabled]}
                onPress={() => generatePuzzle(false)}
                disabled={startDisabled}
              >
                <Text style={styles.buttonText}>Generate puzzle</Text>
              </Pressable>

              <Pressable
                style={[styles.buttonWide, startDisabled && styles.buttonDisabled]}
                onPress={() => generatePuzzle(true)}
                disabled={startDisabled}
              >
                <Text style={styles.buttonText}>Generate puzzle (extra clues)</Text>
              </Pressable>

              <Text style={styles.startNote}>
                Tip: pool puzzles start instantly. Generator may take a while on some devices.
              </Text>
            </View>

            {status !== "" && (
              <Text
                style={[
                  styles.status,
                  statusOk === true ? styles.statusOk : statusOk === false ? styles.statusError : null,
                ]}
              >
                {status}
              </Text>
            )}
          </>
        )}

        {screen === "game" && puzzle && (
          <>
            <View style={styles.grid}>
              {Array.from({ length: N }, (_, r) => (
                <View key={r} style={styles.row}>
                  {Array.from({ length: N }, (_, c) => renderCell(r, c))}
                </View>
              ))}
            </View>

            {/* Row: Check */}
            <View style={styles.checkWrap}>
              <Animated.View style={{ transform: [{ scale: checkPulse }] }}>
                <Pressable
                  style={[styles.button, readyToCheck && styles.buttonCheckReady]}
                  onPress={checkSolution}
                  disabled={isGenerating}
                >
                  <Text style={styles.buttonText}>Check</Text>
                </Pressable>
              </Animated.View>
            </View>

            {/* Row: Undo / Redo / Clear */}
            <View style={styles.buttonsRow}>
              <Pressable
                style={[styles.button, (!canUndo || isGenerating) && styles.buttonDisabled]}
                onPress={undo}
                disabled={!canUndo || isGenerating}
              >
                <Text style={styles.buttonText}>Undo</Text>
              </Pressable>
              <Pressable
                style={[styles.button, (!canRedo || isGenerating) && styles.buttonDisabled]}
                onPress={redo}
                disabled={!canRedo || isGenerating}
              >
                <Text style={styles.buttonText}>Redo</Text>
              </Pressable>
              <Pressable
                style={[styles.button, isGenerating && styles.buttonDisabled]}
                onPress={clearBoard}
                disabled={isGenerating}
              >
                <Text style={styles.buttonText}>Clear</Text>
              </Pressable>
            </View>

            {/* Show / Hide solution */}
            {!isSolved && (
              <Pressable
                style={styles.toggle}
                onPress={toggleShowSolution}
                disabled={isGenerating}
              >
                <Text style={styles.toggleText}>
                  {showSolution ? "Hide solution" : "Show solution"}
                </Text>
              </Pressable>
            )}

            {/* New game */}
            <Pressable
              style={[styles.buttonWide, isGenerating && styles.buttonDisabled]}
              onPress={newGame}
              disabled={isGenerating}
            >
              <Text style={styles.buttonText}>New game</Text>
            </Pressable>

            {status !== "" && (
              <Text
                style={[
                  styles.status,
                  statusOk === true ? styles.statusOk : statusOk === false ? styles.statusError : null,
                ]}
              >
                {status}
              </Text>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  container: {
    flex: 1,
    alignItems: "center",
    paddingTop: 40,
    paddingHorizontal: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: "#555",
    marginBottom: 12,
  },
  startWrap: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    marginTop: 8,
  },
  startHint: {
    fontSize: 14,
    color: "#374151",
    marginBottom: 10,
  },
  startNote: {
    marginTop: 10,
    fontSize: 12,
    color: "#6b7280",
    textAlign: "center",
    maxWidth: 360,
  },
  grid: {
    borderColor: "#000",
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderColor: "#ccc",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  cellText: {
    fontSize: 16,
  },
  cellClue: {
    fontWeight: "600",
    color: "#333",
  },
  cellSolutionBerry: {
    backgroundColor: "#3b82f6",
  },
  cellPlayerBerry: {
    backgroundColor: "#10b981",
  },
  cellPlayerEmpty: {
    color: "#9ca3af",
  },
  cellViolation: {
    borderColor: "#dc2626",
    borderWidth: 2,
  },
  cellClueAreaViolation: {
    backgroundColor: "#fef3c7",
  },
  buttonsRow: {
    flexDirection: "row",
    marginBottom: 8,
    gap: 8,
  },
  button: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  buttonWide: {
    backgroundColor: "#2563eb",
    width: "100%",
    maxWidth: 420,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 8,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  buttonCheckReady: {
    borderWidth: 2,
    borderColor: "#111827",
  },
  toggle: {
    marginBottom: 6,
  },
  toggleText: {
    color: "#2563eb",
    textDecorationLine: "underline",
  },
  status: {
    marginTop: 10,
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 10,
  },
  statusOk: {
    color: "#16a34a",
  },
  statusError: {
    color: "#dc2626",
  },
  generating: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    gap: 8,
  },
  generatingText: {
    marginLeft: 8,
    fontSize: 14,
  },
  checkWrap: {
    marginBottom: 10,
  },
  linkWrap: {
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  linkText: {
    color: "#2563eb",
    textDecorationLine: "underline",
    fontSize: 12,
  },
});