/**
 * 直式乘法練習：點選一步一問（DOM／UI）
 * 康軒數學4上 第02單元「整數的乘法」(N-4-2) 資料冊 12 學習目標題型
 * 進位／無進位為題型內隨機難度（非獨立按鈕）。直式板依積位數加寬（可至六位）。
 * 純邏輯（題型、產生器、步驟引擎）在 mult-core.js（window.MultCore），須先載入。
 */
(function () {
  "use strict";

  const Core = window.MultCore;
  const { MIN_COLS, HINT_LEVELS, placeShort, buildChoices, genericWrong, cloneBoard, applyFill } = Core;
  const DECK = Core.DECK;

  // 答對後停多久才換下一步（毫秒）；系統設定「減少動態效果」時縮短
  const ADVANCE_DELAY_MS = { normal: 1600, reducedMotion: 600 };

  // 直式板格子邊長：至少 MIN_CELL（觸控目標），放不下就在直式板區內捲動
  const MIN_CELL = 44;
  const MAX_CELL = 64;

  function prefersReducedMotion() {
    return !!(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function advanceDelay() {
    return prefersReducedMotion() ? ADVANCE_DELAY_MS.reducedMotion : ADVANCE_DELAY_MS.normal;
  }

  const state = {
    cardIndex: 0,
    deck: DECK,
    steps: [],
    stepIndex: 0,
    board: null,
    problem: null,
    hintLevel: 0, // 0 = 收起；1–3 = 已打開到第幾層
    wrongCount: 0, // 同一步點錯幾次
    why: {}, // 錯的選項 → 錯因回饋
    locked: false,
    completed: false,
    autoCells: {},
    timers: [],
    cardToken: 0,
  };

  function later(fn, ms) {
    state.timers.push(window.setTimeout(fn, ms));
  }

  function clearTimers() {
    state.timers.forEach((t) => window.clearTimeout(t));
    state.timers = [];
  }

  // ---------- Board rendering ----------
  function cellHtml(row, col, board, ui) {
    const key = `${row}-${col}`;
    const val = board[row][col];
    const isSlot = board.slots[row] && board.slots[row][col];
    const isCurrent =
      ui.current && ui.current.row === row && ui.current.col === col;
    const highlighted =
      ui.highlights && ui.highlights.find((h) => h.row === row && h.col === col);
    const isAuto = ui.autoCells && ui.autoCells[key];
    // 紅圈＝正在相乘／相加的數；虛線圈＝要加上的進位
    const ring = highlighted
      ? `<span class="ring${highlighted.carry ? " ring--carry" : ""}" aria-hidden="true"></span>`
      : "";

    if (row === "multiplicand" || row === "multiplier") {
      if (val === null || val === undefined) {
        return `<div class="cell blank" data-key="${key}"></div>`;
      }
      return `<div class="cell fixed" data-key="${key}">${val}${ring}</div>`;
    }

    if (!isSlot && (val === null || val === undefined)) {
      return `<div class="cell blank" data-key="${key}"></div>`;
    }

    if (val !== null && val !== undefined) {
      let cls;
      if (isCurrent) cls = "cell current";
      else if (isAuto) cls = "cell filled auto";
      else cls = "cell filled";
      return `<div class="${cls}" data-key="${key}">${val}${ring}</div>`;
    }

    if (isCurrent) {
      return `<div class="cell current" data-key="${key}" role="img" aria-label="${ui.currentLabel || "目前要填"}">&nbsp;</div>`;
    }
    return `<div class="cell empty" data-key="${key}">&nbsp;</div>`;
  }

  /** 目前要填那一格給螢幕閱讀器的名稱，例如「第一排 十位，目前要填」 */
  function currentCellLabel(board, target) {
    const twoRow = board.hasSecondRow;
    const rowNames = {
      carry1: twoRow ? "第一排進位" : "進位",
      carry2: "第二排進位",
      row1: "第一排",
      row2: "第二排",
      addCarry: "加法進位",
      answer: "答案",
    };
    const place = placeShort(board.numCols || MIN_COLS)[target.col] || "";
    return `${rowNames[target.row] || ""} ${place}，目前要填`;
  }

  function renderBoard(container, board, ui) {
    ui = ui || {};
    const numCols = board.numCols || MIN_COLS;
    const shorts = placeShort(numCols);
    container.className = "board board--cols-" + numCols;
    container.style.gridTemplateColumns = `var(--label-w) repeat(${numCols}, var(--cell))`;
    if (ui.current) ui.currentLabel = currentCellLabel(board, ui.current);

    const twoRow = board.hasSecondRow;
    const labels = {
      carry1: twoRow ? "①進位" : "進位",
      carry2: "②進位",
      multiplicand: "被乘數",
      multiplier: "× 乘數",
      row1: "第一排",
      row2: "第二排",
      addCarry: "加法進位",
      answer: "答案",
    };
    const hline = `<div class="row-label"></div><div class="hline"></div>`;

    // 只畫這一題用得到的列（乘數一位、整十捷徑：沒有第二排與加法進位）
    let html = "";
    board.visibleRows.forEach((row) => {
      html += `<div class="row-label">${labels[row]}</div>`;
      for (let c = 0; c < numCols; c++) {
        html += cellHtml(row, c, board, ui);
      }
      if (row === "multiplier" || (twoRow && row === "addCarry")) html += hline;
    });

    html += `<div class="row-label">定位</div>`;
    shorts.forEach((p) => {
      html += `<div class="place-label">${p.replace(/位$/, "")}</div>`;
    });

    container.innerHTML = html;
  }

  /**
   * 依直式板區的可用空間算格子大小（整題固定：這題要畫的列與欄數不會變）。
   * 格子介於 MIN_CELL～MAX_CELL；放不下時不再縮小，改讓 .board-area 內部捲動。
   */
  function fitBoard() {
    const area = document.getElementById("boardArea");
    const board = state.board;
    if (!area || !board) return;
    const numCols = board.numCols || MIN_COLS;
    const rows = board.visibleRows.length;
    const lines = board.visibleRows.filter(
      (r) => r === "multiplier" || (board.hasSecondRow && r === "addCarry")
    ).length;
    const rowGap = 6;
    const colGap = 5;
    const H = area.clientHeight - 16;
    const W = area.clientWidth - 16;
    // 列：格子列＋定位列（約 0.5 格）＋橫線；欄：列名約 1.45 格寬＋每欄一格
    const byH = (H - (rows + lines + 1) * rowGap) / (rows + 0.5 + lines * 0.1);
    const byW = (W - numCols * colGap) / (numCols + 1.45);
    const cell = Math.floor(Math.max(MIN_CELL, Math.min(MAX_CELL, byH, byW)));
    area.style.setProperty("--cell", cell + "px");
    revealCurrent();
  }

  /**
   * 只捲 area 本身，讓 el 進入可見範圍（scrollIntoView 可能連外層 overflow:hidden 的卡片一起捲）。
   * el 比 area 高時對齊上緣。
   */
  function scrollIntoArea(area, el) {
    if (!area || !el) return;
    const a = area.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    const pad = 8;
    if (c.top < a.top || c.height > a.height - pad * 2) area.scrollTop -= a.top - c.top + pad;
    else if (c.bottom > a.bottom) area.scrollTop += c.bottom - a.bottom + pad;
    if (c.left < a.left) area.scrollLeft -= a.left - c.left + pad;
    else if (c.right > a.right) area.scrollLeft += c.right - a.right + pad;
  }

  /** 直式板區有捲動時，把目前要填的格子捲進畫面 */
  function revealCurrent() {
    const area = document.getElementById("boardArea");
    scrollIntoArea(area, area && area.querySelector(".cell.current"));
  }

  /** 步驟區放不下時（直向、打開多層提示），把提示框連同下方的提示按鈕捲進畫面 */
  function revealHint() {
    const panel = document.getElementById("stepPanel");
    const box = document.getElementById("hintBox");
    if (!box.classList.contains("show")) return;
    // 版面（直式板縮小、格子重算）穩定後再捲
    window.requestAnimationFrame(() => {
      scrollIntoArea(panel, document.getElementById("hintBtn"));
      scrollIntoArea(panel, box);
    });
  }

  // ---------- Practice ----------
  function currentProblem() {
    return state.deck[state.cardIndex % state.deck.length];
  }

  function renderDeckJump() {
    const list = document.getElementById("deckJumpList");
    if (!list) return;
    list.innerHTML = "";
    // 一般的按鈕群組：目前題型用 aria-pressed 標示；排版（每列幾個）交給 CSS grid
    state.deck.forEach((type, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "deck-jump-btn";
      btn.dataset.index = String(i);
      const full = type.stage ? `題型 ${i + 1}：${type.stage}` : `題型 ${i + 1}`;
      btn.title = full;
      btn.setAttribute("aria-label", full);
      const stage = type.stage
        ? `<span class="dj-stage">${type.stage}</span>`
        : "";
      btn.innerHTML =
        `<span class="dj-num">題型 ${i + 1}</span>` + stage;
      btn.addEventListener("click", () => startCard(i));
      list.appendChild(btn);
    });
    markDeckJumpCurrent();
  }

  function markDeckJumpCurrent() {
    const list = document.getElementById("deckJumpList");
    if (!list) return;
    list.querySelectorAll(".deck-jump-btn").forEach((btn) => {
      const i = Number(btn.dataset.index);
      const on = i === state.cardIndex;
      btn.classList.toggle("is-current", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function startCard(index) {
    clearTimers();
    state.cardToken += 1;
    state.cardIndex = index;
    state.hintLevel = 0;
    state.wrongCount = 0;
    state.locked = false;
    state.completed = false;
    state.autoCells = {};

    const type = currentProblem();
    const generated = Core.generate(state.cardIndex % state.deck.length);
    const a = generated.a;
    const b = generated.b;
    const stage = type.stage || "";
    const built = Core.buildSteps(a, b);
    state.steps = built.steps;
    state.stepIndex = 0;
    state.problem = {
      a,
      b,
      stage,
      row1Val: built.row1Val,
      row2Val: built.row2Val,
      hasSecond: built.hasSecond,
      numCols: built.numCols,
      mode: built.mode,
      steps: built.steps,
    };
    state.board = cloneBoard(built.boardPlan);

    document.getElementById("stepActive").classList.remove("hidden");
    document.getElementById("stepComplete").classList.add("hidden");
    markDeckJumpCurrent();
    document.getElementById("practiceProblemPill").textContent = `${a} × ${b} = ?`;
    document.getElementById("footerNote").textContent =
      "每個題型會隨機出題（進位為難度變化）。完成後可再練一次；點錯沒關係，可以再選一次。";
    renderStep();
    fitBoard();
  }

  function renderStep() {
    const total = state.steps.length;
    if (state.stepIndex >= total) {
      showComplete();
      return;
    }
    const step = state.steps[state.stepIndex];
    document.getElementById("stepPanel").scrollTop = 0;
    document.getElementById("stepLabel").textContent = `第 ${state.stepIndex + 1} 步，共 ${total} 步`;
    document.getElementById("progressFill").style.width = `${(state.stepIndex / total) * 100}%`;
    document.getElementById("phaseLabel").textContent = step.phase;
    document.getElementById("questionText").textContent = step.question;
    document.getElementById("boardPrompt").textContent = step.prompt;

    // 進位小提醒：每張卡只在第一個進位步驟出現
    const tip = document.getElementById("tipText");
    tip.textContent = step.tip || "";
    tip.classList.toggle("hidden", !step.tip);

    const fb = document.getElementById("feedback");
    fb.className = "feedback";
    fb.textContent = "";

    state.wrongCount = 0;
    renderHint();

    const choices = document.getElementById("choices");
    choices.innerHTML = "";
    const built = buildChoices(step);
    state.why = built.why;
    built.values.forEach((n) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice";
      btn.dataset.value = String(n);
      btn.textContent = String(n);
      btn.addEventListener("click", () => onChoose(n, btn));
      choices.appendChild(btn);
    });

    renderBoard(document.getElementById("practiceBoard"), state.board, {
      current: step.target,
      highlights: step.highlights || [],
      autoCells: state.autoCells,
    });
    revealCurrent();

    state.locked = false;
  }

  function onChoose(n, btn) {
    if (state.locked || state.completed) return;
    const step = state.steps[state.stepIndex];
    const fb = document.getElementById("feedback");

    if (n !== step.answer) {
      btn.classList.add("wrong");
      btn.disabled = true; // 同一個錯的選項不用再點
      state.wrongCount += 1;
      fb.className = "feedback show wrong";
      fb.textContent = state.why[n] || genericWrong(step);
      // 錯 2 次：自動打開第 2 層提示（已打開就再往下一層）；錯 3 次：第 3 層＋框出正確選項
      if (state.wrongCount >= 2) {
        state.hintLevel = Math.min(HINT_LEVELS, Math.max(state.hintLevel + 1, state.wrongCount));
        renderHint();
        revealHint();
      }
      if (state.wrongCount >= 3) {
        const right = document.querySelector(`.choice[data-value="${step.answer}"]`);
        if (right) right.classList.add("suggest");
      }
      document.getElementById("footerNote").textContent = "點錯沒關係，可以再選一次。";
      return;
    }

    state.locked = true;
    btn.classList.remove("suggest");
    btn.classList.add("correct");
    document.querySelectorAll(".choice").forEach((el) => {
      el.disabled = true;
    });
    fb.className = "feedback show correct";
    fb.textContent = `答對了！${step.reveal}`;

    applyFill(state.board, step.fill, state.autoCells);
    applyFill(state.board, step.autoFills, state.autoCells);

    renderBoard(document.getElementById("practiceBoard"), state.board, {
      current: null,
      highlights: [],
      autoCells: state.autoCells,
    });

    const token = state.cardToken;
    later(() => {
      if (token !== state.cardToken) return;
      state.stepIndex += 1;
      state.hintLevel = 0;
      if (state.stepIndex >= state.steps.length) {
        showComplete();
      } else {
        renderStep();
      }
    }, advanceDelay());
  }

  /** 提示框顯示第 1 層到目前這一層；按鈕標示「提示 n/3」 */
  function renderHint() {
    const step = state.steps[state.stepIndex];
    const hintBox = document.getElementById("hintBox");
    const hintBtn = document.getElementById("hintBtn");
    const level = state.hintLevel;
    hintBox.innerHTML = "";
    if (step && level > 0) {
      step.hints.slice(0, level).forEach((text, i) => {
        const p = document.createElement("p");
        p.className = "hint-line";
        const tag = document.createElement("span");
        tag.className = "hint-tag";
        tag.textContent = `提示 ${i + 1}/${HINT_LEVELS}`;
        p.appendChild(tag);
        p.appendChild(document.createTextNode(text));
        hintBox.appendChild(p);
      });
    }
    hintBox.classList.toggle("show", level > 0);
    if (level === 0) hintBtn.textContent = "給我一個提示";
    else if (level < HINT_LEVELS) hintBtn.textContent = `提示 ${level}/${HINT_LEVELS}・再給一個提示`;
    else hintBtn.textContent = `提示 ${level}/${HINT_LEVELS}・收起提示`;
    hintBtn.classList.toggle("active", level > 0);
    hintBtn.setAttribute("aria-expanded", level > 0 ? "true" : "false");
  }

  function showComplete() {
    state.completed = true;
    const { a, b, row1Val, row2Val, mode, steps } = state.problem;
    const product = a * b;

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
    document.getElementById("stepPanel").scrollTop = 0;

    const sum = document.getElementById("completeSum");
    const note = document.getElementById("completeNote");
    if (mode === "two-row") {
      sum.textContent = `${row1Val} + ${row2Val} = ${product}`;
      note.textContent = "位值對齊：個位排 → 十位排（幾個十，個位放 0）→ 從右往左相加。";
    } else if (mode === "shortcut") {
      const c = steps[0].calc;
      const v = c.d * c.m;
      sum.textContent = `${c.d} × ${c.m} = ${v}，再補上 ${c.zeros} 個 0`;
      note.textContent = `${v} 個${c.unit}就是 ${product}：先乘不是 0 的數字，再補 0。`;
    } else {
      sum.textContent = `乘出來這一排就是答案 ${product}`;
      note.textContent = "位值對齊：從個位開始乘，進位寫在上方小格。";
    }
    document.getElementById("completeEq").textContent = `${a} × ${b} = ${product}`;

    const nextBtn = document.getElementById("nextCardBtn");
    nextBtn.textContent = "再練一次";
  }

  // ---------- 平板：鎖橡皮筋捲動（直向橫向都可用；不擋縮放） ----------
  function installScrollGuards() {
    const scrollable = (style, axis, node) =>
      (style[axis] === "auto" || style[axis] === "scroll") &&
      (axis === "overflowY"
        ? node.scrollHeight > node.clientHeight + 1
        : node.scrollWidth > node.clientWidth + 1);

    document.addEventListener(
      "touchmove",
      (e) => {
        // 兩指以上＝雙指縮放：一律放行
        if (e.touches && e.touches.length > 1) return;
        // 已放大時單指要能拖動畫面
        if (window.visualViewport && window.visualViewport.scale > 1.01) return;
        let node = e.target;
        while (node && node !== document.body && node !== document.documentElement) {
          if (node.classList && node.classList.contains("scroll-ok")) {
            const style = window.getComputedStyle(node);
            if (scrollable(style, "overflowY", node) || scrollable(style, "overflowX", node)) return;
            break;
          }
          node = node.parentNode;
        }
        e.preventDefault();
      },
      { passive: false }
    );
  }

  // ---------- 離線：service worker（file:// 不註冊） ----------
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const { protocol, hostname } = window.location;
    const local = hostname === "localhost" || hostname === "127.0.0.1";
    if (!(protocol === "https:" || (protocol === "http:" && local))) return;
    const register = () => navigator.serviceWorker.register("./sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register);
  }

  function init() {
    renderDeckJump();
    startCard(0);

    document.getElementById("hintBtn").addEventListener("click", () => {
      if (!state.steps[state.stepIndex] || state.completed) return;
      // 0 → 1 → 2 → 3 → 收起 → 1 …
      state.hintLevel = (state.hintLevel + 1) % (HINT_LEVELS + 1);
      renderHint();
      revealHint();
    });
    document.getElementById("nextCardBtn").addEventListener("click", () => {
      // 留在同一題型；startCard 會呼叫 generate() 重抽 a×b
      startCard(state.cardIndex);
    });
    document.getElementById("refreshProblemBtn").addEventListener("click", () => {
      // 同題型重抽 a×b，進度重置與新題相同
      startCard(state.cardIndex);
    });

    installScrollGuards();
    window.addEventListener("resize", fitBoard);
    window.addEventListener("orientationchange", () => window.setTimeout(fitBoard, 200));
    if (window.ResizeObserver) {
      new ResizeObserver(fitBoard).observe(document.getElementById("boardArea"));
    }
    registerServiceWorker();
  }

  if (typeof document !== "undefined" && document.readyState !== "loading") {
    init();
  } else if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
