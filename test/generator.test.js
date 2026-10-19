/**
 * 直式乘法：產生器／步驟引擎檢查（純 Node，無相依套件）
 * 執行：npm test  或  node test/generator.test.js
 */
"use strict";

const assert = require("node:assert");
const path = require("node:path");
const Core = require(path.join(__dirname, "..", "mult-core.js"));

const N_PER_TYPE = 1000;
const N_RANDOM_PAIRS = 2000;
let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
  }
}

/**
 * 驗證一組 a×b 的步驟引擎：
 * - 每個步驟的答案是一位數 0–9，fill 與 target 一致
 * - 每格最多被填一次（含加法自動進位）
 * - 被標成虛線（slot）的格，完成時都有數字；有數字的格也都是 slot
 * - 答案列讀回來 == a×b；第一排／第二排數值正確
 */
function verifyPlan(a, b) {
  const built = Core.buildSteps(a, b);
  const { steps, boardPlan, numCols } = built;
  const product = a * b;

  assert.ok(numCols >= String(product).length, `numCols ${numCols} < product length`);
  assert.ok(numCols <= Core.MAX_COLS, `numCols ${numCols} > MAX_COLS`);

  const seen = new Set();
  const fillOnce = (f, where) => {
    const key = `${f.row}-${f.col}`;
    assert.ok(!seen.has(key), `cell ${key} filled twice (${where})`);
    seen.add(key);
    assert.ok(f.col >= 0 && f.col < numCols, `cell ${key} out of range`);
    assert.ok(Core.BOARD_ROWS.includes(f.row), `unknown row ${f.row}`);
    assert.ok(Number.isInteger(f.value) && f.value >= 0 && f.value <= 9, `cell ${key} value ${f.value}`);
  };
  steps.forEach((s, i) => {
    assert.ok(Number.isInteger(s.answer) && s.answer >= 0 && s.answer <= 9, `step ${i} answer ${s.answer}`);
    assert.ok(s.question && s.hint && s.phase && s.prompt, `step ${i} texts present`);
    assert.strictEqual(s.fill.length, 1, `step ${i} fills one cell`);
    assert.deepStrictEqual(
      { row: s.fill[0].row, col: s.fill[0].col },
      s.target,
      `step ${i} fill matches target`
    );
    assert.strictEqual(s.fill[0].value, s.answer, `step ${i} fill value == answer`);
    s.fill.forEach((f) => fillOnce(f, `step ${i}`));
    (s.autoFills || []).forEach((f) => fillOnce(f, `step ${i} auto`));
    // 選項：四個不同的一位數，含正解
    const ch = Core.makeChoices(s.answer, rng);
    assert.strictEqual(new Set(ch).size, 4, "4 distinct choices");
    assert.ok(ch.includes(s.answer) && ch.every((x) => x >= 0 && x <= 9), "choices valid");
  });

  const done = Core.buildCompletedBoard(a, b);
  const board = done.board;
  Core.BOARD_ROWS.forEach((row) => {
    for (let c = 0; c < numCols; c++) {
      const marked = boardPlan.slots[row][c];
      const val = board[row][c];
      if (marked) {
        assert.ok(val !== null, `marked slot ${row}-${c} never filled`);
      } else {
        assert.ok(val === null, `cell ${row}-${c} filled but not marked as slot`);
      }
    }
  });

  const readRow = (row) => board[row].filter((v) => v !== null).join("");
  assert.strictEqual(readRow("answer"), String(product), `answer row "${readRow("answer")}" != ${product}`);
  assert.strictEqual(done.row1Val, a * (b % 10), "row1 value");
  if (done.hasSecond) {
    assert.strictEqual(done.row2Val, a * (Math.floor(b / 10) % 10) * 10, "row2 value");
    assert.strictEqual(done.row1Val + done.row2Val, product, "row1 + row2 == product");
  } else {
    assert.strictEqual(done.row1Val, product, "single row == product");
  }
  return built;
}

const rng = Core.makeRng(20261019);

// ---------- makeRng ----------
check("makeRng is deterministic and in [0,1)", () => {
  const r1 = Core.makeRng(42);
  const r2 = Core.makeRng(42);
  for (let i = 0; i < 1000; i++) {
    const x = r1();
    assert.strictEqual(x, r2());
    assert.ok(x >= 0 && x < 1);
  }
  const g1 = Core.generate(10, { rng: Core.makeRng(7) });
  const g2 = Core.TYPES[10].generate(Core.makeRng(7));
  assert.deepStrictEqual(g1, g2, "generate(i, {rng}) == TYPES[i].generate(rng)");
});

