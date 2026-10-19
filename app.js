/**
 * 直式乘法練習：點選一步一問（DOM／UI）
 * 康軒數學4上 第02單元「整數的乘法」(N-4-2) 資料冊 12 學習目標題型
 * 進位／無進位為題型內隨機難度（非獨立按鈕）。直式板依積位數加寬（可至六位）。
 * 純邏輯（題型、產生器、步驟引擎）在 mult-core.js（window.MultCore），須先載入。
 */
(function () {
  "use strict";

  const Core = window.MultCore;
  const { MIN_COLS, placeShort, makeChoices, cloneBoard, applyFill, fillAnswerFromRow1 } = Core;
  const DECK = Core.DECK;

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
    const numCols = board.numCols || MIN_COLS;
    const shorts = placeShort(numCols);
    container.className = "board board--cols-" + numCols;
    container.style.gridTemplateColumns =
      "minmax(68px, 84px) repeat(" + numCols + ", minmax(42px, 1fr))";
    container.style.maxWidth = numCols <= 4 ? "440px" : numCols === 5 ? "520px" : "600px";

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
        for (let c = 0; c < numCols; c++) html += `<div class="cell blank"></div>`;
        return;
      }
      html += `<div class="row-label">${label}</div>`;
      for (let c = 0; c < numCols; c++) {
        html += cellHtml(row, c, board, ui);
      }
    });

    html += `<div class="row-label">定位</div>`;
    shorts.forEach((p) => {
      html += `<div class="place-label">${p.replace(/位$/, "")}</div>`;
    });

    container.innerHTML = html;
  }

  // ---------- Practice ----------
  function currentProblem() {
    return state.deck[state.cardIndex % state.deck.length];
  }

  function renderDeckJump() {
    const list = document.getElementById("deckJumpList");
    if (!list) return;
    list.innerHTML = "";
    const mid = Math.ceil(state.deck.length / 2);
    const row1 = document.createElement("div");
    row1.className = "deck-jump-row";
    const row2 = document.createElement("div");
    row2.className = "deck-jump-row";
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
      (i < mid ? row1 : row2).appendChild(btn);
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
    row2.appendChild(randomBtn);
    list.appendChild(row1);
    list.appendChild(row2);
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
    clearTimers();
    state.cardToken += 1;
    state.cardIndex = index;
    state.hintOpen = false;
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
    };
    state.board = cloneBoard(built.boardPlan);
    state.board.hasSecondRow = built.hasSecond;
    state.board.numCols = built.numCols;

    document.getElementById("stepActive").classList.remove("hidden");
    document.getElementById("stepComplete").classList.add("hidden");
    markDeckJumpCurrent();
    document.getElementById("practiceProblemPill").textContent = `${a} × ${b} = ?`;
    document.getElementById("footerNote").textContent =
      "每個題型會隨機出題（進位為難度變化）。完成後可再練一次；點錯沒關係，可以再選一次。";
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

    const token = state.cardToken;
    later(() => {
      if (token !== state.cardToken) return;
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

    if (!hasSecond) fillAnswerFromRow1(state.board);

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
    document.getElementById("refreshProblemBtn").addEventListener("click", () => {
      // 同題型重抽 a×b，進度重置與新題相同
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

  if (typeof document !== "undefined" && document.readyState !== "loading") {
    init();
  } else if (typeof document !== "undefined") {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
