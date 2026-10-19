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
const numTokens = (s) => s.match(/\d+/g) || [];

/** 每步的題目／三層提示／選項 */
function verifyStepTexts(s, i) {
  assert.ok(s.question && s.phase && s.prompt && s.reveal, `step ${i} texts present`);
  assert.ok(Array.isArray(s.hints) && s.hints.length === Core.HINT_LEVELS, `step ${i} has 3 hint levels`);
  s.hints.forEach((h, k) => assert.ok(typeof h === "string" && h.length > 0, `step ${i} hint ${k + 1} empty`));
  const [h1, h2, h3] = s.hints;
  // 第 1 層只講概念：完全不出現數字（所以一定不含乘積／和、也不含答案）
  assert.ok(!/[0-9]/.test(h1), `step ${i} hint 1 has a number: ${h1}`);
  // 第 2 層可以有算式，但不能說「寫 n」
  assert.ok(!/寫\s*\d/.test(h2), `step ${i} hint 2 tells the answer: ${h2}`);
  // 第 3 層才說寫幾
  assert.ok(h3.includes(`寫 ${s.answer}`) || h3.includes(`進位 ${s.answer} 寫在上方小格`),
    `step ${i} hint 3 lacks answer: ${h3}`);
  // 題目不能先把乘積／和說出來
  const c = s.calc;
  assert.ok(c, `step ${i} has calc`);
  if (c.op === "mul" || c.op === "add") {
    const value = c.op === "mul" ? c.d * c.m + c.carryIn : c.d1 + c.d2 + c.carryIn;
    if (value >= 10) {
      assert.ok(!numTokens(s.question).includes(String(value)), `step ${i} question reveals ${value}: ${s.question}`);
    }
    assert.ok(s.reveal.includes(String(value)), `step ${i} reveal shows ${value} after answering`);
  } else {
    assert.strictEqual(c.op, "zero");
    assert.strictEqual(s.answer, 0);
    assert.ok(!/[0-9]/.test(s.question), `step ${i} pad-zero question has a number`);
  }
  // 選項：四個不同的一位數，含正解；同種子結果相同；錯因只對應錯的選項
  const ch = Core.buildChoices(s, Core.makeRng(i + 1));
  assert.deepStrictEqual(ch, Core.buildChoices(s, Core.makeRng(i + 1)), "choices deterministic per seed");
  assert.strictEqual(ch.values.length, 4, "4 choices");
  assert.strictEqual(new Set(ch.values).size, 4, "4 distinct choices");
  assert.ok(ch.values.includes(s.answer), "choices include answer");
  assert.ok(ch.values.every((x) => Number.isInteger(x) && x >= 0 && x <= 9), "choices are digits");
  Object.keys(ch.why).forEach((k) => {
    const v = Number(k);
    assert.ok(v !== s.answer && ch.values.includes(v), `why[${k}] not a wrong choice`);
  });
}