// ---------- 每個題型 1000 題 ----------
const summary = [];
check("12 types", () => assert.strictEqual(Core.TYPES.length, 12));
Core.TYPES.forEach((type, i) => {
  const name = `題型 ${String(i + 1).padStart(2)} ${type.stage}`;
  const distinct = new Set();
  let carryCount = 0;
  check(name, () => {
    assert.strictEqual(type.no, i + 1);
    for (let k = 0; k < N_PER_TYPE; k++) {
      const { a, b } = Core.generate(i, { rng });
      const tag = `${a}×${b}`;
      distinct.add(tag);
      assert.ok(Core.checkType(i, a, b), `${tag} fails checkType(${i})`);
      const cols = Core.colsFor(a, b);
      assert.ok(cols >= String(a * b).length && cols >= String(a).length && cols >= String(b).length,
        `${tag} colsFor ${cols} too narrow`);
      if (Core.hasMultCarry(a, b)) carryCount += 1;
      try {
        verifyPlan(a, b);
      } catch (e) {
        throw new Error(`${tag}: ${e.message}`);
      }
    }
    assert.ok(distinct.size >= 10, `only ${distinct.size} distinct problems`);
    if (type.carry) {
      // 50/50 偏好：兩種都要常常出現
      assert.ok(carryCount > N_PER_TYPE * 0.4 && carryCount < N_PER_TYPE * 0.6,
        `carry mix ${carryCount}/${N_PER_TYPE}`);
    } else {
      assert.strictEqual(carryCount, 0, "carry N/A type never has a 乘進位");
    }
  });
  summary.push(
    `${name.padEnd(24)} distinct=${String(distinct.size).padStart(4)} 乘進位=${
      type.carry ? String(carryCount).padStart(4) : " N/A"
    }`
  );
});

// 指定偏好時要做到（有乘進位的題型）
const prefSummary = [];
Core.TYPES.forEach((type, i) => {
  if (!type.carry) return;
  check(`題型 ${i + 1} carry preference honoured`, () => {
    const N = 300;
    let hitYes = 0;
    let hitNo = 0;
    for (let k = 0; k < N; k++) {
      const y = Core.generate(i, { rng, carry: true });
      const n = Core.generate(i, { rng, carry: false });
      assert.ok(Core.checkType(i, y.a, y.b) && Core.checkType(i, n.a, n.b));
      if (Core.hasMultCarry(y.a, y.b)) hitYes += 1;
      if (!Core.hasMultCarry(n.a, n.b)) hitNo += 1;
    }
    prefSummary.push(`題型 ${String(i + 1).padStart(2)} carry:true ${hitYes}/${N}  carry:false ${hitNo}/${N}`);
    assert.strictEqual(hitYes, N, `carry:true only ${hitYes}/${N}`);
    assert.strictEqual(hitNo, N, `carry:false only ${hitNo}/${N}`);
  });
});

check("carry option ignored for N/A types", () => {
  [0, 3, 4, 5].forEach((i) => {
    assert.ok(!Core.carryApplies(i));
    for (let k = 0; k < 200; k++) {
      const r = Core.generate(i, { rng, carry: true });
      assert.ok(Core.checkType(i, r.a, r.b));
      assert.ok(!Core.hasMultCarry(r.a, r.b));
    }
  });
});

// ---------- 2000 組隨機題（跨題型） ----------
check(`${N_RANDOM_PAIRS} random pairs across types`, () => {
  for (let k = 0; k < N_RANDOM_PAIRS; k++) {
    const i = Math.floor(rng() * Core.TYPES.length);
    const { a, b } = Core.generate(i, { rng });
    try {
      verifyPlan(a, b);
    } catch (e) {
      throw new Error(`type ${i + 1} ${a}×${b}: ${e.message}`);
    }
  }
});

