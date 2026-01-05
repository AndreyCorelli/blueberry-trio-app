#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { makePuzzle, N } from "../src/core/blueberryCore";

// ---------- CLI parsing ----------

type Args = {
  count: number;
  dense: boolean;
  outPath: string;
  sort: boolean;
};


function parseArgs(argv: string[]): Args {
  let count = 1;
  let dense = false;
  let outPath = "assets/pool/puzzlePool.v1.json";
  let sort = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--count" || a === "-n") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --count");
      count = Number(v);
      if (!Number.isFinite(count) || count <= 0) {
        throw new Error(`Invalid --count: ${v}`);
      }
      i++;
    } else if (a === "--dense" || a === "--more-clues") {
      dense = true;
    } else if (a === "--out" || a === "-o") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --out");
      outPath = v;
      i++;
    } else if (a === "--sort") {
      sort = true;
    } else if (a === "--help" || a === "-h") {
      printHelpAndExit();
    }
  }

  return { count, dense, outPath, sort };
}

function printHelpAndExit(): never {
  console.log(`
Generate and maintain a pool of Blueberry puzzles.

Generate / append:
  npm run pool:gen -- --count 300 [--dense] [--out <path>]

Sort existing pool in-place:
  npm run pool:sort -- [--out <path>]

Options:
  --count, -n        Number of puzzles to generate (required for generation)
  --dense            Use "more clues" mode
  --out, -o          Output JSON file path (default: assets/pool/puzzlePool.v1.json)
  --sort             Sort pool by score and save back
`);
  process.exit(0);
}

// ---------- Pool format ----------

type PuzzleEntryV1 = {
  genSeconds: number;  // duration to generate (rough complexity proxy)
  humanComplex: number; // default 0
  clues81: number[];    // length 81; -1 = empty cell; 0..8 = clue value
};

type PuzzlePoolV1 = {
  version: 1;
  N: number; // 9
  generatedAtUtc: string;
  dense: boolean;
  puzzles: PuzzleEntryV1[];
};

// ---------- Encoding helpers ----------

function encodeCluesTo81(puzzleClues: (number | null)[][]): number[] {
  const out: number[] = new Array(N * N);
  let k = 0;
  for (let r = 0; r < N; r++) {
    const row = puzzleClues[r];
    for (let c = 0; c < N; c++) {
      const v = row[c];
      out[k++] = v === null ? -1 : v;
    }
  }
  return out;
}

function validateClues81(arr: number[]): void {
  if (arr.length !== N * N) throw new Error(`clues81 must be length ${N * N}`);
  for (const v of arr) {
    if (v !== -1 && !(Number.isInteger(v) && v >= 0 && v <= 8)) {
      throw new Error(`Invalid clues81 value: ${v}`);
    }
  }
}

// ---------- File IO ----------

function ensureDirForFile(filePath: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function readPoolIfExists(filePath: string, dense: boolean): PuzzlePoolV1 {
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      N,
      generatedAtUtc: new Date().toISOString(),
      dense,
      puzzles: [],
    };
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as PuzzlePoolV1;

  // minimal sanity checks
  if (parsed.version !== 1) throw new Error(`Unsupported pool version: ${parsed.version}`);
  if (parsed.N !== N) throw new Error(`Pool N mismatch: file=${parsed.N}, code=${N}`);

  if (!Array.isArray(parsed.puzzles)) throw new Error("Pool puzzles must be an array");
  return parsed;
}

function writePoolAtomic(filePath: string, pool: PuzzlePoolV1): void {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(pool, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

// ---------- Main ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, "..");

  const outFile = path.resolve(projectRoot, args.outPath);
  ensureDirForFile(outFile);

  const pool = readPoolIfExists(outFile, args.dense);

  if (args.sort) {
    // eslint-disable-next-line no-console
    console.log(`Sorting pool in: ${args.outPath}`);
    // eslint-disable-next-line no-console
    console.log(`Pool size: ${pool.puzzles.length}`);

    sortPoolInPlace(pool);
    pool.generatedAtUtc = new Date().toISOString(); // optional, but nice metadata signal
    writePoolAtomic(outFile, pool);

    // eslint-disable-next-line no-console
    console.log("Done.");
    return;
  }

  // Resolve project root relative to this script file  // Handle Ctrl+C gracefully: write what we have so far.
  let interrupted = false;
  process.on("SIGINT", () => {
    interrupted = true;
    // eslint-disable-next-line no-console
    console.log("\nSIGINT received. Saving progress and exiting...");
  });

  // eslint-disable-next-line no-console
  console.log(`Appending ${args.count} puzzle(s) to: ${args.outPath}`);
  // eslint-disable-next-line no-console
  console.log(`Mode: ${args.dense ? "dense (more clues)" : "default"}`);
  // eslint-disable-next-line no-console
  console.log(`Already in pool: ${pool.puzzles.length}`);

  for (let i = 0; i < args.count; i++) {
    if (interrupted) break;

    const t0 = performance.now();
    const p = makePuzzle({ dense: args.dense });
    const t1 = performance.now();

    const genSeconds = (t1 - t0) / 1000;
    const clues81 = encodeCluesTo81(p.puzzleClues);
    validateClues81(clues81);

    const entry: PuzzleEntryV1 = {
      genSeconds: Number(genSeconds.toFixed(3)),
      humanComplex: args.dense ? 100 : 200,
      clues81,
    };

    pool.puzzles.push(entry);

    // Write incrementally each time so you can run it “in the background”
    // and not lose progress if it crashes midway.
    pool.generatedAtUtc = new Date().toISOString();
    writePoolAtomic(outFile, pool);

    // eslint-disable-next-line no-console
    console.log(
      `#${pool.puzzles.length} generated in ${entry.genSeconds}s (this run ${i + 1}/${args.count})`
    );
  }

  // eslint-disable-next-line no-console
  console.log(`Done. Pool size: ${pool.puzzles.length}`);
}

function score(entry: { humanComplex: number; genSeconds: number }): number {
  // Sort criteria:
  // humanComplex + 100 * sqrt(genSeconds)
  return entry.humanComplex + 100 * Math.sqrt(Math.max(0, entry.genSeconds));
}

function sortPoolInPlace(pool: PuzzlePoolV1): void {
  // stable sort: keep original order for equal scores
  const withIndex = pool.puzzles.map((p, i) => ({ p, i, s: score(p) }));
  withIndex.sort((a, b) => (a.s - b.s) || (a.i - b.i));
  pool.puzzles = withIndex.map((x) => x.p);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
