import React, { useEffect, useState } from "react";
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
import { makePuzzle, N } from "./src/core/blueberryCore";
import type { Puzzle } from "./src/core/blueberryCore";
import { computeClueAreaViolations } from "./src/core/clueCheck";
import { loadSavedGame, scheduleSave, clearSavedGame } from "./src/core/gameSave";


type PlayerCellState = -1 | 0 | 1; // -1 = marked empty, 0 = unknown, 1 = berry

type Violations = {
  row: boolean[];
  col: boolean[];
  block: boolean[];
  clueArea: boolean[][];
};

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

export default function App() {
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [playerBoard, setPlayerBoard] = useState<PlayerCellState[][]>([]);
  const [showSolution, setShowSolution] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [statusOk, setStatusOk] = useState<boolean | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [useDense, setUseDense] = useState(false); // "optimized clues" mode
  const [violations, setViolations] = useState<Violations>({
    row: new Array<boolean>(N).fill(false),
    col: new Array<boolean>(N).fill(false),
    block: new Array<boolean>(N).fill(false),
    clueArea: Array.from({ length: N }, () =>
      new Array<boolean>(N).fill(false),
    ),
  });
  const [history, setHistory] = useState<PlayerCellState[][][]>([]);
  const [future, setFuture] = useState<PlayerCellState[][][]>([]);

  const canUndo = history.length > 0;
  const canRedo = future.length > 0;
  const totalBerries = playerBoard.reduce(
    (acc, row) => acc + row.filter((v) => v === 1).length,
    0,
  );
  
  const readyToCheck =
  !!puzzle && !showSolution && totalBerries === TOTAL_BERRIES_REQUIRED;
  const checkPulse = React.useRef(new Animated.Value(1)).current;
  const [isHydrating, setIsHydrating] = useState(true);
  const didHydrateRef = React.useRef(false);

  function createEmptyPlayerBoard(): PlayerCellState[][] {
    return Array.from({ length: N }, () =>
      new Array<PlayerCellState>(N).fill(0),
    );
  }

  function generateNewPuzzle() {
    setIsGenerating(true);
    setStatus("");
    setStatusOk(null);
    setShowSolution(false);

    setTimeout(() => {
      console.log("Generating puzzle...");
      const p = makePuzzle({ dense: useDense });
      console.log("Puzzle generated");
      setPuzzle(p);
      const empty = createEmptyPlayerBoard();
      setPlayerBoard(empty);
      setViolations(computeViolations(empty, p));
      setHistory([]);
      setFuture([]);
      setIsGenerating(false);
    }, 0);
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
      if (puzzle) {
        setViolations(computeViolations(nextBoard, puzzle));
      }

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
    const right =
      c === N - 1 ? 2 : (c + 1) % 3 === 0 ? 2 : 1;
    const bottom =
      r === N - 1 ? 2 : (r + 1) % 3 === 0 ? 2 : 1;

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
    const isUnitViolated =
      violations.row[r] || violations.col[c] || violations.block[blockIndex];
    const isClueAreaViolated = violations.clueArea[r]?.[c] ?? false;
  
    let text = "";
  
    const cellStyles: StyleProp<ViewStyle>[] = [
      styles.cell,
      getCellBorderStyle(r, c),
    ];
  
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

  useEffect(() => {
    let alive = true;
  
    (async () => {
      try {
        const saved = await loadSavedGame(N);
        if (!alive) return;
  
        if (saved) {
          setPuzzle(saved.puzzle);
          setPlayerBoard(saved.playerBoard);
          setHistory(saved.history);
          setFuture(saved.future);
          setUseDense(saved.useDense);
          setShowSolution(false);
          setStatus("");
          setStatusOk(null);
  
          setViolations(computeViolations(saved.playerBoard, saved.puzzle));
        }
      } finally {
        if (!alive) return;
        didHydrateRef.current = true;
        setIsHydrating(false);
      }
    })();
  
    return () => {
      alive = false;
    };
  }, []);
  
  useEffect(() => {
    if (!didHydrateRef.current) return;
    if (!puzzle) return;
  
    scheduleSave({
      v: 1,
      savedAt: Date.now(),
      puzzle,
      playerBoard,
      history,
      future,
      useDense,
    });
  }, [puzzle, playerBoard, history, future, useDense]);
  

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        <Text style={styles.title}>Blueberry Puzzle</Text>
        <Text style={styles.subtitle}>3 berries per row, column & block</Text>

        {!puzzle && !isGenerating && !isHydrating && (
          <Text style={styles.hint}>
            Press <Text style={styles.bold}>Generate puzzle</Text> to start.
          </Text>
        )}

        {isGenerating && (
          <View style={styles.generating}>
            <ActivityIndicator size="small" />
            <Text style={styles.generatingText}>Generating puzzle…</Text>
          </View>
        )}

        {isHydrating && (
          <View style={styles.generating}>
            <ActivityIndicator size="small" />
            <Text style={styles.generatingText}>Loading saved game…</Text>
          </View>
        )}

        {puzzle && (
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
                  disabled={isGenerating || isHydrating}
                >
                  <Text style={styles.buttonText}>Check</Text>
                </Pressable>
              </Animated.View>
            </View>

            {/* Row: Undo / Redo / Clear */}
            <View style={styles.buttonsRow}>
              <Pressable
                style={[
                  styles.button,
                  (!canUndo || isGenerating) && styles.buttonDisabled,
                ]}
                onPress={undo}
                disabled={!canUndo || isGenerating}
              >
                <Text style={styles.buttonText}>Undo</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.button,
                  (!canRedo || isGenerating) && styles.buttonDisabled,
                ]}
                onPress={redo}
                disabled={!canRedo || isGenerating}
              >
                <Text style={styles.buttonText}>Redo</Text>
              </Pressable>
              <Pressable
                style={[styles.button, isGenerating && styles.buttonDisabled]}
                onPress={clearBoard}
                disabled={isGenerating || isHydrating}
              >
                <Text style={styles.buttonText}>Clear</Text>
              </Pressable>
            </View>

            {/* Show / Hide solution */}
            <Pressable
              style={styles.toggle}
              onPress={toggleShowSolution}
              disabled={isGenerating || isHydrating}
            >
              <Text style={styles.toggleText}>
                {showSolution ? "Hide solution" : "Show solution"}
              </Text>
            </Pressable>
          </>
        )}

        {/* Optimized / dense clues toggle */}
        <View style={styles.difficultyWrap}>
          <Text style={styles.difficultyLabel}>Next puzzle difficulty</Text>

          <View style={styles.difficultyRow}>
            <Pressable
              style={[
                styles.difficultyPill,
                !useDense && styles.difficultyPillActive,
              ]}
              onPress={() => setUseDense(false)}
              disabled={isGenerating || isHydrating}
            >
              <Text
                style={[
                  styles.difficultyPillText,
                  !useDense && styles.difficultyPillTextActive,
                ]}
              >
                HIGH
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.difficultyPill,
                useDense && styles.difficultyPillActive,
              ]}
              onPress={() => setUseDense(true)}
              disabled={isGenerating || isHydrating}
            >
              <Text
                style={[
                  styles.difficultyPillText,
                  useDense && styles.difficultyPillTextActive,
                ]}
              >
                More Clues
              </Text>
            </Pressable>
          </View>
        </View>


        {/* Big generate button */}
        <Pressable
          style={[styles.buttonWide, isGenerating && styles.buttonDisabled]}
          onPress={generateNewPuzzle}
          disabled={isGenerating || isHydrating}
        >
          <Text style={styles.buttonText}>
            {puzzle ? "Generate another puzzle" : "Generate puzzle"}
          </Text>
        </Pressable>

        {status !== "" && (
          <Text
            style={[
              styles.status,
              statusOk === true
                ? styles.statusOk
                : statusOk === false
                ? styles.statusError
                : null,
            ]}
          >
            {status}
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

const CELL_SIZE = 32;
const TOTAL_BERRIES_REQUIRED = 27;

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  container: {
    flex: 1,
    alignItems: "center",
    paddingTop: 40, // moved down out of notch/camera area
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
  hint: {
    fontSize: 14,
    marginBottom: 10,
    color: "#555",
  },
  bold: {
    fontWeight: "700",
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
    backgroundColor: "#fef3c7", // light amber
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
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
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
    marginBottom: 4,
  },
  toggleText: {
    color: "#2563eb",
    textDecorationLine: "underline",
  },
  toggleSmall: {
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  toggleTextSmall: {
    fontSize: 12,
    color: "#374151",
  },
  status: {
    marginTop: 6,
    fontSize: 14,
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
    marginBottom: 12,
    gap: 8,
  },
  generatingText: {
    marginLeft: 8,
    fontSize: 14,
  },
  difficultyWrap: {
    marginTop: 6,
    marginBottom: 6,
    alignItems: "center",
  },
  difficultyLabel: {
    fontSize: 12,
    color: "#374151",
    marginBottom: 6,
  },
  difficultyRow: {
    flexDirection: "row",
    gap: 8,
  },
  difficultyPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#9ca3af",
    backgroundColor: "#fff",
  },
  difficultyPillActive: {
    borderColor: "#111827",
    borderWidth: 2,
  },
  difficultyPillText: {
    fontSize: 12,
    color: "#374151",
    fontWeight: "600",
  },
  difficultyPillTextActive: {
    color: "#111827",
  },
  checkWrap: {
    marginBottom: 10, // reserved spacing so pulse never overlaps Undo/Redo/Clear
  },
});
