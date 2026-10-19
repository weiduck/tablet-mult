/**
 * 直式乘法練習：純邏輯（不碰 DOM）
 * - 12 題型（康軒數學4上 第02單元「整數的乘法」N-4-2）約束 checkType、隨機出題 generate
 * - 步驟引擎 buildSteps（題目不先給乘積、每步三層提示 hints[0..2]）、完成板 buildCompletedBoard
 * - 選項 buildChoices：正解＋常見錯誤（忘了進位、寫成十位…）當誘答，附錯因回饋
 * - UMD：瀏覽器 → window.MultCore（舊名 window.MuseMult 為同一物件）；Node → require('./mult-core.js')
 * - 所有隨機都走 rng()（預設 Math.random）；可用 makeRng(seed) 取得可重現的亂數
 *
 * 題型索引：generate(i)、checkType(i, a, b)、TYPES[i] 的 i 從 0 起算；
 * README 的「題型 N」＝ TYPES[N - 1]（TYPES[i].no === i + 1）。
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MultCore = factory();
    root.MuseMult = root.MultCore; // 舊名相容（README 快速檢查）
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** 由左到右完整位名（右端為個位）；實際板寬取尾端 numCols 個 */
  const PLACE_ALL = ["十萬位", "萬位", "千位", "百位", "十位", "個位"];
  const PLACE_SHORT_ALL = ["十萬", "萬", "千", "百", "十", "個"];
  const MAX_COLS = 6;
  const MIN_COLS = 4;

  /**
   * 進位偏好最多重抽幾次（每次只是幾個 rng 呼叫，很便宜）。
   * 最難的是題型 2／11「無乘進位」：每抽約 2% 命中；舊版 100 次約 15% 找不到，
   * 2000 次失敗機率約 1e-16。
   */
  const CARRY_TRIES = 2000;

  /** 每張卡只在第一個進位步驟顯示一次（之後只在提示裡提） */
  const CARRY_TIP = "進位的數字寫在上方小格，下一步記得加上它。";

  const BOARD_ROWS = ["carry1", "carry2", "row1", "row2", "addCarry", "answer"];

  /** 直式板由上到下的列順序（含被乘數、乘數）；實際顯示看 board.visibleRows */
  const RENDER_ROWS = [
    "carry1", "carry2", "multiplicand", "multiplier", "row1", "row2", "addCarry", "answer",
  ];

  const HINT_LEVELS = 3;

  // ---------- 亂數 ----------
  /** mulberry32：可重現的 [0, 1) 亂數 */
  function makeRng(seed) {
    let t = seed >>> 0;
    return function () {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randInt(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- 選項（常見錯誤當誘答） ----------
  /** 錯誤類型 → 回饋文字（依步驟內容） */
  function errorText(key, step) {
    const c = step.calc || {};
    const place = step.place || "這一格";
    switch (key) {
      case "forgot-carry":
        return `好像忘了加進位 ${c.carryIn}。`;
      case "carry-twice":
        return "進位只要加一次喔。";
      case "tens-digit":
        return `這是${c.op === "add" ? "加" : "乘"}出來的十位數字，藍框要寫個位的數字。`;
      case "ones-digit":
        return c.part === "high"
          ? `這是個位的數（剛才寫過了），${place}要寫乘出來的十位數字。`
          : "這是個位的數，要進位的是十位的數字。";
      case "added":
        return "這一步要用「乘」的喔。";
      case "multiplied":
        return "這一步要用「加」的喔。";
      case "neighbour":
        return "這好像是隔壁那一位算出來的，看紅圈的位置再算一次。";
      case "no-carry":
        return "加起來超過 9 了，要進位喔。";
      case "zero-first":
        return "0 等一下才補，這一格先寫相乘的結果。";
      case "row-shift":
        return `乘出來是「幾個${c.unit || "十"}」，想想${place}上有幾個${unitOf(place)}。`;
      default:
        return null;
    }
  }

  /** 依步驟算出「常見錯誤」候選（依優先順序；可能重複或等於正解，之後再篩） */
  function errorCandidates(step) {
    const c = step.calc;
    if (!c) return [];
    const out = [];
    const add = (value, key) => {
      if (Number.isInteger(value) && value >= 0 && value <= 9) out.push({ value, key });
    };
    const ones = (v) => v % 10;
    const tens = (v) => Math.floor(v / 10) % 10;

    if (c.op === "mul" || c.op === "add") {
      const isMul = c.op === "mul";
      const base = isMul ? c.d * c.m : c.d1 + c.d2;
      const other = isMul ? c.d + c.m : c.d1 * c.d2;
      const otherKey = isMul ? "added" : "multiplied";
      const pick = c.part === "ones" ? ones : tens;
      const value = base + c.carryIn;
      if (c.part === "ones") {
        if (c.carryIn) add(ones(base), "forgot-carry");
        if (value >= 10) add(tens(value), "tens-digit");
        if (c.shortcut) add(0, "zero-first");
      } else {
        add(ones(value), "ones-digit");
        if (c.carryIn) add(tens(base), "forgot-carry");
        if (c.op === "add") add(0, "no-carry");
      }
      if (c.carryIn) add(pick(base + 2 * c.carryIn), "carry-twice");
      (c.neighbours || []).forEach((n) => add(pick(n + c.carryIn), "neighbour"));
      add(pick(other + c.carryIn), otherKey);
    } else if (c.op === "zero") {
      add(ones(c.rowDigits), "row-shift");
      add(c.m, "row-shift");
    }
    return out;
  }

  /**
   * 四選一：正解＋最多 3 個常見錯誤；不夠才用 ±1、9−x、±2、隨機補。
   * step 可以是步驟物件或單純的正解數字（只用補數）。
   * 回傳 { values: 四個不同的 0–9（已洗牌）, why: { 錯的數字: 錯誤回饋文字 } }
   */
  function buildChoices(step, rng) {
    rng = rng || Math.random;
    if (typeof step === "number") step = { answer: step };
    const correct = step.answer;
    const picked = [correct];
    const why = {};
    errorCandidates(step).forEach(({ value, key }) => {
      if (picked.length >= 4 || picked.includes(value)) return;
      picked.push(value);
      const text = errorText(key, step);
      if (text) why[value] = text;
    });
    const fillers = [correct - 1, correct + 1, 9 - correct, correct - 2, correct + 2]
      .map((x) => ((x % 10) + 10) % 10);
    for (const n of fillers) {
      if (picked.length >= 4) break;
      if (!picked.includes(n)) picked.push(n);
    }
    while (picked.length < 4) {
      const n = Math.floor(rng() * 10);
      if (!picked.includes(n)) picked.push(n);
    }
    return { values: shuffle(picked, rng), why };
  }

  /** 只要四個選項（舊介面） */
  function makeChoices(step, rng) {
    return buildChoices(step, rng).values;
  }

  /** 沒有對應錯誤類型時的通用回饋 */
  function genericWrong(step) {
    if (step.kind === "add" || step.kind === "add-carry") {
      return "還差一點。看紅圈，把這一行的數加起來再選。";
    }
    if (step.kind === "pad-zero") {
      return "還差一點。這一排是「幾個十」（或幾個百），看看藍框的位值再選。";
    }
    return "還差一點。看紅圈相乘，再看看藍框的位值。";
  }

  // ---------- 數字小工具 ----------
  function lenOf(n) {
    return String(n).length;
  }

  /** 「十位」→「十」、「個位」→「一」（說「幾個十」「幾個一」用） */
  function unitOf(place) {
    return place === "個位" ? "一" : place.replace(/位$/, "");
  }

  /** place 0 = 個位、1 = 十位… */
  function digitAt(n, place) {
    return Math.floor(n / Math.pow(10, place)) % 10;
  }

  /**
   * 直式乘法過程中，是否出現「乘進位」（寫入①②進位列的那種）。
   * 被乘數最高位乘出的十位直接寫進該排（不寫進位列），所以不算。
   * 因此被乘數只有最高位非 0（一位數、整十、整千）時永遠是 false。
   */
  function hasMultCarry(a, b) {
    function rowCarry(multDigit) {
      if (!multDigit) return false;
      let carry = 0;
      let n = a;
      let remaining = Math.floor(Math.log10(a)) + 1;
      while (remaining > 0) {
        const d = n % 10;
        const prod = multDigit * d + carry;
        const next = Math.floor(prod / 10);
        n = Math.floor(n / 10);
        remaining -= 1;
        if (next > 0 && remaining > 0) return true;
        carry = next;
      }
      return false;
    }
    const bOnes = b % 10;
    const bTens = Math.floor(b / 10) % 10;
    return rowCarry(bOnes) || (b >= 10 && rowCarry(bTens));
  }

  // ---------- 題型約束 ----------
  const isInt = Number.isInteger;

  function oneDigit2to9(n) {
    return isInt(n) && n >= 2 && n <= 9;
  }

  /** 整十 10–90 */
  function wholeTen(n) {
    return isInt(n) && n >= 10 && n <= 90 && n % 10 === 0;
  }

  /** 二位數且個位 ≠ 0 */
  function twoDigitOnesNonZero(n) {
    return isInt(n) && n >= 11 && n <= 99 && n % 10 !== 0;
  }

  /** 四位數、百位與十位皆非 0 */
  function fourDigitNoMiddleZeroOK(n) {
    return isInt(n) && n >= 1000 && n <= 9999 && digitAt(n, 2) !== 0 && digitAt(n, 1) !== 0;
  }

  /** 四位數、百位或十位為 0、非整千 */
  function fourDigitMiddleZeroOK(n) {
    return (
      isInt(n) && n >= 1000 && n <= 9999 &&
      (digitAt(n, 2) === 0 || digitAt(n, 1) === 0) &&
      n % 1000 !== 0
    );
  }

  /** 三位數、十位 ≠ 0 */
  function threeDigitNoMiddleZeroOK(n) {
    return isInt(n) && n >= 100 && n <= 999 && digitAt(n, 1) !== 0;
  }

  /** 三位數、十位為 0、個位 ≠ 0（如 203；排除整百 500） */
  function threeDigitMiddleZeroOK(n) {
    return isInt(n) && n >= 100 && n <= 999 && digitAt(n, 1) === 0 && n % 10 !== 0;
  }

  // ---------- 題型隨機數字 ----------
  function fourDigitNoMiddleZero(rng) {
    return (
      randInt(rng, 1, 9) * 1000 +
      randInt(rng, 1, 9) * 100 +
      randInt(rng, 1, 9) * 10 +
      randInt(rng, 1, 9)
    );
  }

  function fourDigitWithMiddleZero(rng) {
    for (;;) {
      const thousands = randInt(rng, 1, 9);
      const ones = randInt(rng, 0, 9);
      let hundreds;
      let tens;
      const mode = randInt(rng, 0, 2);
      if (mode === 0) {
        hundreds = 0;
        tens = randInt(rng, 1, 9);
      } else if (mode === 1) {
        hundreds = randInt(rng, 1, 9);
        tens = 0;
      } else {
        hundreds = 0;
        tens = 0;
        // 避免退化成整千（個位也 0）
        if (ones === 0) continue;
      }
      return thousands * 1000 + hundreds * 100 + tens * 10 + ones;
    }
  }

  function threeDigitNoMiddleZero(rng) {
    return randInt(rng, 1, 9) * 100 + randInt(rng, 1, 9) * 10 + randInt(rng, 0, 9);
  }

  function threeDigitWithMiddleZero(rng) {
    // 中間（十位）為 0、個位非 0，如 203（不出整百 500）
    return randInt(rng, 1, 9) * 100 + randInt(rng, 1, 9);
  }

  function twoDigitNonZeroOnes(rng) {
    return randInt(rng, 1, 9) * 10 + randInt(rng, 1, 9);
  }

  /**
   * 康軒資料冊 12 學習目標題型
   * - pick(rng)：抽一組候選 {a, b}
   * - check(a, b)：題型約束（與 README 表格一致）
   * - carry：是否有「有／無乘進位」的難度變化。
   *   被乘數只有最高位非 0（一位數、整十、整千）時，最高位乘出的十位直接寫進該排，
   *   板上不會出現①②進位格 → 乘進位不適用（hasMultCarry 恆為 false），不做偏好重抽。
   * - fallback：萬一重抽都失敗時的已驗證題目
   */
  const TYPES = [
    {
      stage: "整千×一位",
      example: [3000, 2],
      carry: false, // d000 × b：d×b ≥ 10 只是積多一位（如 3000×4=12000），沒有進位格
      pick: (rng) => ({ a: randInt(rng, 1, 9) * 1000, b: randInt(rng, 2, 9) }),
      check: (a, b) => isInt(a) && a >= 1000 && a <= 9000 && a % 1000 === 0 && oneDigit2to9(b),
      fallback: [3000, 2],
    },
    {
      stage: "四位×一位",
      example: [1426, 3],
      carry: true,
      pick: (rng) => ({ a: fourDigitNoMiddleZero(rng), b: randInt(rng, 2, 9) }),
      check: (a, b) => fourDigitNoMiddleZeroOK(a) && oneDigit2to9(b),
      fallback: [1426, 3],
    },
    {
      stage: "四位×一位、被乘數中間有0",
      example: [2035, 4],
      carry: true,
      pick: (rng) => ({ a: fourDigitWithMiddleZero(rng), b: randInt(rng, 2, 9) }),
      check: (a, b) => fourDigitMiddleZeroOK(a) && oneDigit2to9(b),
      fallback: [2035, 4],
    },
    {
      stage: "一位×整十",
      example: [8, 20],
      carry: false, // 被乘數一位數
      pick: (rng) => ({ a: randInt(rng, 2, 9), b: randInt(rng, 1, 9) * 10 }),
      check: (a, b) => oneDigit2to9(a) && wholeTen(b),
      fallback: [8, 20],
    },
    {
      stage: "一位×二位",
      example: [6, 28],
      carry: false, // 被乘數一位數
      pick: (rng) => ({ a: randInt(rng, 2, 9), b: twoDigitNonZeroOnes(rng) }),
      check: (a, b) => oneDigit2to9(a) && twoDigitOnesNonZero(b),
      fallback: [6, 28],
    },
    {
      stage: "整十×整十",
      example: [30, 50],
      carry: false, // 被乘數整十
      pick: (rng) => ({ a: randInt(rng, 1, 9) * 10, b: randInt(rng, 1, 9) * 10 }),
      check: (a, b) => wholeTen(a) && wholeTen(b),
      fallback: [30, 50],
    },
    {
      stage: "二位×二位、積為三位數",
      example: [12, 13],
      carry: true,
      pick: (rng) => ({ a: twoDigitNonZeroOnes(rng), b: twoDigitNonZeroOnes(rng) }),
      check: (a, b) =>
        twoDigitOnesNonZero(a) && twoDigitOnesNonZero(b) && a * b >= 100 && a * b <= 999,
      fallback: [12, 13], // 156
    },
    {
      stage: "二位×二位、積為四位數",
      example: [48, 27],
      carry: true,
      pick: (rng) => ({ a: twoDigitNonZeroOnes(rng), b: twoDigitNonZeroOnes(rng) }),
      check: (a, b) =>
        twoDigitOnesNonZero(a) && twoDigitOnesNonZero(b) && a * b >= 1000 && a * b <= 9999,
      fallback: [48, 27], // 1296
    },
    {
      stage: "三位×二位",
      example: [386, 59],
      carry: true,
      pick: (rng) => ({ a: threeDigitNoMiddleZero(rng), b: twoDigitNonZeroOnes(rng) }),
      check: (a, b) => threeDigitNoMiddleZeroOK(a) && twoDigitOnesNonZero(b),
      fallback: [386, 59],
    },
    {
      stage: "三位×二位、被乘數中間有0",
      example: [203, 45],
      carry: true,
      pick: (rng) => ({ a: threeDigitWithMiddleZero(rng), b: twoDigitNonZeroOnes(rng) }),
      check: (a, b) => threeDigitMiddleZeroOK(a) && twoDigitOnesNonZero(b),
      fallback: [203, 45],
    },
    {
      stage: "四位×二位",
      example: [2345, 67],
      carry: true,
      pick: (rng) => ({ a: fourDigitNoMiddleZero(rng), b: twoDigitNonZeroOnes(rng) }),
      check: (a, b) => fourDigitNoMiddleZeroOK(a) && twoDigitOnesNonZero(b),
      fallback: [2345, 67],
    },
    {
      stage: "四位×二位、被乘數中間有0",
      example: [1005, 23],
      carry: true,
      pick: (rng) => ({ a: fourDigitWithMiddleZero(rng), b: twoDigitNonZeroOnes(rng) }),
      check: (a, b) => fourDigitMiddleZeroOK(a) && twoDigitOnesNonZero(b),
      fallback: [1005, 23],
    },
  ];

  TYPES.forEach((type, i) => {
    type.no = i + 1;
    /** type.generate(rng, opts) ＝ generate(i, { rng, ...opts }) */
    type.generate = function (rng, opts) {
      return generate(i, Object.assign({}, opts, { rng: rng || (opts && opts.rng) }));
    };
  });

  const DECK = TYPES;

  function checkType(index, a, b) {
    const type = TYPES[index];
    return !!type && type.check(a, b);
  }

  /** 題型是否有「有／無乘進位」的變化 */
  function carryApplies(index) {
    const type = TYPES[index];
    return !!type && type.carry;
  }

  /**
   * 依題型隨機出題：回傳 { a, b }，一定符合 checkType(index, a, b)。
   * opts.rng：亂數（預設 Math.random）
   * opts.carry：true 偏好有乘進位、false 偏好無；未給則 50/50（題型內的難度變化）。
   *   不適用乘進位的題型（見 TYPES[i].carry）忽略此選項。
   *   偏好最多重抽 CARRY_TRIES 次，找不到就放寬（仍符合題型約束）。
   */
  function generate(index, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const type = TYPES[index];
    if (!type) throw new Error("unknown type index " + index);
    const useCarry = type.carry;
    const wantCarry = useCarry
      ? typeof opts.carry === "boolean"
        ? opts.carry
        : rng() < 0.5
      : null;
    const tries = useCarry ? CARRY_TRIES : 100;
    let loose = null; // 符合約束但不符進位偏好的第一組
    for (let t = 0; t < tries; t++) {
      const r = type.pick(rng);
      if (!type.check(r.a, r.b)) continue;
      if (!useCarry || hasMultCarry(r.a, r.b) === wantCarry) return r;
      if (!loose) loose = r;
    }
    if (loose) return loose;
    return { a: type.fallback[0], b: type.fallback[1] };
  }

  // ---------- 直式板 ----------
  function digitsOf(n, numCols) {
    numCols = numCols || MIN_COLS;
    const out = [];
    let x = n;
    for (let i = 0; i < numCols; i++) {
      out.unshift(x % 10);
      x = Math.floor(x / 10);
    }
    return out; // length numCols, left = high place
  }

  function placeLabels(numCols) {
    return PLACE_ALL.slice(PLACE_ALL.length - numCols);
  }

  function placeShort(numCols) {
    return PLACE_SHORT_ALL.slice(PLACE_SHORT_ALL.length - numCols);
  }

  function colsFor(a, b) {
    const product = a * b;
    const need = Math.max(
      String(product).length,
      String(a).length,
      String(b).length,
      MIN_COLS
    );
    return Math.min(MAX_COLS, need);
  }

  function emptyRow(n) {
    return Array(n).fill(null);
  }

  function emptyBoolRow(n) {
    return Array(n).fill(false);
  }

  function emptyBoard(a, b) {
    const numCols = colsFor(a, b);
    const A = digitsOf(a, numCols);
    const B = digitsOf(b, numCols);
    const aStr = String(a);
    const bStr = String(b);
    const mode = boardMode(a, b);
    const multiplicand = A.map((d, i) => {
      const placeFromRight = numCols - 1 - i;
      return placeFromRight < aStr.length ? d : null;
    });
    const multiplier = B.map((d, i) => {
      const placeFromRight = numCols - 1 - i;
      return placeFromRight < bStr.length ? d : null;
    });
    return {
      a,
      b,
      product: a * b,
      numCols,
      carry1: emptyRow(numCols),
      carry2: emptyRow(numCols),
      multiplicand,
      multiplier,
      row1: emptyRow(numCols),
      row2: emptyRow(numCols),
      addCarry: emptyRow(numCols),
      answer: emptyRow(numCols),
      slots: {
        carry1: emptyBoolRow(numCols),
        carry2: emptyBoolRow(numCols),
        row1: emptyBoolRow(numCols),
        row2: emptyBoolRow(numCols),
        addCarry: emptyBoolRow(numCols),
        answer: emptyBoolRow(numCols),
      },
      hasSecondRow: mode === "two-row",
      mode,
      visibleRows: visibleRowsFor(a, mode),
    };
  }

  /** 末尾有幾個 0（a 必為正整數） */
  function trailingZeros(n) {
    let z = 0;
    while (n % 10 === 0) {
      n /= 10;
      z += 1;
    }
    return z;
  }

  /** 只有最高位非 0（如 8、30、3000） */
  function singleNonZero(n) {
    return isInt(n) && n >= 1 && n / Math.pow(10, trailingZeros(n)) <= 9;
  }

  /**
   * 教冊捷徑：「整千×一位」（3000×2）、「一位×整十」（8×20）、「整十×整十」（30×50）：
   * 先算兩個非 0 數字相乘（幾個千／十／百），再補上 0 的數量；直式只有一排答案。
   */
  function isShortcut(a, b) {
    return (
      singleNonZero(a) && singleNonZero(b) && b <= 90 &&
      trailingZeros(a) + trailingZeros(b) >= 1
    );
  }

  /**
   * one-row：乘數一位，乘出來那一排就是答案（不顯示第二排、加法進位）
   * shortcut：整十／整千捷徑（見 isShortcut），也只有一排答案
   * two-row：第一排＋第二排，再相加
   */
  function boardMode(a, b) {
    if (isShortcut(a, b)) return "shortcut";
    return b >= 10 ? "two-row" : "one-row";
  }

  /** 被乘數至少兩個非 0 數字才可能有乘進位（只有最高位非 0 → 乘出的十位直接寫進該排） */
  function multCarryPossible(a) {
    return String(a).replace(/0/g, "").length >= 2;
  }

  /** 要畫出來的列（由上到下）；用不到的列整列隱藏 */
  function visibleRowsFor(a, mode) {
    const carry = mode !== "shortcut" && multCarryPossible(a);
    return RENDER_ROWS.filter((row) => {
      if (row === "carry1") return carry;
      if (row === "carry2") return carry && mode === "two-row";
      if (row === "row1" || row === "row2" || row === "addCarry") return mode === "two-row";
      return true;
    });
  }

  function markSlot(board, row, col) {
    if (col >= 0 && col < board.numCols && board.slots[row]) {
      board.slots[row][col] = true;
    }
  }

  // ---------- 題目與三層提示（第 1 層只講概念、第 2 層算式、第 3 層才說寫幾） ----------
  function mulExpr(c) {
    return `${c.d} × ${c.m}` + (c.carryIn ? ` + 進位 ${c.carryIn}` : "");
  }

  function mulWork(c) {
    const p = c.d * c.m;
    return `${c.d} × ${c.m} = ${p}` + (c.carryIn ? `，${p} + ${c.carryIn} = ${p + c.carryIn}` : "");
  }

  function addExpr(c) {
    const terms = c.terms.map(String);
    if (c.carryIn) terms.push(`進位 ${c.carryIn}`);
    return terms.join(" + ");
  }

  function addWork(c) {
    const s = c.d1 + c.d2;
    const base = c.terms.length >= 2 ? `${c.terms.join(" + ")} = ${s}` : null;
    if (!c.carryIn) return base || `只有 ${s}`;
    if (!c.terms.length) return `只有進位 ${c.carryIn}`;
    return (base ? `${base}，` : "") + `${s} + ${c.carryIn} = ${s + c.carryIn}`;
  }

  /** 整十／整千捷徑：哪個數是整幾（不含數字，第 1 層提示用） */
  function shortcutWhat(c) {
    const whole = (z) => "整" + ["", "十", "百", "千"][z];
    if (c.za && c.zb) return c.za === c.zb ? `兩個數都是${whole(c.za)}` : `被乘數是${whole(c.za)}、乘數是${whole(c.zb)}`;
    return c.za ? `被乘數是${whole(c.za)}` : `乘數是${whole(c.zb)}`;
  }

  /** 要補幾個 0、是誰後面的 0（第 3 層提示用） */
  function shortcutZeros(c) {
    if (c.za && c.zb) return ` ${c.zeros} 個 0`;
    return c.za ? `被乘數後面的 ${c.za} 個 0` : `乘數後面的 ${c.zb} 個 0`;
  }

  /** 由 step.calc 產生 { question, hints[3], reveal }；題目不顯示乘積／和 */
  function stepTexts(step) {
    const c = step.calc;
    const place = step.place;
    const ans = step.answer;
    const carryConcept = "十位的數字要進位，寫在上方小格，下一步再加上去。";

    if (c.op === "mul" || c.op === "add") {
      const isMul = c.op === "mul";
      const value = isMul ? c.d * c.m + c.carryIn : c.d1 + c.d2 + c.carryIn;
      const expr = isMul ? mulExpr(c) : addExpr(c);
      const work = (isMul ? mulWork(c) : addWork(c)) + "。";

      if (c.part === "carry") {
        return {
          question: `${expr} = ?，要進位幾？`,
          hints: [
            `${isMul ? "乘" : "加"}出來是兩位數，${carryConcept}`,
            work,
            `${value} 的十位是 ${ans}，進位 ${ans} 寫在上方小格。`,
          ],
          reveal: `${value} 的十位 ${ans} 要進位：進位 ${ans} 寫在上方小格。`,
        };
      }
      if (c.part === "high") {
        return {
          question: `${expr} = ?，${place}寫幾？`,
          hints: [
            c.shortcut
              ? `乘出來是兩位數，十位的數字直接寫在左邊的${place}。`
              : `被乘數最左邊這一位乘完了，乘出來的十位數字不用進位，直接寫在左邊的${place}。`,
            work,
            `${value} 的十位是 ${ans}，${place}寫 ${ans}。`,
          ],
          reveal: `${value} 的十位 ${ans} 寫在${place}。`,
        };
      }

      // part === "ones"
      let concept;
      let partial = work;
      if (!isMul) {
        concept =
          `看紅圈：把${place}這一行的數加起來` +
          (c.carryIn ? "，再加上上方小格的進位" : "") +
          "。藍框寫加出來的個位數字。";
      } else if (c.shortcut) {
        concept =
          shortcutWhat(c) +
          `。先不管後面的零，把紅圈的兩個數相乘；乘出來的是「幾個${c.unit}」，所以從${place}開始寫。`;
        partial = `${work}${c.a} × ${c.b} 是 ${value} 個${c.unit}。`;
      } else {
        concept =
          (c.tensRowStart
            ? "這一排乘的是乘數的十位（其實是乘幾十），乘出來的是「幾個十」，所以從十位開始寫。"
            : "") +
          (c.d === 0
            ? `被乘數的${c.aPlace}是零，零乘任何數都是零`
            : `看紅圈：被乘數的${c.aPlace} × 乘數的${c.bPlace}`) +
          (c.carryIn ? "，再加上上方小格的進位" : "") +
          "。藍框寫乘出來的個位數字。";
        if (c.tensRowStart) partial = `${mulWork(c)}，是 ${value} 個十。`;
      }
      let question = `${expr} = ?，${place}寫幾？`;
      if (!isMul && c.terms.length + (c.carryIn ? 1 : 0) === 1) {
        question = `${place}只有 ${expr}，${place}寫幾？`;
      }
      return {
        question,
        hints: [
          concept,
          partial,
          value >= 10 ? `${value} 的個位是 ${ans}，${place}寫 ${ans}。` : `${place}寫 ${ans}。`,
        ],
        reveal: `${expr} = ${value}，${place}寫 ${ans}。`,
      };
    }

    // c.op === "zero"：補 0
    if (c.shortcut) {
      const v = c.d * c.m;
      return {
        question: `${place}要寫幾？`,
        hints: [
          `乘出來的是「幾個${c.unit}」。${place}上有幾個${unitOf(place)}？`,
          `${c.d} × ${c.m} = ${v}，${c.a} × ${c.b} 是 ${v} 個${c.unit}。`,
          `補上${shortcutZeros(c)}：${place}寫 0。`,
        ],
        reveal: `${place}補 0：${v} 個${c.unit}就是 ${c.a * c.b}。`,
      };
    }
    const row = c.a * c.m;
    return {
      question: "第二排的個位要寫幾？",
      hints: [
        "這一排乘的是乘數的十位（其實是乘幾十），乘出來的是「幾個十」。個位上有幾個一？",
        `乘數的十位 ${c.m} 是 ${c.m * 10}；${c.a} × ${c.m} = ${row}，所以 ${c.a} × ${c.m * 10} 是 ${row} 個十。`,
        "這一排是「幾個十」，個位放 0（也可以省略不寫）。個位寫 0。",
      ],
      reveal: `個位放 0：${row} 個十就是 ${row * 10}。`,
    };
  }

  function makeStep(o) {
    const step = Object.assign({ highlights: [], autoFills: [] }, o);
    step.fill = [{ row: o.target.row, col: o.target.col, value: o.answer }];
    Object.assign(step, stepTexts(step));
    return step;
  }

  /**
   * 康軒位值直式步驟（每步點一格；進位也由學生點選，寫在上方小格）：
   * - one-row（乘數一位）：乘出來直接寫在答案列
   * - shortcut（整千×一位、一位×整十、整十×整十）：先算非 0 數字相乘（幾個千／十／百），再補 0
   * - two-row：第一排 × 個位；第二排 × 十位（整排乘完後點選個位補 0）；再從右往左相加
   *
   * boardPlan.slots 只標「之後一定會被填」的格（虛線格），且都在 visibleRows 內。
   */
  function buildSteps(a, b) {
    const steps = [];
    const boardPlan = emptyBoard(a, b);
    const { numCols, mode } = boardPlan;
    const onesCol = numCols - 1;
    const places = placeLabels(numCols);
    const hasSecond = mode === "two-row";
    const product = a * b;
    const bOnes = b % 10;
    const bTens = Math.floor(b / 10) % 10;

    function push(o) {
      markSlot(boardPlan, o.target.row, o.target.col);
      steps.push(makeStep(Object.assign({ place: places[o.target.col] }, o)));
    }

    if (mode === "shortcut") {
      const za = trailingZeros(a);
      const zb = trailingZeros(b);
      const zeros = za + zb;
      const d = a / Math.pow(10, za);
      const m = b / Math.pow(10, zb);
      const dCol = onesCol - za;
      const mCol = onesCol - zb;
      const v = d * m;
      const startCol = onesCol - zeros;
      const unit = unitOf(places[startCol]); // 幾個十／百／千
      const highlights = [
        { row: "multiplicand", col: dCol },
        { row: "multiplier", col: mCol },
      ];
      const calc = { op: "mul", d, m, carryIn: 0, a, b, shortcut: true, unit, zeros, za, zb };
      push({
        phase: `先乘·${places[startCol]}：先不管 0`,
        prompt: "先不管 0，看紅圈相乘",
        kind: "shortcut",
        answer: v % 10,
        target: { row: "answer", col: startCol },
        highlights,
        calc: Object.assign({ part: "ones" }, calc),
      });
      if (v >= 10) {
        push({
          phase: `先乘·${places[startCol - 1]}：最高位`,
          prompt: "先不管 0，看紅圈相乘",
          kind: "shortcut",
          answer: Math.floor(v / 10),
          target: { row: "answer", col: startCol - 1 },
          highlights,
          calc: Object.assign({ part: "high" }, calc),
        });
      }
      const zeroRings = [];
      for (let k = 0; k < za; k++) zeroRings.push({ row: "multiplicand", col: onesCol - k });
      for (let k = 0; k < zb; k++) zeroRings.push({ row: "multiplier", col: onesCol - k });
      for (let col = startCol + 1; col <= onesCol; col++) {
        push({
          phase: `補0·${places[col]}`,
          prompt: `乘出來是「幾個${unit}」，看紅圈的 0`,
          kind: "pad-zero",
          answer: 0,
          target: { row: "answer", col },
          highlights: zeroRings,
          calc: { op: "zero", d, m, a, b, shortcut: true, unit, zeros, za, zb, rowDigits: v },
        });
      }
      return { steps, boardPlan, row1Val: product, row2Val: 0, hasSecond, numCols, mode };
    }

    const aDigits = [];
    let n = a;
    let col = onesCol;
    do {
      aDigits.push({ val: n % 10, col });
      n = Math.floor(n / 10);
      col -= 1;
    } while (n > 0 && col >= 0);

    function partialRow(m, mCol, carryRow, productRow, prefix, second) {
      const shift = second ? 1 : 0;
      const kind = second ? "tens-row" : "ones-row";
      const tensPlaceValue = second ? m * 10 : null;
      const prompt = second ? `第二排乘十位（×${m * 10}），再填藍框` : "看紅圈相乘，再填藍框";
      let carry = 0;
      let carryCol = null;
      let value = 0;

      aDigits.forEach((md, idx) => {
        const writeCol = md.col - shift;
        if (writeCol < 0) return;
        const isLast = idx === aDigits.length - 1;
        const prod = m * md.val + carry;
        const highlights = [
          { row: "multiplicand", col: md.col },
          { row: "multiplier", col: mCol },
        ];
        if (carry) highlights.push({ row: carryRow, col: carryCol, carry: true });
        const calc = {
          op: "mul",
          d: md.val,
          m,
          carryIn: carry,
          a,
          b,
          aPlace: places[md.col],
          bPlace: places[mCol],
          tensRowStart: second && idx === 0,
          neighbours: [aDigits[idx - 1], aDigits[idx + 1]].filter(Boolean).map((x) => x.val * m),
        };
        const place = places[writeCol];
        let phase;
        if (idx === 0) phase = second ? `${prefix}·十位：乘十位` : `${prefix}·個位：先乘個位`;
        else if (md.val === 0) phase = `${prefix}·${place}：中間有0`;
        else phase = `${prefix}·${place}：繼續乘`;

        push({
          phase,
          prompt,
          kind,
          answer: prod % 10,
          target: { row: productRow, col: writeCol },
          highlights,
          calc: Object.assign({ part: "ones" }, calc),
          tensPlaceValue,
          multDigit: m,
        });
        value += (prod % 10) * Math.pow(10, onesCol - writeCol);

        const next = Math.floor(prod / 10);
        if (next > 0 && !isLast) {
          carryCol = writeCol - 1;
          push({
            phase: `${prefix}·進位：記上方`,
            prompt: "乘出來是兩位數，進位寫在上方小格",
            kind: "carry",
            answer: next,
            target: { row: carryRow, col: carryCol },
            highlights,
            calc: Object.assign({ part: "carry" }, calc),
          });
          carry = next;
        } else if (next > 0) {
          // 最後一位：十位直接寫進該排（next ≤ 8，一定是一位數）
          const hCol = writeCol - 1;
          push({
            phase: `${prefix}·${places[hCol]}：最高位`,
            prompt,
            kind,
            answer: next,
            target: { row: productRow, col: hCol },
            highlights,
            calc: Object.assign({ part: "high" }, calc),
            tensPlaceValue,
            multDigit: m,
          });
          value += next * Math.pow(10, onesCol - hCol);
        } else {
          carry = 0;
          carryCol = null;
        }
      });

      // 第二排：整排乘完後個位補 0（點選一步；因 ×十位＝×n0）
      if (second) {
        push({
          phase: `${prefix}·個位：補0`,
          prompt: "第二排乘完了，個位要寫幾？",
          kind: "pad-zero",
          answer: 0,
          target: { row: productRow, col: onesCol },
          highlights: [{ row: "multiplier", col: mCol }],
          calc: { op: "zero", m, a, b, unit: "十", rowDigits: a * m },
          tensPlaceValue,
          multDigit: m,
        });
      }
      return value;
    }

    let row1Val;
    let row2Val = 0;
    if (!hasSecond) {
      row1Val = partialRow(bOnes, onesCol, "carry1", "answer", "相乘", false);
    } else {
      row1Val = partialRow(bOnes, onesCol, "carry1", "row1", "第一排", false);
      row2Val = partialRow(bTens, onesCol - 1, "carry2", "row2", "第二排", true);

      // ----- 相加（從右往左、逐位；加法進位也由學生點選） -----
      const maxCol = numCols - String(product).length;
      const digitAtCol = (val, c) => Math.floor(val / Math.pow(10, onesCol - c)) % 10;
      let carry = 0;
      for (let c = onesCol; c >= maxCol; c--) {
        const has1 = boardPlan.slots.row1[c];
        const has2 = boardPlan.slots.row2[c];
        const d1 = has1 ? digitAtCol(row1Val, c) : 0;
        const d2 = has2 ? digitAtCol(row2Val, c) : 0;
        const terms = [];
        if (has1) terms.push(d1);
        if (has2) terms.push(d2);
        const sum = d1 + d2 + carry;
        const highlights = [];
        if (has1) highlights.push({ row: "row1", col: c });
        if (has2) highlights.push({ row: "row2", col: c });
        if (carry) highlights.push({ row: "addCarry", col: c, carry: true });
        const calc = {
          op: "add",
          d1,
          d2,
          terms,
          carryIn: carry,
          neighbours: [c - 1, c + 1]
            .filter((x) => x >= 0 && x <= onesCol)
            .map((x) => digitAtCol(row1Val, x) + digitAtCol(row2Val, x)),
        };
        push({
          phase: `相加·${places[c]}：從右往左`,
          prompt: "看紅圈相加，再填藍框",
          kind: "add",
          answer: sum % 10,
          target: { row: "answer", col: c },
          highlights,
          calc: Object.assign({ part: "ones" }, calc),
        });
        carry = Math.floor(sum / 10);
        if (carry > 0) {
          push({
            phase: "相加·進位：記上方",
            prompt: "加起來是兩位數，進位寫在上方小格",
            kind: "add-carry",
            answer: carry,
            target: { row: "addCarry", col: c - 1 },
            highlights,
            calc: Object.assign({ part: "carry" }, calc),
          });
        }
      }
    }

    // 進位小提醒：每張卡只出現一次（第一個進位步驟）
    const firstCarry = steps.find((s) => s.kind === "carry" || s.kind === "add-carry");
    if (firstCarry) firstCarry.tip = CARRY_TIP;

    return { steps, boardPlan, row1Val, row2Val, hasSecond, numCols, mode };
  }

  /** 由 plan 複製出一張全空的板（保留 slots 虛線標記） */
  function cloneBoard(plan) {
    const b = JSON.parse(JSON.stringify(plan));
    BOARD_ROWS.forEach((row) => {
      b[row] = b[row].map(() => null);
    });
    return b;
  }

  function applyFill(board, fills, autoMap) {
    (fills || []).forEach((f) => {
      board[f.row][f.col] = f.value;
      if (board.slots[f.row]) board.slots[f.row][f.col] = true;
      if (f.auto && autoMap) autoMap[`${f.row}-${f.col}`] = true;
    });
  }

  function buildCompletedBoard(a, b) {
    const { steps, boardPlan, row1Val, row2Val, hasSecond, numCols, mode } = buildSteps(a, b);
    const board = cloneBoard(boardPlan);
    const autoCells = {};
    steps.forEach((s) => {
      applyFill(board, s.fill, autoCells);
      applyFill(board, s.autoFills, autoCells);
    });
    return { board, steps, row1Val, row2Val, hasSecond, autoCells, numCols, mode };
  }

  return {
    PLACE_ALL,
    PLACE_SHORT_ALL,
    MAX_COLS,
    MIN_COLS,
    CARRY_TRIES,
    CARRY_TIP,
    BOARD_ROWS,
    TYPES,
    DECK,
    makeRng,
    shuffle,
    makeChoices,
    digitAt,
    hasMultCarry,
    checkType,
    carryApplies,
    generate,
    digitsOf,
    placeLabels,
    placeShort,
    colsFor,
    emptyBoard,
    buildSteps,
    cloneBoard,
    applyFill,
    buildCompletedBoard,
    RENDER_ROWS,
    HINT_LEVELS,
    buildChoices,
    errorCandidates,
    genericWrong,
    isShortcut,
    boardMode,
  };
});