function verifyPlan(a, b) {
  const built = Core.buildSteps(a, b);
  const { steps, boardPlan, numCols } = built;
  const product = a * b;
  const visible = boardPlan.visibleRows;
  assert.ok(Array.isArray(visible) && visible.includes("answer"), "visibleRows has answer");
  if (built.mode !== "two-row") {
    ["row1", "row2", "addCarry", "carry2"].forEach((r) => assert.ok(!visible.includes(r), `${r} hidden`));
  }
  Core.BOARD_ROWS.forEach((row) => {
    if (!visible.includes(row)) {
      assert.ok(!boardPlan.slots[row].some(Boolean), `slot in hidden row ${row}`);
    }
  });
  assert.ok(steps.filter((s) => s.tip).length <= 1, "carry tip shown at most once per card");
  steps.forEach((s, i) => {
    assert.ok(visible.includes(s.target.row), `step ${i} targets hidden row ${s.target.row}`);
    assert.strictEqual((s.autoFills || []).length, 0, `step ${i} has no auto fills (student taps every cell)`);
    verifyStepTexts(s, i);
  });

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
    assert.strictEqual(s.fill.length, 1, `step ${i} fills one cell`);
    assert.deepStrictEqual(
      { row: s.fill[0].row, col: s.fill[0].col },
      s.target,
      `step ${i} fill matches target`
    );
    assert.strictEqual(s.fill[0].value, s.answer, `step ${i} fill value == answer`);
    s.fill.forEach((f) => fillOnce(f, `step ${i}`));
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
  if (done.hasSecond) {
    assert.strictEqual(done.row1Val, a * (b % 10), "row1 value");
    assert.strictEqual(done.row2Val, a * (Math.floor(b / 10) % 10) * 10, "row2 value");
    assert.strictEqual(done.row1Val + done.row2Val, product, "row1 + row2 == product");
    assert.strictEqual(built.mode, "two-row");
  } else {
    assert.strictEqual(done.row1Val, product, "single row == product");
    assert.ok(!steps.some((s) => s.kind === "add" || s.kind === "add-carry"), "no addition steps");
  }
  // 每個進位格都有學生點選的步驟
  ["carry1", "carry2", "addCarry"].forEach((row) => {
    const cells = boardPlan.slots[row].filter(Boolean).length;
    const carrySteps = steps.filter((s) => s.target.row === row).length;
    assert.strictEqual(carrySteps, cells, `${row}: every carry cell is a step`);
  });
  if (built.mode === "shortcut") {
    const zeros = String(a).match(/0*$/)[0].length + String(b).match(/0*$/)[0].length;
    assert.ok(steps.length <= 2 + zeros, `shortcut ${a}×${b} has ${steps.length} steps`);
    assert.strictEqual(steps.filter((s) => s.kind === "pad-zero").length, zeros, "one step per 補0");
    assert.ok(!steps.some((s) => s.calc.op === "mul" && (s.calc.d === 0 || s.calc.m === 0)), "no 0× steps");
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

check("48×27: 13 steps (incl. tapped addition carry), answer 1296", () => {
  const built = Core.buildSteps(48, 27);
  assert.strictEqual(built.steps.length, 13);
  assert.deepStrictEqual(
    built.steps.map((s) => s.kind),
    ["ones-row", "carry", "ones-row", "ones-row", "tens-row", "carry", "tens-row", "pad-zero",
      "add", "add", "add", "add-carry", "add"]
  );
  assert.deepStrictEqual(Core.buildCompletedBoard(48, 27).board.answer, [1, 2, 9, 6]);
  assert.deepStrictEqual(Core.buildCompletedBoard(48, 27).board.addCarry, [1, null, null, null]);
  assert.strictEqual(Core.colsFor(2345, 67), 6);
});

// ---------- 題目不先給答案 ----------
check("questions hide the product (48×27)", () => {
  const s = Core.buildSteps(48, 27).steps;
  assert.strictEqual(s[0].question, "8 × 7 = ?，個位寫幾？");
  assert.strictEqual(s[2].question, "4 × 7 + 進位 5 = ?，十位寫幾？");
  assert.ok(!s[2].question.includes("33"));
  assert.ok(s[2].hints[1].includes("28 + 5 = 33"), "level 2 shows the computation");
  assert.ok(!s[2].hints[0].includes("33") && !s[2].hints[0].includes("5"), "level 1 is concept only");
  assert.ok(s[2].hints[0].includes("進位"), "level 1 reminds the carry");
  assert.strictEqual(s[2].hints[2], "33 的個位是 3，十位寫 3。");
  assert.ok(s[7].hints.join("").includes("幾個十") && s[7].hints[2].includes("也可以省略不寫"), "pad-zero hint");
});

// ---------- 常見錯誤誘答 ----------
function choiceFor(a, b, idx, seed) {
  const step = Core.buildSteps(a, b).steps[idx];
  return { step, ch: Core.buildChoices(step, Core.makeRng(seed || 1)) };
}

check("distractors: forgot carry / tens digit / carry twice", () => {
  // 4 × 7 + 進位 5 = 33 → 正解 3；忘了進位 28 → 8；進位加兩次 38 → 8（同值）
  let { ch } = choiceFor(48, 27, 2);
  assert.ok(ch.values.includes(8) && /忘了加進位 5/.test(ch.why[8]), JSON.stringify(ch));
  // 8 × 7 = 56 → 正解 6；寫成十位 5
  ({ ch } = choiceFor(48, 27, 0));
  assert.ok(ch.values.includes(5) && /十位/.test(ch.why[5]), JSON.stringify(ch));
  // 進位步驟：寫成個位 6
  ({ ch } = choiceFor(48, 27, 1));
  assert.ok(ch.values.includes(6) && /個位/.test(ch.why[6]), JSON.stringify(ch));
  // 2 × 3 + 進位 1 = 7（1426×3）：忘了進位 6、進位加兩次 8
  ({ ch } = choiceFor(1426, 3, 2));
  assert.ok(ch.values.includes(6) && ch.values.includes(8), JSON.stringify(ch));
  assert.ok(/一次/.test(ch.why[8]), "carry-twice feedback");
  // 加法進位步驟：0（忘了進位）
  ({ ch } = choiceFor(48, 27, 11));
  assert.ok(ch.values.includes(0) && /進位/.test(ch.why[0]), JSON.stringify(ch));
});

check("distractors: ±1 / 9−x only as fillers", () => {
  // 4 × 7 + 5：錯誤候選夠多時不需要補數
  const step = Core.buildSteps(48, 27).steps[2];
  const errs = new Set(Core.errorCandidates(step).map((e) => e.value).filter((v) => v !== step.answer));
  assert.ok(errs.size >= 3);
  const ch = Core.buildChoices(step, Core.makeRng(3));
  ch.values.filter((v) => v !== step.answer).forEach((v) => assert.ok(errs.has(v), `${v} is a filler`));
  // 數字本身也可以（只有補數）
  const plain = Core.makeChoices(4, Core.makeRng(5));
  assert.strictEqual(new Set(plain).size, 4);
  assert.ok(plain.includes(4));
});

check("buildChoices deterministic and valid for every answer 0–9", () => {
  for (let d = 0; d <= 9; d++) {
    for (let seed = 1; seed < 30; seed++) {
      const x = Core.buildChoices(d, Core.makeRng(seed));
      assert.deepStrictEqual(x, Core.buildChoices(d, Core.makeRng(seed)));
      assert.strictEqual(new Set(x.values).size, 4);
      assert.ok(x.values.includes(d));
    }
  }
});

// ---------- 進位一致（不提紙／手指；只提示一次） ----------
check("carry tip: no paper/fingers, once per card", () => {
  assert.ok(!/紙|手指/.test(Core.CARRY_TIP));
  assert.ok(Core.CARRY_TIP.includes("上方小格"));
  const steps = Core.buildSteps(48, 27).steps;
  const tips = steps.filter((s) => s.tip);
  assert.strictEqual(tips.length, 1);
  assert.strictEqual(tips[0].kind, "carry");
  steps.forEach((s) => {
    [s.question, s.reveal, ...s.hints].forEach((t) => assert.ok(!/紙|手指/.test(t), t));
  });
  const carryHints = steps.filter((s) => s.kind === "carry" || s.kind === "add-carry");
  carryHints.forEach((s) => assert.ok(s.hints[2].includes(`進位 ${s.answer} 寫在上方小格`), s.hints[2]));
});

// ---------- 整十捷徑（教冊：先乘非 0 數字，再補 0） ----------
check("8×20 shortcut: 8×2=16 個十, then 補 1 個 0", () => {
  const built = Core.buildSteps(8, 20);
  assert.strictEqual(built.mode, "shortcut");
  assert.deepStrictEqual(built.steps.map((s) => s.answer), [6, 1, 0]);
  assert.deepStrictEqual(built.steps.map((s) => s.kind), ["shortcut", "shortcut", "pad-zero"]);
  assert.strictEqual(built.steps[0].question, "8 × 2 = ?，十位寫幾？");
  assert.ok(built.steps[0].hints[1].includes("16 個十"));
  assert.deepStrictEqual(built.boardPlan.visibleRows, ["multiplicand", "multiplier", "answer"]);
  assert.deepStrictEqual(Core.buildCompletedBoard(8, 20).board.answer, [null, 1, 6, 0]);
});

check("30×50 shortcut: 3×5=15 個百, then 補 2 個 0", () => {
  const built = Core.buildSteps(30, 50);
  assert.strictEqual(built.mode, "shortcut");
  assert.deepStrictEqual(built.steps.map((s) => s.answer), [5, 1, 0, 0]);
  assert.deepStrictEqual(built.steps.map((s) => s.target.col), [1, 0, 2, 3]);
  assert.ok(built.steps[0].hints[1].includes("15 個百"));
  assert.ok(built.steps[3].hints[2].includes("2 個 0"));
  assert.deepStrictEqual(Core.buildCompletedBoard(30, 50).board.answer, [1, 5, 0, 0]);
});

check("shortcut: small products and every 題型 4／6 pair", () => {
  assert.deepStrictEqual(Core.buildSteps(3, 20).steps.map((s) => s.answer), [6, 0]); // 60
  assert.deepStrictEqual(Core.buildSteps(20, 40).steps.map((s) => s.answer), [8, 0, 0]); // 800
  for (let d = 2; d <= 9; d++) {
    for (let t = 1; t <= 9; t++) {
      [[d, t * 10], [d * 10, t * 10]].forEach(([a, b]) => {
        const built = verifyPlan(a, b);
        assert.strictEqual(built.mode, "shortcut", `${a}×${b}`);
      });
    }
  }
  assert.strictEqual(Core.boardMode(6, 28), "two-row", "一位×二位 keeps full flow");
  assert.strictEqual(Core.boardMode(48, 27), "two-row");
  assert.strictEqual(Core.boardMode(1426, 3), "one-row");
});

check("3000×2 shortcut: 3×2=6 個千, then 補 3 個 0", () => {
  const built = Core.buildSteps(3000, 2);
  assert.strictEqual(built.mode, "shortcut");
  assert.deepStrictEqual(built.steps.map((s) => s.answer), [6, 0, 0, 0]);
  assert.deepStrictEqual(built.steps.map((s) => s.kind), ["shortcut", "pad-zero", "pad-zero", "pad-zero"]);
  assert.strictEqual(built.steps[0].question, "3 × 2 = ?，千位寫幾？");
  assert.ok(built.steps[0].hints[0].includes("整千") && built.steps[0].hints[0].includes("幾個千"));
  assert.ok(built.steps[0].hints[1].includes("6 個千"));
  assert.ok(built.steps[3].hints[2].includes("被乘數後面的 3 個 0"));
  assert.deepStrictEqual(Core.buildCompletedBoard(3000, 2).board.answer, [6, 0, 0, 0]);
});

check("7000×8 shortcut: 7×8=56 個千 → 56000", () => {
  const built = Core.buildSteps(7000, 8);
  assert.strictEqual(built.numCols, 5);
  assert.deepStrictEqual(built.steps.map((s) => s.answer), [6, 5, 0, 0, 0]);
  assert.deepStrictEqual(built.steps.map((s) => s.target.col), [1, 0, 2, 3, 4]);
  assert.strictEqual(built.steps[1].question, "7 × 8 = ?，萬位寫幾？");
  assert.deepStrictEqual(Core.buildCompletedBoard(7000, 8).board.answer, [5, 6, 0, 0, 0]);
});

check("題型 1: every 整千×一位 pair uses the shortcut, no 0× steps", () => {
  for (let d = 1; d <= 9; d++) {
    for (let m = 2; m <= 9; m++) {
      const built = verifyPlan(d * 1000, m);
      assert.strictEqual(built.mode, "shortcut", `${d * 1000}×${m}`);
      assert.ok(built.steps.every((s) => s.calc.op === "zero" || (s.calc.d === d && s.calc.m === m)));
      assert.deepStrictEqual(built.boardPlan.visibleRows, ["multiplicand", "multiplier", "answer"]);
    }
  }
  assert.strictEqual(Core.boardMode(3500, 2), "one-row", "not 整千 → full flow");
  assert.strictEqual(Core.boardMode(1005, 3), "one-row");
});

// ---------- 乘數一位：只有一排（答案列），不顯示第二排／加法進位 ----------
check("one-digit multiplier: single answer row, no addition", () => {
  [[1426, 3], [2035, 4], [3500, 2]].forEach(([a, b]) => {
    const built = Core.buildSteps(a, b);
    assert.strictEqual(built.mode, "one-row");
    assert.ok(built.steps.every((s) => s.target.row === "answer" || s.target.row === "carry1"));
  });
  assert.deepStrictEqual(Core.buildSteps(1426, 3).boardPlan.visibleRows,
    ["carry1", "multiplicand", "multiplier", "answer"]);
  // 被乘數有兩個以上非 0 數字（如 3500）才可能有乘進位 → 才畫進位列
  assert.deepStrictEqual(Core.buildSteps(3500, 2).boardPlan.visibleRows,
    ["carry1", "multiplicand", "multiplier", "answer"]);
  // 一位×二位：被乘數一位，乘進位列不畫，但要相加
  assert.deepStrictEqual(Core.buildSteps(6, 28).boardPlan.visibleRows,
    ["multiplicand", "multiplier", "row1", "row2", "addCarry", "answer"]);
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
