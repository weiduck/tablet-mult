/**
 * 直式乘法練習：純邏輯（不碰 DOM）
 * - 12 題型（康軒數學4上 第02單元「整數的乘法」N-4-2）約束 checkType、隨機出題 generate
 * - 步驟引擎 buildSteps、完成板 buildCompletedBoard、選項 makeChoices
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

  const CARRY_TIP =
    "進位可記在心裡、手指或紙上；標記時別擋到等一下相加的位置。";

  const BOARD_ROWS = ["carry1", "carry2", "row1", "row2", "addCarry", "answer"];

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

  /** 四選一：正解＋鄰近數字，再補隨機數字 */
  function makeChoices(correct, rng) {
    rng = rng || Math.random;
    const set = new Set([correct]);
    const near = [correct - 1, correct + 1, correct - 2, correct + 2, 9 - correct]
      .map((x) => ((x % 10) + 10) % 10)
      .filter((x) => x !== correct);
    for (const n of near) {
      if (set.size >= 4) break;
      set.add(n);
    }
    while (set.size < 4) {
      set.add(Math.floor(rng() * 10));
    }
    return shuffle([...set], rng);
  }

  // ---------- 數字小工具 ----------
  function lenOf(n) {
    return String(n).length;
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
      hasSecondRow: b >= 10,
    };
  }

  function markSlot(board, row, col) {
    if (col >= 0 && col < board.numCols && board.slots[row]) {
      board.slots[row][col] = true;
    }
  }

  /**
   * 康軒位值直式步驟：
   * - 第一排 × 個位；中間進位寫上方；最後高位寫進該排
   * - 第二排 × 十位（其實 ×n0）；整排乘完後學生點選補 0（一步）
   * - 相加從右往左；加法進位自動
   *
   * boardPlan.slots 只標「之後一定會被填」的格（虛線格）：
   * 步驟會填的格、加法自動進位格，以及一排題（無第二排）完成時由第一排抄下的答案格。
   */
  function buildSteps(a, b) {
    const steps = [];
    const boardPlan = emptyBoard(a, b);
    const numCols = boardPlan.numCols;
    const onesCol = numCols - 1;
    const places = placeLabels(numCols);

    const aDigits = [];
    let n = a;
    let col = onesCol;
    do {
      aDigits.push({ val: n % 10, col });
      n = Math.floor(n / 10);
      col -= 1;
    } while (n > 0 && col >= 0);

    const bOnes = b % 10;
    const bTens = Math.floor(b / 10) % 10;
    const hasSecond = b >= 10;
    const tensPlaceValue = bTens * 10;

    function addPartialSteps(multDigit, multCol, carryRow, productRow, phasePrefix, isSecondRow) {
      let runningCarry = 0;
      const written = [];

      aDigits.forEach((md, idx) => {
        const isLast = idx === aDigits.length - 1;
        const prod = multDigit * md.val + runningCarry;
        const writeDigit = prod % 10;
        const nextCarry = Math.floor(prod / 10);
        const shift = isSecondRow ? 1 : 0;
        const writeCol = md.col - shift;
        if (writeCol < 0) return;

        markSlot(boardPlan, productRow, writeCol);

        const highlights = [
          { row: "multiplicand", col: md.col },
          { row: "multiplier", col: multCol },
        ];

        const place = places[writeCol];
        let question;
        if (idx === 0 && runningCarry === 0 && !isSecondRow) {
          question = `${multDigit} × ${md.val} = ${prod}，個位先寫幾？`;
        } else if (md.val === 0 && runningCarry > 0) {
          question = `${multDigit} × 0 + ${runningCarry} = ${prod}，${place}寫幾？`;
        } else if (md.val === 0) {
          question = `${multDigit} × 0 = ${prod}，${place}寫幾？`;
        } else if (runningCarry > 0) {
          question = `${multDigit} × ${md.val} + ${runningCarry} = ${prod}，${place}寫幾？`;
        } else {
          question = `${multDigit} × ${md.val} = ${prod}，${place}寫幾？`;
        }

        let phase;
        if (idx === 0) {
          phase = isSecondRow
            ? `${phasePrefix}·十位：乘十位`
            : `${phasePrefix}·個位：先乘個位`;
        } else if (md.val === 0) {
          phase = `${phasePrefix}·${place}：中間有0`;
        } else {
          phase = `${phasePrefix}·${place}：繼續乘`;
        }

        let hint;
        if (isSecondRow && idx === 0) {
          hint =
            `乘數的十位是 ${multDigit}，其實是在算 ×${tensPlaceValue}` +
            `（不是只 ×${multDigit}）。` +
            `${multDigit} × ${md.val} = ${prod}，這一格寫 ${writeDigit}；個位稍後補 0。`;
        } else if (md.val === 0) {
          hint =
            `被乘數這一位是 0，${multDigit} × 0 = 0` +
            (runningCarry > 0 ? `，再加上進位 ${runningCarry} 得到 ${prod}` : "") +
            `。對齊${place}後寫 ${writeDigit}。`;
        } else if (runningCarry > 0) {
          hint =
            `先算 ${multDigit} × ${md.val} = ${multDigit * md.val}，再加進位 ${runningCarry} 得到 ${prod}。` +
            `這一格寫 ${writeDigit}。${CARRY_TIP}`;
        } else {
          hint = `${multDigit} × ${md.val} = ${prod}。把個位數字 ${writeDigit} 寫進藍框（${place}）。`;
        }

        const step = {
          phase,
          prompt: isSecondRow
            ? `第二排乘十位（×${tensPlaceValue}），再填藍框`
            : "看紅圈相乘，再填藍框",
          question,
          hint,
          answer: writeDigit,
          target: { row: productRow, col: writeCol },
          highlights,
          fill: [{ row: productRow, col: writeCol, value: writeDigit }],
          autoFills: [],
          kind: isSecondRow ? "tens-row" : "ones-row",
          tensPlaceValue: isSecondRow ? tensPlaceValue : null,
          multDigit,
        };
        steps.push(step);
        written.push({ col: writeCol, value: writeDigit });

        if (!isLast && nextCarry > 0) {
          const cCol = writeCol - 1;
          if (cCol >= 0) {
            markSlot(boardPlan, carryRow, cCol);
            const badge = carryRow === "carry1" ? "①" : "②";
            steps.push({
              phase: `${phasePrefix}·進位：記上方`,
              prompt: "看紅圈相乘，再填藍框",
              question: `${prod} 的十位是幾？請寫進${badge}進位。`,
              hint:
                `${prod} = ${nextCarry}0 + ${writeDigit}，所以進位寫 ${nextCarry}。` +
                `下一步相乘時會加上它。${CARRY_TIP}`,
              answer: nextCarry,
              target: { row: carryRow, col: cCol },
              highlights,
              fill: [{ row: carryRow, col: cCol, value: nextCarry }],
              autoFills: [],
              kind: "carry",
            });
          }
          runningCarry = nextCarry;
        } else if (isLast && nextCarry > 0) {
          let high = nextCarry;
          let hCol = writeCol - 1;
          while (high > 0 && hCol >= 0) {
            const d = high % 10;
            markSlot(boardPlan, productRow, hCol);
            steps.push({
              phase: `${phasePrefix}·${places[hCol]}：最高位`,
              prompt: "看紅圈相乘，再填藍框",
              question: `${prod} 還剩左邊的 ${high}，${places[hCol]}寫幾？`,
              hint: `乘完後左邊還有 ${high}，把 ${d} 寫在 ${places[hCol]}（位值對齊）。`,
              answer: d,
              target: { row: productRow, col: hCol },
              highlights,
              fill: [{ row: productRow, col: hCol, value: d }],
              autoFills: [],
              kind: isSecondRow ? "tens-row" : "ones-row",
              tensPlaceValue: isSecondRow ? tensPlaceValue : null,
            });
            written.push({ col: hCol, value: d });
            high = Math.floor(high / 10);
            hCol -= 1;
          }
          runningCarry = 0;
        } else {
          runningCarry = nextCarry;
        }
      });

      // 第二排：整排乘完後個位補 0（點選一步；因 ×十位＝×n0）
      if (isSecondRow) {
        markSlot(boardPlan, productRow, onesCol);
        written.push({ col: onesCol, value: 0 });
        steps.push({
          phase: `${phasePrefix}·個位：補0`,
          prompt: "第二排乘完了，個位補幾？",
          question: "第二排個位要寫幾？",
          hint:
            `第二排乘完才補 0：這排其實是 ×${tensPlaceValue}` +
            `（不是只 ×${bTens}），所以個位對齊寫 0。`,
          answer: 0,
          target: { row: productRow, col: onesCol },
          highlights: [{ row: "multiplier", col: multCol }],
          fill: [{ row: productRow, col: onesCol, value: 0 }],
          autoFills: [],
          kind: "pad-zero",
          tensPlaceValue,
          multDigit,
        });
      }

      let value = 0;
      written.forEach((p) => {
        value += p.value * Math.pow(10, onesCol - p.col);
      });
      return value;
    }

    const multOnesCol = onesCol;
    const multTensCol = onesCol - 1;
    const row1Val = addPartialSteps(bOnes, multOnesCol, "carry1", "row1", "第一排", false);
    let row2Val = 0;
    if (hasSecond) {
      row2Val = addPartialSteps(bTens, multTensCol, "carry2", "row2", "第二排", true);
    }

    // ----- 相加（從右往左、逐位） -----
    if (hasSecond) {
      let addCarry = 0;
      const product = a * b;
      const prodDigits = String(product).length;
      const maxCol = numCols - prodDigits;

      for (let c = onesCol; c >= 0; c--) {
        const d1 = Math.floor(row1Val / Math.pow(10, onesCol - c)) % 10;
        const d2 = Math.floor(row2Val / Math.pow(10, onesCol - c)) % 10;
        if (c < maxCol && d1 === 0 && d2 === 0 && addCarry === 0) continue;

        const sum = d1 + d2 + addCarry;
        const writeDigit = sum % 10;
        const nextCarry = Math.floor(sum / 10);

        markSlot(boardPlan, "answer", c);

        let question;
        if (d1 === 0 && d2 === 0 && addCarry > 0) {
          question = `0 + 進位 ${addCarry} = ?`;
        } else if (addCarry > 0) {
          question = `${d1} + ${d2} + 進位 ${addCarry} = ${sum}，${places[c]}寫幾？`;
        } else if (c === onesCol && sum < 10) {
          question = `${d1} + ${d2} = ?`;
        } else {
          question = `${d1} + ${d2} = ${sum}，${places[c]}寫幾？`;
        }

        const fill = [{ row: "answer", col: c, value: writeDigit }];
        const autoFills = [];
        if (nextCarry > 0) {
          const cCol = c - 1;
          if (cCol >= 0) {
            markSlot(boardPlan, "addCarry", cCol);
            autoFills.push({
              row: "addCarry",
              col: cCol,
              value: nextCarry,
              auto: true,
            });
          }
        }

        const shortPlace = places[c];
        steps.push({
          phase: `相加·${shortPlace}：從右往左`,
          prompt: "從右往左，逐位相加",
          question,
          hint:
            addCarry > 0
              ? `${d1} + ${d2} + 進位 ${addCarry} = ${sum}。${shortPlace}寫 ${writeDigit}` +
                (nextCarry ? `，並進位 ${nextCarry}。` : "。") +
                (nextCarry ? CARRY_TIP : "")
              : `${d1} + ${d2} = ${sum}。${shortPlace}寫 ${writeDigit}` +
                (nextCarry ? `，進位 ${nextCarry} 給下一格。${CARRY_TIP}` : "。"),
          answer: writeDigit,
          target: { row: "answer", col: c },
          highlights: [],
          fill,
          autoFills,
          kind: "add",
        });

        addCarry = nextCarry;
      }
    } else {
      // 只有一排：第一排就是答案，完成時抄到答案列（fillAnswerFromRow1）
      for (let c = 0; c < numCols; c++) {
        if (boardPlan.slots.row1[c]) markSlot(boardPlan, "answer", c);
      }
    }

    return { steps, boardPlan, row1Val, row2Val, hasSecond, numCols };
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

  /** 只有一排（乘數一位）時，第一排就是答案：抄到答案列 */
  function fillAnswerFromRow1(board) {
    for (let c = 0; c < board.numCols; c++) {
      if (board.row1[c] !== null) {
        board.answer[c] = board.row1[c];
        board.slots.answer[c] = true;
      }
    }
  }

  function buildCompletedBoard(a, b) {
    const { steps, boardPlan, row1Val, row2Val, hasSecond, numCols } = buildSteps(a, b);
    const board = cloneBoard(boardPlan);
    const autoCells = {};
    steps.forEach((s) => {
      applyFill(board, s.fill, autoCells);
      applyFill(board, s.autoFills, autoCells);
    });
    board.hasSecondRow = hasSecond;
    board.numCols = numCols;
    if (!hasSecond) fillAnswerFromRow1(board);
    return { board, steps, row1Val, row2Val, hasSecond, autoCells, numCols };
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
    fillAnswerFromRow1,
    buildCompletedBoard,
  };
});