// ---------- 範例題（README 表格） ----------
const EXAMPLES = [
  [1, 3000, 2],
  [2, 1426, 3],
  [3, 2035, 4],
  [4, 8, 20],
  [5, 6, 28],
  [6, 30, 50],
  [7, 12, 13],
  [8, 48, 27],
  [9, 386, 59],
  [10, 203, 45],
  [11, 2345, 67],
  [12, 1005, 23],
];
EXAMPLES.forEach(([no, a, b]) => {
  check(`example 題型 ${no} ${a}×${b}`, () => {
    assert.ok(Core.checkType(no - 1, a, b), `checkType(${no - 1}, ${a}, ${b})`);
    // 範例只屬於自己的題型
    Core.TYPES.forEach((_, j) => {
      if (j !== no - 1) assert.ok(!Core.checkType(j, a, b), `${a}×${b} also matches 題型 ${j + 1}`);
    });
    verifyPlan(a, b);
  });
});

check("fallbacks and examples valid", () => {
  Core.TYPES.forEach((t, i) => {
    assert.ok(Core.checkType(i, t.fallback[0], t.fallback[1]), `fallback 題型 ${i + 1}`);
    assert.ok(Core.checkType(i, t.example[0], t.example[1]), `example 題型 ${i + 1}`);
  });
});

// ---------- 邊界 ----------
check("4a: 題型 10 never whole hundreds", () => {
  for (let h = 1; h <= 9; h++) assert.ok(!Core.checkType(9, h * 100, 45), `${h * 100}×45`);
  assert.ok(Core.checkType(9, 203, 45));
  assert.ok(!Core.checkType(9, 213, 45), "tens must be 0");
});

check("4b: 整千 has no 乘進位 even when d×b ≥ 10", () => {
  assert.strictEqual(Core.hasMultCarry(3000, 4), false);
  const built = Core.buildSteps(3000, 4); // 12000
  assert.strictEqual(built.numCols, 5);
  assert.ok(!built.steps.some((s) => s.kind === "carry"), "no carry step");
  assert.ok(!built.boardPlan.slots.carry1.some(Boolean), "no carry slot");
});

check("checkType rejects other shapes", () => {
  assert.ok(!Core.checkType(0, 3500, 2), "3500 not 整千");
  assert.ok(!Core.checkType(0, 3000, 1), "×1 not allowed");
  assert.ok(!Core.checkType(1, 1026, 3), "1026 has middle 0");
  assert.ok(!Core.checkType(2, 3000, 3), "整千 not 題型 3");
  assert.ok(!Core.checkType(4, 6, 20), "整十 multiplier not 題型 5");
  assert.ok(!Core.checkType(6, 48, 27), "1296 not 3-digit product");
  assert.ok(!Core.checkType(7, 12, 13), "156 not 4-digit product");
  assert.ok(!Core.checkType(8, 305, 45), "305 has middle 0");
  assert.ok(!Core.checkType(11, 2000, 23), "整千 not 題型 12");
  assert.ok(!Core.checkType(12, 1, 1), "unknown index");
});

// ---------- 指定題目 ----------
const FIXED = [
  [48, 27], [2035, 4], [1005, 23], [3000, 2], [8, 20],
  [30, 50], [6, 28], [12, 13], [203, 45], [2345, 67],
];
FIXED.forEach(([a, b]) => {
  check(`fixed ${a}×${b}`, () => verifyPlan(a, b));
});

check("48×27: 12 steps, answer 1296", () => {
  const built = Core.buildSteps(48, 27);
  assert.strictEqual(built.steps.length, 12);
  assert.deepStrictEqual(Core.buildCompletedBoard(48, 27).board.answer, [1, 2, 9, 6]);
  assert.strictEqual(Core.colsFor(2345, 67), 6);
});

// 第 5 點：舊版會把 row1 col1、row2 col0、addCarry col0/1 一律標成虛線
check("12×13: no phantom dashed cells", () => {
  const s = Core.buildSteps(12, 13).boardPlan.slots;
  assert.deepStrictEqual(s.row1, [false, false, true, true]); // 36
  assert.deepStrictEqual(s.row2, [false, true, true, true]); // 120
  assert.deepStrictEqual(s.addCarry, [false, false, false, false]);
  assert.deepStrictEqual(s.answer, [false, true, true, true]); // 156
});

// ---------- 結果 ----------
console.log("直式乘法 generator test");
console.log(summary.map((s) => "  " + s).join("\n"));
console.log(prefSummary.map((s) => "  " + s).join("\n"));
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:\n  " + failures.join("\n  "));
  process.exit(1);
}
