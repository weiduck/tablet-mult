/**
 * 直式乘法練習：點選一步一問引擎
 * 康軒數學4上 第02單元「整數的乘法」(N-4-2) 進度：
 * 四位×一位 → 一位×整十／二位 → 整十×整十 → 二位×二位 → 三／四位×二位
 * 位值說明直式合理性；8 題型隨機出題，逐步引擎不變。
 */
(function () {
  "use strict";

  const PLACE_ZH = ["千位", "百位", "十位", "個位"];

  /** 8 題型定義（康軒 N-4-2）；進入／重試時依 constraints 隨機出題 */
  function randInt(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function digits2(n) {
    return { t: Math.floor(n / 10) % 10, o: n % 10 };
  }

  /** 二位×二位：各位相乘是否會產生進位 */
  function hasMultCarry(a, b) {
    const A = digits2(a);
    const B = digits2(b);
    return A.o * B.o >= 10 || A.t * B.o >= 10 || A.o * B.t >= 10 || A.t * B.t >= 10;
  }

  function genUntil(fn, maxTries) {
    maxTries = maxTries || 80;
    for (let i = 0; i < maxTries; i++) {
      const r = fn();
      if (r) return r;
    }
    return fn(true);
  }

  const TYPES = [
    {
      stage: "四位數×一位數（整千）",
      generate() {
        // a = d000；積 ≤ 9999 → d×b ≤ 9
        const pairs = [];
        for (let d = 1; d <= 9; d++) {
          for (let b = 2; b <= 9; b++) {
            if (d * b <= 9) pairs.push({ a: d * 1000, b });
          }
        }
        return pick(pairs);
      },
    },
    {
      stage: "四位數×一位數",
      generate() {
        // 四位皆非 0（與整千／中間有0區隔）；積 < 10000
        return genUntil((force) => {
          const a =
            randInt(1, 9) * 1000 +
            randInt(1, 9) * 100 +
            randInt(1, 9) * 10 +
            randInt(1, 9);
          const maxB = Math.min(9, Math.floor(9999 / a));
          if (maxB < 2) return force ? { a: 1111, b: 2 } : null;
          const b = randInt(2, maxB);
          return { a, b };
        });
      },
    },
    {
      stage: "四位數×一位數（中間有0）",
      generate() {
        // 百位或十位為 0（非整千）；個位≠0；積 < 10000
        return genUntil((force) => {
          const thousands = randInt(1, 9);
          const ones = randInt(1, 9);
          let hundreds;
          let tens;
          if (Math.random() < 0.5) {
            hundreds = 0;
            tens = randInt(0, 9);
          } else {
            tens = 0;
            hundreds = randInt(0, 9);
          }
          // 避免退化成整千
          if (hundreds === 0 && tens === 0) {
            if (Math.random() < 0.5) hundreds = randInt(1, 9);
            else tens = randInt(1, 9);
          }
          const a = thousands * 1000 + hundreds * 100 + tens * 10 + ones;
          const maxB = Math.min(9, Math.floor(9999 / a));
          if (maxB < 2) return force ? { a: 2035, b: 4 } : null;
          return { a, b: randInt(2, maxB) };
        });
      },
    },
    {
      stage: "一位數×整十",
      generate() {
        return { a: randInt(2, 9), b: randInt(1, 9) * 10 };
      },
    },
    {
      stage: "一位數×二位數",
      generate() {
        // 乘數個位≠0（非整十）
        return {
          a: randInt(2, 9),
          b: randInt(1, 9) * 10 + randInt(1, 9),
        };
      },
    },
    {
      stage: "整十×整十",
      generate() {
        return { a: randInt(1, 9) * 10, b: randInt(1, 9) * 10 };
      },
    },
    {
      stage: "二位數×二位數（無進位）",
      generate() {
        // 兩數皆二位、個位≠0；各位相乘皆 < 10（無乘進位）
        return genUntil((force) => {
          const a = randInt(1, 9) * 10 + randInt(1, 9);
          const b = randInt(1, 9) * 10 + randInt(1, 9);
          if (!hasMultCarry(a, b)) return { a, b };
          return force ? { a: 24, b: 12 } : null;
        });
      },
    },
    {
      stage: "二位數×二位數（有進位）",
      generate() {
        // 兩數皆二位、個位≠0；至少一處乘進位；積 ≤ 9999（自然成立）
        return genUntil((force) => {
          const a = randInt(1, 9) * 10 + randInt(1, 9);
          const b = randInt(1, 9) * 10 + randInt(1, 9);
          if (hasMultCarry(a, b)) return { a, b };
          return force ? { a: 48, b: 27 } : null;
        });
      },
    },
  ];

  const DECK = TYPES;

  const CARRY_TIP =
    "進位可記在心裡、手指或紙上；標記時別擋到等一下相加的位置。";

  const state = {
    cardIndex: 0,
    deck: DECK,
    steps: [],
    stepIndex: 0,
    board: null,
    problem: null,
    hintOpen: false,
    locked: false,
    completed: false,
    autoCells: {},
  };

  // ---------- helpers ----------
  function digitsOf(n) {
    return {
      thousands: Math.floor(n / 1000) % 10,
      hundreds: Math.floor(n / 100) % 10,
      tens: Math.floor(n / 10) % 10,
      ones: n % 10,
    };
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function makeChoices(correct) {
    const set = new Set([correct]);
    const near = [correct - 1, correct + 1, correct - 2, correct + 2, 9 - correct]
      .map((x) => ((x % 10) + 10) % 10)
      .filter((x) => x !== correct);
    for (const n of near) {
      if (set.size >= 4) break;
      set.add(n);
    }
    while (set.size < 4) {
      set.add(Math.floor(Math.random() * 10));
    }
    return shuffle([...set]);
  }

  function emptyBoard(a, b) {
    const A = digitsOf(a);
    const B = digitsOf(b);
    return {
      a,
      b,
      product: a * b,
      carry1: [null, null, null, null],
      carry2: [null, null, null, null],
      multiplicand: [
        a >= 1000 ? A.thousands : null,
        a >= 100 ? A.hundreds : null,
        a >= 10 ? A.tens : null,
        A.ones,
      ],
      multiplier: [
        b >= 1000 ? B.thousands : null,
        b >= 100 ? B.hundreds : null,
        b >= 10 ? B.tens : null,
        B.ones,
      ],
      row1: [null, null, null, null],
      row2: [null, null, null, null],
      addCarry: [null, null, null, null],
      answer: [null, null, null, null],
      slots: {
        carry1: [false, false, false, false],
        carry2: [false, false, false, false],
        row1: [false, false, false, false],
        row2: [false, false, false, false],
        addCarry: [false, false, false, false],
        answer: [false, false, false, false],
      },
      hasSecondRow: b >= 10,
    };
  }

  function markSlot(board, row, col) {
    if (col >= 0 && col <= 3 && board.slots[row]) {
      board.slots[row][col] = true;
    }
  }

  /**
   * 康軒位值直式步驟：
   * - 第一排 × 個位；中間進位寫上方；最後高位寫進該排
   * - 第二排 × 十位（其實 ×n0）；整排乘完後學生點選補 0（一步）
   * - 相加從右往左；加法進位自動
   */
  function buildSteps(a, b) {
    const steps = [];
    const boardPlan = emptyBoard(a, b);

    const aDigits = [];
    let n = a;
    let col = 3;
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

        const place = PLACE_ZH[writeCol];
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
              phase: `${phasePrefix}·${PLACE_ZH[hCol]}：最高位`,
              prompt: "看紅圈相乘，再填藍框",
              question: `${prod} 還剩左邊的 ${high}，${PLACE_ZH[hCol]}寫幾？`,
              hint: `乘完後左邊還有 ${high}，把 ${d} 寫在 ${PLACE_ZH[hCol]}（位值對齊）。`,
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
        markSlot(boardPlan, productRow, 3);
        written.push({ col: 3, value: 0 });
        steps.push({
          phase: `${phasePrefix}·個位：補0`,
          prompt: "第二排乘完了，個位補幾？",
          question: "第二排個位要寫幾？",
          hint:
            `第二排乘完才補 0：這排其實是 ×${tensPlaceValue}` +
            `（不是只 ×${bTens}），所以個位對齊寫 0。`,
          answer: 0,
          target: { row: productRow, col: 3 },
          highlights: [{ row: "multiplier", col: multCol }],
          fill: [{ row: productRow, col: 3, value: 0 }],
          autoFills: [],
          kind: "pad-zero",
          tensPlaceValue,
          multDigit,
        });
      }

      let value = 0;
      written.forEach((p) => {
        value += p.value * Math.pow(10, 3 - p.col);
      });
      return value;
    }

    const row1Val = addPartialSteps(bOnes, 3, "carry1", "row1", "第一排", false);
    let row2Val = 0;
    if (hasSecond) {
      row2Val = addPartialSteps(bTens, 2, "carry2", "row2", "第二排", true);
    }

    // ----- 相加（從右往左、逐位） -----
    if (hasSecond) {
      let addCarry = 0;
      const product = a * b;
      const maxCol = product >= 1000 ? 0 : product >= 100 ? 1 : 2;

      for (let c = 3; c >= 0; c--) {
        const d1 = Math.floor(row1Val / Math.pow(10, 3 - c)) % 10;
        const d2 = Math.floor(row2Val / Math.pow(10, 3 - c)) % 10;
        if (c < maxCol && d1 === 0 && d2 === 0 && addCarry === 0) continue;

        const sum = d1 + d2 + addCarry;
        const writeDigit = sum % 10;
        const nextCarry = Math.floor(sum / 10);

        markSlot(boardPlan, "answer", c);

        let question;
        if (d1 === 0 && d2 === 0 && addCarry > 0) {
          question = `0 + 進位 ${addCarry} = ?`;
        } else if (addCarry > 0) {
          question = `${d1} + ${d2} + 進位 ${addCarry} = ${sum}，${PLACE_ZH[c]}寫幾？`;
        } else if (c === 3 && sum < 10) {
          question = `${d1} + ${d2} = ?`;
        } else {
          question = `${d1} + ${d2} = ${sum}，${PLACE_ZH[c]}寫幾？`;
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

        const shortPlace = PLACE_ZH[c];
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
    }

    const product = a * b;
    if (product >= 1000) markSlot(boardPlan, "answer", 0);
    if (product >= 100) markSlot(boardPlan, "answer", 1);
    if (product >= 10) markSlot(boardPlan, "answer", 2);
    markSlot(boardPlan, "answer", 3);

    if (hasSecond) {
      markSlot(boardPlan, "row2", 0);
      markSlot(boardPlan, "addCarry", 0);
      markSlot(boardPlan, "addCarry", 1);
      for (let c = 1; c <= 3; c++) markSlot(boardPlan, "row1", c);
    }

    return { steps, boardPlan, row1Val, row2Val, hasSecond };
  }

  // ---------- Board rendering ----------
  function cellHtml(row, col, board, ui) {
    const key = `${row}-${col}`;
    const val = board[row][col];
    const isSlot = board.slots[row] && board.slots[row][col];
    const isCurrent =
      ui.current && ui.current.row === row && ui.current.col === col;
    const highlighted =
      ui.highlights &&
      ui.highlights.some((h) => h.row === row && h.col === col);
    const isAuto = ui.autoCells && ui.autoCells[key];

    if (row === "multiplicand" || row === "multiplier") {
      if (val === null || val === undefined) {
        return `<div class="cell blank" data-key="${key}"></div>`;
      }
      return `<div class="cell fixed" data-key="${key}">${val}${
        highlighted ? '<span class="ring" aria-hidden="true"></span>' : ""
      }</div>`;
    }

    if (!isSlot && (val === null || val === undefined)) {
      return `<div class="cell blank" data-key="${key}"></div>`;
    }

    if (val !== null && val !== undefined) {
      let cls;
      if (isCurrent) cls = "cell current";
      else if (isAuto) cls = "cell filled auto";
      else cls = "cell filled";
      return `<div class="${cls}" data-key="${key}">${val}</div>`;
    }

    const cls = isCurrent ? "cell current" : "cell empty";
    return `<div class="${cls}" data-key="${key}">&nbsp;</div>`;
  }

  function renderBoard(container, board, ui) {
    ui = ui || {};
    const rows = [
      ["①進位", "carry1"],
      ["②進位", "carry2"],
      ["被乘數", "multiplicand"],
      ["× 乘數", "multiplier"],
      ["__line1__", null],
      ["第一排", "row1"],
      ["第二排", "row2"],
      ["加法進位", "addCarry"],
      ["__line2__", null],
      ["答案", "answer"],
    ];

    let html = "";
    rows.forEach(([label, row]) => {
      if (label === "__line1__" || label === "__line2__") {
        html += `<div class="row-label"></div><div class="hline"></div>`;
        return;
      }
      if (!board.hasSecondRow && (row === "row2" || row === "carry2" || row === "addCarry")) {
        html += `<div class="row-label">${label}</div>`;
        for (let c = 0; c < 4; c++) html += `<div class="cell blank"></div>`;
        return;
      }
      html += `<div class="row-label">${label}</div>`;
      for (let c = 0; c < 4; c++) {
        html += cellHtml(row, c, board, ui);
      }
    });

    // 定位板：千百十個
    html += `<div class="row-label">定位</div>`;
    PLACE_ZH.forEach((p) => {
      html += `<div class="place-label">${p.replace("位", "")}</div>`;
    });

    container.innerHTML = html;
  }

  function cloneBoard(plan) {
    const b = JSON.parse(JSON.stringify(plan));
    ["carry1", "carry2", "row1", "row2", "addCarry", "answer"].forEach((row) => {
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
    const { steps, boardPlan, row1Val, row2Val, hasSecond } = buildSteps(a, b);
    const board = JSON.parse(JSON.stringify(boardPlan));
    const autoCells = {};
    ["carry1", "carry2", "row1", "row2", "addCarry", "answer"].forEach((row) => {
      board[row] = board[row].map(() => null);
    });
    steps.forEach((s) => {
      applyFill(board, s.fill, autoCells);
      applyFill(board, s.autoFills, autoCells);
    });
    if (!hasSecond) {
      for (let c = 0; c < 4; c++) {
        if (board.row1[c] !== null) {
          board.answer[c] = board.row1[c];
          board.slots.answer[c] = true;
        }
      }
    }
    board.hasSecondRow = hasSecond;
    return { board, steps, row1Val, row2Val, hasSecond, autoCells };
  }

  // ---------- Practice ----------
  function currentProblem() {
    return state.deck[state.cardIndex % state.deck.length];
  }

  function renderDeckJump() {
    const list = document.getElementById("deckJumpList");
    if (!list) return;
    list.innerHTML = "";
    state.deck.forEach((type, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "deck-jump-btn";
      btn.setAttribute("role", "option");
      btn.dataset.index = String(i);
      const stage = type.stage
        ? `<span class="dj-stage">${type.stage}</span>`
        : "";
      btn.innerHTML =
        `<span class="dj-num">題型 ${i + 1}</span>` + stage;
      btn.setAttribute(
        "aria-label",
        `題型 ${i + 1}` + (type.stage ? ` ${type.stage}` : "")
      );
      btn.addEventListener("click", () => startCard(i));
      list.appendChild(btn);
    });
    const randomBtn = document.createElement("button");
    randomBtn.type = "button";
    randomBtn.className = "deck-jump-btn deck-jump-random";
    randomBtn.setAttribute("aria-label", "隨機題型");
    randomBtn.innerHTML = `<span class="dj-num">隨機</span>`;
    randomBtn.addEventListener("click", () => {
      const n = state.deck.length;
      const i = Math.floor(Math.random() * n);
      startCard(i);
    });
    list.appendChild(randomBtn);
    markDeckJumpCurrent();
  }

  function markDeckJumpCurrent() {
    const list = document.getElementById("deckJumpList");
    if (!list) return;
    list.querySelectorAll(".deck-jump-btn:not(.deck-jump-random)").forEach((btn) => {
      const i = Number(btn.dataset.index);
      const on = i === state.cardIndex;
      btn.classList.toggle("is-current", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function wrongFeedback(step) {
    if (step.kind === "tens-row" && step.tensPlaceValue) {
      return `還差一點。這排是乘十位（其實 ×${step.tensPlaceValue}，不是只 ×${step.multDigit}），看看藍框的位值再選。`;
    }
    if (step.kind === "carry") {
      return `還差一點。進位是十位那個數字；可記心裡／手指／紙上，別擋到相加。`;
    }
    if (step.kind === "add") {
      return `還差一點。從右往左逐位相加，看看藍框的位值再選。`;
    }
    return "還差一點。看看藍框所在的位值，再選一次。";
  }

  function startCard(index) {
    state.cardIndex = index;
    state.hintOpen = false;
    state.locked = false;
    state.completed = false;
    state.autoCells = {};

    const type = currentProblem();
    const generated = type.generate();
    const a = generated.a;
    const b = generated.b;
    const stage = type.stage || "";
    const built = buildSteps(a, b);
    state.steps = built.steps;
    state.stepIndex = 0;
    state.problem = {
      a,
      b,
      stage,
      row1Val: built.row1Val,
      row2Val: built.row2Val,
      hasSecond: built.hasSecond,
    };
    state.board = cloneBoard(built.boardPlan);
    state.board.hasSecondRow = built.hasSecond;
    state.board.slots = JSON.parse(JSON.stringify(built.boardPlan.slots));

    document.getElementById("stepActive").classList.remove("hidden");
    document.getElementById("stepComplete").classList.add("hidden");
    markDeckJumpCurrent();
    document.getElementById("practiceTitle").textContent =
      `題型 ${index + 1}：${stage}`;
    document.getElementById("practiceProblemPill").textContent = `${a} × ${b} = ?`;
    document.getElementById("footerNote").textContent =
      "每個題型會隨機出題。完成後可再練一次；點錯沒關係，可以再選一次。";
    renderStep();
  }

  function renderStep() {
    const total = state.steps.length;
    if (state.stepIndex >= total) {
      showComplete();
      return;
    }
    const step = state.steps[state.stepIndex];
    document.getElementById("stepLabel").textContent = `第 ${state.stepIndex + 1} 步，共 ${total} 步`;
    document.getElementById("progressFill").style.width = `${(state.stepIndex / total) * 100}%`;
    document.getElementById("phaseLabel").textContent = step.phase;
    document.getElementById("questionText").textContent = step.question;
    document.getElementById("boardPrompt").textContent = step.prompt;

    const fb = document.getElementById("feedback");
    fb.className = "feedback";
    fb.textContent = "";

    const hintBox = document.getElementById("hintBox");
    hintBox.textContent = step.hint;
    hintBox.classList.toggle("show", state.hintOpen);
    const hintBtn = document.getElementById("hintBtn");
    hintBtn.textContent = state.hintOpen ? "收起提示" : "給我一個提示";
    hintBtn.classList.toggle("active", state.hintOpen);

    const choices = document.getElementById("choices");
    choices.innerHTML = "";
    makeChoices(step.answer).forEach((n) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice";
      btn.textContent = String(n);
      btn.addEventListener("click", () => onChoose(n, btn));
      choices.appendChild(btn);
    });

    renderBoard(document.getElementById("practiceBoard"), state.board, {
      current: step.target,
      highlights: step.highlights || [],
      autoCells: state.autoCells,
    });

    state.locked = false;
  }

  function onChoose(n, btn) {
    if (state.locked || state.completed) return;
    const step = state.steps[state.stepIndex];
    const fb = document.getElementById("feedback");

    if (n !== step.answer) {
      btn.classList.add("wrong");
      fb.className = "feedback show wrong";
      fb.textContent = wrongFeedback(step);
      document.getElementById("footerNote").textContent = "點錯沒關係，可以再選一次。";
      return;
    }

    state.locked = true;
    btn.classList.add("correct");
    document.querySelectorAll(".choice").forEach((el) => {
      el.disabled = true;
    });
    fb.className = "feedback show correct";
    fb.textContent = "答對了！數字已經填進正確的位置。";

    applyFill(state.board, step.fill, state.autoCells);
    applyFill(state.board, step.autoFills, state.autoCells);

    renderBoard(document.getElementById("practiceBoard"), state.board, {
      current: null,
      highlights: [],
      autoCells: state.autoCells,
    });

    window.setTimeout(() => {
      state.stepIndex += 1;
      state.hintOpen = false;
      if (state.stepIndex >= state.steps.length) {
        showComplete();
      } else {
        renderStep();
      }
    }, 1200);
  }

  function showComplete() {
    state.completed = true;
    const { a, b, row1Val, row2Val, hasSecond } = state.problem;
    const product = a * b;

    if (!hasSecond) {
      for (let c = 0; c < 4; c++) {
        if (state.board.row1[c] !== null) {
          state.board.answer[c] = state.board.row1[c];
          state.board.slots.answer[c] = true;
        }
      }
    }

    document.getElementById("boardPrompt").textContent = "完成的直式";
    renderBoard(document.getElementById("practiceBoard"), state.board, {
      current: null,
      highlights: [],
      autoCells: state.autoCells,
    });

    document.getElementById("progressFill").style.width = "100%";
    document.getElementById("stepLabel").textContent = `第 ${state.steps.length} 步，共 ${state.steps.length} 步`;

    document.getElementById("stepActive").classList.add("hidden");
    document.getElementById("stepComplete").classList.remove("hidden");

    if (hasSecond) {
      document.getElementById("completeSum").textContent = `${row1Val} + ${row2Val} = ${product}`;
      document.getElementById("completeSum").classList.remove("hidden");
    } else {
      document.getElementById("completeSum").textContent = `第一排就是答案 ${product}`;
    }
    document.getElementById("completeEq").textContent = `${a} × ${b} = ${product}`;

    const nextBtn = document.getElementById("nextCardBtn");
    nextBtn.textContent = "再練一次";
  }

  // ---------- tablet chrome: scroll lock + landscape gate ----------
  function isLandscape() {
    if (window.matchMedia) {
      if (window.matchMedia("(orientation: landscape)").matches) return true;
      if (window.matchMedia("(orientation: portrait)").matches) return false;
    }
    if (typeof window.orientation === "number") {
      return Math.abs(window.orientation) === 90;
    }
    return window.innerWidth >= window.innerHeight;
  }

  function updateOrientOverlay() {
    const el = document.getElementById("rotateOverlay");
    if (!el) return;
    const show = !isLandscape();
    if (show) {
      el.removeAttribute("hidden");
      document.documentElement.classList.add("is-portrait");
    } else {
      el.setAttribute("hidden", "");
      document.documentElement.classList.remove("is-portrait");
    }
  }

  function installScrollGuards() {
    document.addEventListener(
      "touchmove",
      (e) => {
        let node = e.target;
        while (node && node !== document.body && node !== document.documentElement) {
          if (node.classList && node.classList.contains("scroll-ok")) {
            const style = window.getComputedStyle(node);
            const canY =
              (style.overflowY === "auto" || style.overflowY === "scroll") &&
              node.scrollHeight > node.clientHeight + 1;
            if (canY) return;
            break;
          }
          node = node.parentNode;
        }
        e.preventDefault();
      },
      { passive: false }
    );

    const blockGesture = (e) => e.preventDefault();
    document.addEventListener("gesturestart", blockGesture, { passive: false });
    document.addEventListener("gesturechange", blockGesture, { passive: false });
    document.addEventListener("gestureend", blockGesture, { passive: false });

    document.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches && e.touches.length > 1) e.preventDefault();
      },
      { passive: false }
    );
  }

  function init() {
    renderDeckJump();
    startCard(0);

    document.getElementById("hintBtn").addEventListener("click", () => {
      state.hintOpen = !state.hintOpen;
      const step = state.steps[state.stepIndex];
      if (!step) return;
      const hintBox = document.getElementById("hintBox");
      hintBox.textContent = step.hint;
      hintBox.classList.toggle("show", state.hintOpen);
      const hintBtn = document.getElementById("hintBtn");
      hintBtn.textContent = state.hintOpen ? "收起提示" : "給我一個提示";
      hintBtn.classList.toggle("active", state.hintOpen);
    });
    document.getElementById("nextCardBtn").addEventListener("click", () => {
      // 留在同一題型；startCard 會呼叫 generate() 重抽 a×b
      startCard(state.cardIndex);
    });

    installScrollGuards();
    updateOrientOverlay();
    window.addEventListener("resize", updateOrientOverlay);
    window.addEventListener("orientationchange", updateOrientOverlay);
    if (window.matchMedia) {
      const mq = window.matchMedia("(orientation: landscape)");
      if (mq.addEventListener) mq.addEventListener("change", updateOrientOverlay);
      else if (mq.addListener) mq.addListener(updateOrientOverlay);
    }
  }

  window.MuseMult = {
    buildSteps,
    buildCompletedBoard,
    digitsOf,
    makeChoices,
    TYPES,
    DECK,
    hasMultCarry,
  };

  if (typeof document !== "undefined" && document.readyState !== "loading") {
    init();
  } else if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
