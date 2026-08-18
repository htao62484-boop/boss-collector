(function () {
  if (window.__bzpCollectorInjected) {
    try {
      if (typeof window.__bzpEnsureFloatingBadge === "function") {
        window.__bzpEnsureFloatingBadge();
      }
    } catch (_err) {
      // ignore
    }
    return;
  }
  window.__bzpCollectorInjected = true;

  const STYLE_ID = "bzp-collector-style";
  const HIGHLIGHT_CLASS = "bzp-current-target";
  const FLOAT_ID = "bzp-floating-badge";
  const FLOAT_POS_KEY = "bzp.float.position.v1";
  const ENABLE_FLOATING_BADGE = false;

  let overlayDismissed = false;

  const FILTER_TEXTS = ["有交换", "交换微信", "交换联系方式"];
  const MORE_TEXTS = ["更多", "展开"];

  const JOB_SELECTORS = [
    ".chat-position-content .position-name",
    ".position-content .position-name",
    ".position-name",
    ".top-info-content [class*='position']",
    ".top-info-content [class*='title']",
  ];

  const HR_SELECTORS = [
    ".top-info-content .name-text",
    ".user-info-wrap .name-text",
    ".top-info-content [class*='name']",
    ".chat-user-info [class*='name']",
  ];

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hashText(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `h${(hash >>> 0).toString(16)}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 100 &&
      rect.height > 28 &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  }

  function isUiVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 8 &&
      rect.height > 8 &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      style.opacity !== "0"
    );
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        outline: 2px solid #8b5e3c !important;
        outline-offset: -2px !important;
        background: rgba(139, 94, 60, 0.16) !important;
        box-shadow: inset 0 0 0 1px rgba(255, 247, 235, 0.72), 0 0 0 2px rgba(139, 94, 60, 0.14) !important;
        border-radius: 8px !important;
      }
      #${FLOAT_ID} {
        position: fixed !important;
        top: 14px;
        right: 14px;
        left: auto;
        z-index: 2147483646 !important;
        width: 46px !important;
        height: 46px !important;
        pointer-events: auto !important;
        touch-action: none !important;
      }
      #${FLOAT_ID}.bzp-running .bzp-float-main {
        animation: bzpFloatRun 1.45s ease-in-out infinite !important;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.34) !important;
      }
      #${FLOAT_ID}.bzp-dragging .bzp-float-main {
        transform: scale(1.05) !important;
        animation: none !important;
      }
      #${FLOAT_ID} .bzp-float-main {
        width: 44px !important;
        height: 44px !important;
        border-radius: 50% !important;
        background: #0b0b0b !important;
        color: #fff !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 18px !important;
        font-weight: 700 !important;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.28) !important;
        user-select: none !important;
        cursor: pointer !important;
        transition: transform 0.18s ease, box-shadow 0.2s ease, filter 0.2s ease !important;
        animation: bzpFloatIdle 3s ease-in-out infinite !important;
      }
      #${FLOAT_ID} .bzp-float-main:hover {
        transform: translateY(-1px) scale(1.03) !important;
        filter: brightness(1.06) !important;
      }
      #${FLOAT_ID} .bzp-float-close {
        position: absolute !important;
        top: -6px !important;
        right: -6px !important;
        width: 18px !important;
        height: 18px !important;
        border-radius: 50% !important;
        border: 1px solid rgba(255, 255, 255, 0.32) !important;
        background: #000 !important;
        color: #fff !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 12px !important;
        line-height: 1 !important;
        cursor: pointer !important;
        opacity: 0.94 !important;
        transition: transform 0.14s ease, opacity 0.14s ease !important;
      }
      #${FLOAT_ID} .bzp-float-close:hover {
        transform: scale(1.08) !important;
        opacity: 1 !important;
      }
      @keyframes bzpFloatIdle {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-1px); }
      }
      @keyframes bzpFloatRun {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.06); }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function removeFloatingBadge() {
    const node = document.getElementById(FLOAT_ID);
    if (node && node.parentElement) node.parentElement.removeChild(node);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function loadFloatingPosition() {
    try {
      const raw = window.localStorage.getItem(FLOAT_POS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed.left !== "number" || typeof parsed.top !== "number") return null;
      return parsed;
    } catch (_err) {
      return null;
    }
  }

  function saveFloatingPosition(left, top) {
    try {
      window.localStorage.setItem(FLOAT_POS_KEY, JSON.stringify({ left, top }));
    } catch (_err) {
      // ignore
    }
  }

  function applyFloatingPosition(root, left, top) {
    if (!root) return;
    const size = 46;
    const x = clamp(left, 4, Math.max(4, window.innerWidth - size - 4));
    const y = clamp(top, 4, Math.max(4, window.innerHeight - size - 4));
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.right = "auto";
  }

  function setFloatingRunning(running) {
    if (!ENABLE_FLOATING_BADGE) return;
    const root = document.getElementById(FLOAT_ID);
    if (!root) return;
    root.classList.toggle("bzp-running", Boolean(running));
  }

  function bindFloatingDrag(root, mainBtn) {
    if (!root || !mainBtn || mainBtn.getAttribute("data-bzp-drag-bound") === "1") return;
    mainBtn.setAttribute("data-bzp-drag-bound", "1");

    const drag = {
      active: false,
      moved: false,
      startX: 0,
      startY: 0,
      originLeft: 0,
      originTop: 0,
    };

    function onPointerMove(ev) {
      if (!drag.active) return;
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        drag.moved = true;
      }
      applyFloatingPosition(root, drag.originLeft + dx, drag.originTop + dy);
    }

    function onPointerUp() {
      if (!drag.active) return;
      drag.active = false;
      root.classList.remove("bzp-dragging");
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);

      const rect = root.getBoundingClientRect();
      saveFloatingPosition(rect.left, rect.top);
      if (!drag.moved) {
        chrome.runtime.sendMessage({ type: "bzp_open_panel" }, () => {});
      }
    }

    mainBtn.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      const rect = root.getBoundingClientRect();
      drag.active = true;
      drag.moved = false;
      drag.startX = ev.clientX;
      drag.startY = ev.clientY;
      drag.originLeft = rect.left;
      drag.originTop = rect.top;
      root.classList.add("bzp-dragging");
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
    });
  }

  function ensureFloatingBadge(forceShow = false) {
    if (!ENABLE_FLOATING_BADGE) return;
    if (forceShow) overlayDismissed = false;
    if (overlayDismissed) return;

    let root = document.getElementById(FLOAT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = FLOAT_ID;
      root.innerHTML = `
        <div class="bzp-float-main">H</div>
        <button class="bzp-float-close" type="button" aria-label="close">×</button>
      `;
      document.documentElement.appendChild(root);
      const mainBtn = root.querySelector(".bzp-float-main");
      if (mainBtn) {
        bindFloatingDrag(root, mainBtn);
      }
      const closeBtn = root.querySelector(".bzp-float-close");
      if (closeBtn) {
        closeBtn.addEventListener("click", () => {
          overlayDismissed = true;
          removeFloatingBadge();
        });
      }

      const saved = loadFloatingPosition();
      if (saved) {
        applyFloatingPosition(root, saved.left, saved.top);
      }

      window.addEventListener("resize", () => {
        const node = document.getElementById(FLOAT_ID);
        if (!node) return;
        const rect = node.getBoundingClientRect();
        applyFloatingPosition(node, rect.left, rect.top);
      });
    }
  }

  window.__bzpEnsureFloatingBadge = function () {
    ensureStyles();
    removeFloatingBadge();
    setFloatingRunning(false);
  };

  function clearHighlight() {
    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
  }

  function highlightElement(el) {
    clearHighlight();
    if (!el) return;
    el.classList.add(HIGHLIGHT_CLASS);
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }

  function pickFirstText(selectors) {
    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          const t = normalizeText(el.innerText || el.textContent);
          if (t) return t;
        }
      } catch (_err) {
        // ignore
      }
    }
    return "";
  }

  function findLeftPanel() {
    const directSelectors = [
      ".chat-content .user-list-content",
      ".user-list-content",
      "[class*='user-list-content']",
      "[class*='chat-user-list']",
      "[class*='conversation-list']",
    ];
    for (const selector of directSelectors) {
      const direct = document.querySelector(selector);
      if (direct && isVisible(direct)) return direct;
    }

    const candidates = Array.from(document.querySelectorAll("aside, section, div, ul"));
    let best = null;
    for (const el of candidates) {
      if (!isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.left > window.innerWidth * 0.48) continue;
      const text = normalizeText(el.innerText || "");
      const scrollable = el.scrollHeight > el.clientHeight + 80;
      let score = 0;
      if (rect.width > 180) score += 2;
      if (rect.height > 260) score += 2;
      if (scrollable) score += 5;
      if (/消息|有交换|未读|新招呼/.test(text)) score += 4;
      const items = el.querySelectorAll(
        "li, a, button, [role='listitem'], [class*='item'], [class*='session'], [class*='conversation'], [class*='friend']"
      ).length;
      score += Math.min(items, 12);
      if (!best || score > best.score) best = { el, score };
    }
    return best && best.score >= 7 ? best.el : null;
  }

  function isLikelySessionRow(el, panel) {
    if (!el || !panel || !panel.contains(el)) return false;
    if (!isVisible(el)) return false;
    if (el.querySelector("input, textarea")) return false;
    const rect = el.getBoundingClientRect();
    if (rect.height < 44 || rect.height > Math.max(280, window.innerHeight * 0.7)) return false;
    if (rect.width < 160) return false;
    const text = normalizeText(el.innerText || "");
    if (!text || text.length < 2) return false;
    if (/^全部\s+未读|^仅沟通/.test(text)) return false;
    const lines = String(el.innerText || "")
      .split("\n")
      .map((v) => normalizeText(v))
      .filter(Boolean);
    if (lines.length < 2) return false;
    return true;
  }

  function getSessionRows(panel) {
    const selectors = [
      "li",
      "[role='listitem']",
      "[class*='friend']",
      "[class*='conversation']",
      "[class*='session']",
      "[class*='item']",
      "a",
      "div",
    ];
    const nodes = Array.from(panel.querySelectorAll(selectors.join(", ")));
    const rows = [];
    const seen = new Set();
    for (const n of nodes) {
      const row =
        n.closest("li, [role='listitem'], [class*='friend'], [class*='conversation'], [class*='session'], [class*='item'], a") ||
        n;
      if (!row || seen.has(row)) continue;
      seen.add(row);
      if (isLikelySessionRow(row, panel)) rows.push(row);
    }
    rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return rows;
  }

  function isTimeLikeText(v) {
    const t = normalizeText(v);
    if (!t) return false;
    return /^(?:\d{1,2}:\d{2}|昨天|周[一二三四五六日天]|\d{1,2}月\d{1,2}日)$/.test(t);
  }

  function isLikelyPersonName(v) {
    const t = normalizeText(v);
    if (!t) return false;
    if (isTimeLikeText(t)) return false;
    if (/^\d+$/.test(t)) return false;
    if (t.length > 18) return false;
    return true;
  }

  function pickTextIn(root, selectors) {
    if (!root) return "";
    for (const selector of selectors) {
      try {
        const el = root.querySelector(selector);
        if (!el || !isVisible(el)) continue;
        const t = normalizeText(el.innerText || el.textContent);
        if (t) return t;
      } catch (_err) {
        // ignore
      }
    }
    return "";
  }

  function stripLineNoise(v) {
    return normalizeText(v)
      .replace(/\b\d{1,2}:\d{2}\b/g, " ")
      .replace(/^(昨天|周[一二三四五六日天]|\d{1,2}月\d{1,2}日)\s*/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractSimpleHrName(v) {
    let t = stripLineNoise(v);
    if (!t) return "";
    t = t
      .replace(/(招聘者|HR|人事|主管|经理|总监)\s*$/i, "")
      .replace(/[，,。;；]+$/, "")
      .trim();
    if (!t) return "";

    const firstPart = t.split(/[ |\t|｜|丨|/]+/).filter(Boolean)[0] || t;
    let c = normalizeText(firstPart);
    if (!c) return "";

    let m = c.match(/^([\u4e00-\u9fa5]{1,3}(?:先生|女士|小姐)?)/);
    if (m) return normalizeText(m[1]);
    m = c.match(/^([A-Za-z][A-Za-z0-9_.-]{1,24})/);
    if (m) return normalizeText(m[1]);
    return c.slice(0, 8);
  }

  function extractNameJob(lines, rowEl) {
    const cleanLines = (lines || []).map((x) => stripLineNoise(x)).filter(Boolean);
    const domNameRaw = pickTextIn(rowEl, [
      ".name-text",
      "[class*='name-text']",
      "[class*='name']",
      "strong",
      "b",
      "h3",
    ]);
    let domName = extractSimpleHrName(domNameRaw);
    if (!isLikelyPersonName(domName)) domName = "";

    let name = domName;
    let job = "";
    const first = cleanLines[0] || "";
    const second = cleanLines[1] || "";

    if (!name && first) {
      const tokens = first
        .split(/[ |\t|｜|丨|·|/]/)
        .map((x) => normalizeText(x))
        .filter(Boolean);
      for (const token of tokens) {
        const n = extractSimpleHrName(token);
        if (isLikelyPersonName(n)) {
          name = n;
          break;
        }
      }
      if (!name && isLikelyPersonName(first)) {
        name = extractSimpleHrName(first);
      }
    }

    if (first) {
      if (name && first.includes(name)) {
        job = normalizeText(first.replace(name, "").replace(/^[-|｜·\s]+/, ""));
      } else {
        job = first;
      }
    }
    if (!job) {
      job = second;
    }

    name = extractSimpleHrName(name);
    if (isTimeLikeText(name) || /^\d+$/.test(name)) {
      name = "";
    }
    if (isTimeLikeText(job)) {
      job = "";
    }
    return { name_guess: normalizeText(name), job_guess: normalizeText(job) };
  }

  function findNodeBySessionHints(panel, sessionKey, nameHint, jobHint) {
    if (!panel) return null;
    const rows = getSessionRows(panel);
    let best = null;
    const keyHint = normalizeText(sessionKey || "");
    const nh = normalizeText(nameHint || "");
    const jh = normalizeText(jobHint || "");

    for (const row of rows) {
      const lines = String(row.innerText || "")
        .split("\n")
        .map((v) => normalizeText(v))
        .filter(Boolean);
      if (!lines.length) continue;
      const ej = extractNameJob(lines, row);
      const key = normalizeText(`${ej.name_guess}|${ej.job_guess}`);
      let score = 0;
      if (keyHint && key && key === keyHint) score += 8;
      if (nh && ej.name_guess && (ej.name_guess.includes(nh) || nh.includes(ej.name_guess))) score += 5;
      if (jh && ej.job_guess && (ej.job_guess.includes(jh) || jh.includes(ej.job_guess))) score += 3;
      if (score > 0 && (!best || score > best.score)) best = { row, score, ej };
    }
    if (best && best.score >= 3) {
      return best.row;
    }
    return null;
  }

  function detectUnreadInRow(rowEl) {
    if (!rowEl) return false;
    const rowClass = String(rowEl.className || "");
    if (/\bunread\b|\bnew\b|\bdot\b|\bbadge\b|\bcount\b/i.test(rowClass)) {
      return true;
    }

    const badgeSelectors = [
      "[class*='unread']",
      "[class*='new']",
      "[class*='dot']",
      "[class*='badge']",
      "[class*='count']",
      "[aria-label*='未读']",
      "[title*='未读']",
      "em",
      "i",
    ];
    for (const selector of badgeSelectors) {
      const nodes = Array.from(rowEl.querySelectorAll(selector));
      for (const n of nodes) {
        if (!n || !isVisible(n)) continue;
        const t = normalizeText(n.innerText || n.textContent);
        if (!t) continue;
        if (/^\d{1,3}$/.test(t) || /未读|新消息/.test(t)) {
          return true;
        }
      }
    }

    const rowText = normalizeText(rowEl.innerText || "");
    if (/未读|条新消息|新消息/.test(rowText)) {
      return true;
    }
    return false;
  }

  function listVisibleSessions() {
    const panel = findLeftPanel();
    if (!panel) return { ok: false, error: "未定位到左侧列表" };

    const seen = new Set();
    const sessions = [];
    const items = getSessionRows(panel);
    if (!items.length) {
      return { ok: false, error: "未识别到可点击会话项" };
    }

    for (let idx = 0; idx < items.length; idx += 1) {
      const el = items[idx];
      if (!isLikelySessionRow(el, panel)) continue;
      const text = normalizeText(el.innerText || "");
      if (!text || text.length < 2) continue;
      if (text === "更多") continue;

      const lines = String(el.innerText || "")
        .split("\n")
        .map((v) => normalizeText(v))
        .filter(Boolean);
      if (!lines.length) continue;

      const { name_guess, job_guess } = extractNameJob(lines, el);
      if (!name_guess) continue;
      const preview = normalizeText(lines.slice(1, 4).join(" "));
      const timeText = (text.match(/\b\d{1,2}:\d{2}\b|昨天|周[一二三四五六日天]|\d{1,2}月\d{1,2}日/) || [])[0] || "";
      const sessionKey = normalizeText(`${name_guess}|${job_guess}`);
      const signature = normalizeText(`${sessionKey}|${preview}|${timeText}`);
      const marker = hashText(signature || text);
      if (seen.has(marker)) continue;
      seen.add(marker);

      el.setAttribute("data-bzp-marker", marker);
      el.setAttribute("data-bzp-name", name_guess);
      el.setAttribute("data-bzp-job", job_guess || "");

      sessions.push({
        marker,
        session_key: sessionKey,
        signature,
        name_guess,
        job_guess,
        preview,
        time_text: timeText,
        visible_index: idx + 1,
        has_unread: detectUnreadInRow(el),
      });
    }

    return { ok: true, sessions };
  }

  async function clickText(text, scope) {
    const root = scope || document;
    const nodes = Array.from(root.querySelectorAll("button, li, span, div, a, [role='button']"));
    for (const el of nodes) {
      if (!isUiVisible(el)) continue;
      const t = normalizeText(el.innerText || el.textContent);
      if (!t) continue;
      if (t !== text && !t.includes(text)) continue;
      try {
        el.click();
        await sleep(350);
        return true;
      } catch (_err) {
        // ignore
      }
    }
    return false;
  }

  function isActiveLike(el) {
    if (!el) return false;
    const cls = String(el.className || "");
    if (/active|selected|current|checked|choose/i.test(cls)) return true;
    if (el.getAttribute("aria-selected") === "true") return true;
    if (el.getAttribute("aria-checked") === "true") return true;
    return false;
  }

  function findFilterScope() {
    const panel = findLeftPanel();
    if (!panel) return document;
    const candidate = panel.closest("section, article, div") || panel.parentElement || panel;
    return candidate || document;
  }

  function currentExchangeFilterState(scope) {
    const root = scope || document;
    const nodes = Array.from(root.querySelectorAll("li, span, button, div, a"));
    let activeText = "";
    let anyExchangeText = "";
    for (const n of nodes) {
      if (!isUiVisible(n)) continue;
      const t = normalizeText(n.innerText || n.textContent);
      if (!t) continue;
      if (!FILTER_TEXTS.some((k) => t.includes(k))) continue;
      if (!anyExchangeText) anyExchangeText = t;
      if (isActiveLike(n)) {
        activeText = t;
        break;
      }
    }
    // 某些页面没有 active class，但当前筛选按钮文案本身已显示“有交换”
    if (!activeText && anyExchangeText) activeText = anyExchangeText;
    const inDesired = /有交换|交换微信/.test(activeText);
    return { active_text: activeText, in_desired: inDesired, saw_exchange_text: Boolean(anyExchangeText) };
  }

  async function clickExchangeDropdownToggle(scope) {
    const root = scope || document;
    const nodes = Array.from(root.querySelectorAll("li, span, button, div, a"));
    for (const n of nodes) {
      if (!isUiVisible(n)) continue;
      const t = normalizeText(n.innerText || n.textContent);
      if (!t) continue;
      if (!/有交换|交换微信/.test(t)) continue;
      try {
        n.click();
        await sleep(260);
        return true;
      } catch (_err) {
        // ignore
      }
    }
    return false;
  }

  async function ensureExchangeFilter() {
    const scope = findFilterScope();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const state = currentExchangeFilterState(scope);
      if (state.in_desired) {
        return { ok: true, active: true, active_text: state.active_text };
      }

      for (const more of MORE_TEXTS) {
        await clickText(more, scope);
      }

      // 先尝试点开“有交换”下拉
      await clickExchangeDropdownToggle(scope);
      await sleep(220);

      if (await clickText("有交换", scope)) {
        await sleep(420);
        const after = currentExchangeFilterState(scope);
        if (after.in_desired || after.saw_exchange_text) {
          return { ok: true, active: true, active_text: after.active_text || "有交换" };
        }
      }

      for (const filterText of FILTER_TEXTS) {
        if (await clickText(filterText, scope)) {
          await sleep(380);
          const after = currentExchangeFilterState(scope);
          if (after.in_desired || after.saw_exchange_text) {
            return { ok: true, active: true, active_text: after.active_text || filterText };
          }
        }
      }
    }

    // 兜底：至少看到了“有交换”文案，不再阻塞采集。
    const finalState = currentExchangeFilterState(scope);
    if (finalState.saw_exchange_text) {
      return { ok: true, active: false, active_text: finalState.active_text || "有交换" };
    }
    return { ok: false, error: "未找到或无法切换到有交换筛选项" };
  }

  async function openSessionByMarker(marker, sessionKey, nameHint, jobHint) {
    let node = document.querySelector(`[data-bzp-marker="${marker}"]`);
    if (!node) {
      const panel = findLeftPanel();
      const recovered = findNodeBySessionHints(panel, sessionKey, nameHint, jobHint);
      if (recovered) {
        node = recovered;
        node.setAttribute("data-bzp-marker", marker);
        if (nameHint) node.setAttribute("data-bzp-name", nameHint);
        if (jobHint) node.setAttribute("data-bzp-job", jobHint);
      }
    }
    if (!node) {
      return { ok: false, error: `未找到会话节点: ${marker}` };
    }
    const expectedName = normalizeText(node.getAttribute("data-bzp-name") || "");
    const expectedJob = normalizeText(node.getAttribute("data-bzp-job") || "");
    const clickTargets = [];
    clickTargets.push(node);
    const selectors = [
      "a",
      "button",
      "[role='button']",
      "[class*='name']",
      "[class*='title']",
      "[class*='content']",
      "[class*='avatar']",
    ];
    for (const selector of selectors) {
      const t = node.querySelector(selector);
      if (t && !clickTargets.includes(t)) clickTargets.push(t);
    }

    function panelSignature() {
      const right = findRightPanel();
      if (!right) return "";
      const text = normalizeText((right.innerText || right.textContent || "").slice(0, 500));
      const hr = pickFirstText(HR_SELECTORS);
      const job = pickFirstText(JOB_SELECTORS);
      return hashText(`${hr}|${job}|${text}`);
    }

    function isSelectedState() {
      const selectors = [".active", ".selected", ".current", ".focus", ".choose", "[aria-selected='true']"];
      for (const selector of selectors) {
        if (node.matches && node.matches(selector)) return true;
        if (node.closest && node.closest(selector)) return true;
      }
      return false;
    }

    function hrJobMatched() {
      const hr = extractSimpleHrName(pickFirstText(HR_SELECTORS));
      const job = normalizeText(pickFirstText(JOB_SELECTORS));
      const nameHit = expectedName && hr ? hr.includes(expectedName) || expectedName.includes(hr) : false;
      const jobHit = expectedJob && job ? job.includes(expectedJob) || expectedJob.includes(job) : false;
      return { hr, job, nameHit, jobHit };
    }

    function clickWithEvents(el) {
      if (!el) return;
      try {
        el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
      } catch (_err) {
        // ignore
      }
      try {
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
      } catch (_err) {
        // ignore
      }
      try {
        el.click();
      } catch (_err) {
        // ignore
      }
    }

    try {
      highlightElement(node);
      node.scrollIntoView({ block: "center", inline: "nearest" });
      const beforeSig = panelSignature();

      let clicked = false;
      let changed = false;
      let selectedHit = false;
      let headerMatched = false;
      let headerHr = "";
      let headerJob = "";
      for (let attempt = 0; attempt < 3 && !changed; attempt += 1) {
        for (const target of clickTargets) {
          clickWithEvents(target);
          clicked = true;
          await sleep(450 + attempt * 180);
          const afterSig = panelSignature();
          const selected = isSelectedState();
          if (selected) selectedHit = true;
          const match = hrJobMatched();
          headerHr = extractSimpleHrName(match.hr);
          headerJob = match.job;
          if (match.nameHit || match.jobHit) headerMatched = true;
          if ((afterSig && beforeSig && afterSig !== beforeSig) || selected || headerMatched) {
            changed = true;
            break;
          }
        }
      }

      await sleep(320);
      return {
        ok: clicked,
        panel_changed: changed,
        selected: selectedHit,
        header_matched: headerMatched,
        header_hr: headerHr,
        header_job: headerJob,
        name_guess: node.getAttribute("data-bzp-name") || "",
        job_guess: node.getAttribute("data-bzp-job") || "",
        error: clicked ? "" : "点击动作未执行",
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  function findRightPanel() {
    const selectors = [
      ".chat-conversation",
      ".chat-record",
      ".message-content",
      "[class*='chat-content']",
      "[class*='chat-detail']",
      "[class*='conversation-content']",
      "main",
    ];
    let best = null;
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.left < window.innerWidth * 0.25) continue;
        const score = rect.width * rect.height;
        if (!best || score > best.score) best = { node, score };
      }
    }
    return best ? best.node : null;
  }

  function findScrollableChatContainer(panel) {
    if (!panel) return null;
    const candidates = [panel, ...Array.from(panel.querySelectorAll("div, section, ul, article"))];
    let best = null;
    for (const node of candidates) {
      if (!isVisible(node)) continue;
      const overflow = node.scrollHeight - node.clientHeight;
      if (overflow < 80) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 220 || rect.height < 180) continue;
      const score = overflow + rect.width * 0.04 + rect.height * 0.06;
      if (!best || score > best.score) best = { node, score };
    }
    return best ? best.node : panel;
  }

  async function collectRightPanelText(panel) {
    if (!panel) return "";
    const scroller = findScrollableChatContainer(panel) || panel;
    const snapshots = [];
    const seen = new Set();
    const originalTop = scroller.scrollTop;
    try {
      scroller.click();
    } catch (_err) {
      // ignore
    }
    scroller.scrollTop = scroller.scrollHeight;
    await sleep(160);

    for (let i = 0; i < 14; i += 1) {
      const text = normalizeText(panel.innerText || panel.textContent || "");
      if (text && !seen.has(text)) {
        seen.add(text);
        snapshots.push(text);
      }
      const prev = scroller.scrollTop;
      if (prev <= 0) break;
      scroller.scrollTop = Math.max(0, prev - Math.max(260, scroller.clientHeight * 0.88));
      await sleep(140);
      if (scroller.scrollTop === prev) break;
    }
    scroller.scrollTop = originalTop;
    return normalizeText(snapshots.join("\n"));
  }

  function extractWeChat(text) {
    const candidates = [];
    const regexes = [
      /微信号(?:是|为|：|:)?\s*([a-zA-Z0-9][a-zA-Z0-9_-]{4,35})/g,
      /(?:复制微信号|加微|加V|加v)\s*([a-zA-Z0-9][a-zA-Z0-9_-]{4,35})/g,
    ];
    for (const regex of regexes) {
      let m;
      while ((m = regex.exec(text))) {
        const v = normalizeText(m[1]);
        if (!v || v.includes("*")) continue;
        candidates.push(v);
      }
    }
    return candidates[0] || "";
  }

  function extractPhone(text) {
    const m = text.match(/(?<!\d)(1[3-9]\d{9})(?!\d)/);
    return m ? m[1] : "";
  }

  function buildDedupeKey(hrName, jobName, wechat, phone) {
    if (wechat) return `wx:${wechat}`;
    if (phone) return `tel:${phone}`;
    return `namejob:${normalizeText(hrName)}_${normalizeText(jobName)}`;
  }

  async function extractCurrentContact(sourceIndex = 0) {
    const panel = findRightPanel();
    const text = await collectRightPanelText(panel);
    const topContext = normalizeText(
      [
        pickFirstText(JOB_SELECTORS),
        pickFirstText(HR_SELECTORS),
        normalizeText(panel ? panel.innerText : ""),
      ].join("\n")
    );
    const mergedText = normalizeText(`${topContext}\n${text}`);
    const wechat = extractWeChat(mergedText);
    const phone = extractPhone(mergedText);

    const hrName = extractSimpleHrName(
      pickFirstText(HR_SELECTORS) ||
        (document.querySelector(`.${HIGHLIGHT_CLASS}`)?.getAttribute("data-bzp-name") || "")
    );
    const jobName = pickFirstText(JOB_SELECTORS) || (document.querySelector(`.${HIGHLIGHT_CLASS}`)?.getAttribute("data-bzp-job") || "");

    if (!wechat && !phone) {
      return {
        ok: true,
        has_contact: false,
        hr_name: hrName,
        job_name: jobName,
      };
    }

    const now = new Date();
    const collectedAt = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-") + " " + [String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0"), String(now.getSeconds()).padStart(2, "0")].join(":");

    return {
      ok: true,
      has_contact: true,
      record: {
        job_name: jobName,
        hr_name: hrName,
        wechat,
        phone,
        collected_at: collectedAt,
        source_index: String(sourceIndex || ""),
        dedupe_key: buildDedupeKey(hrName, jobName, wechat, phone),
      },
    };
  }

  // ==================== 招聘端·关键字打招呼模式 ====================
  const GREET_FILTER_TEXTS = ["候选人", "牛人", "推荐", "在线", "新简历", "沟通中", "待沟通", "全部"];
  const GREET_DETAIL_MARKS = ["帮我联系", "极速联系", "聊一聊", "聊点沟通", "暂不沟通", "暂联联系", "牛人分析器", "经历概览"];

  function isGreetBtnLike(el) {
    try {
      const t = normalizeText(el.innerText || el.textContent || "");
      return t === "打招呼" || /^打招呼\s*\d*$/.test(t) || /^打招呼\s*[（(]?\d*[)）]?$/.test(t);
    } catch (_err) {
      return false;
    }
  }

  function greetProbe() {
    const hasGreetBtn = Array.from(
      document.querySelectorAll(
        "button, [role='button'], [class*='btn'], [class*='Btn'], [class*='button'], div, span, a, li"
      )
    ).some((b) => {
      try {
        if (!isVisible(b)) return false;
        const t = normalizeText(b.innerText || b.textContent || "");
        return t === "打招呼" || /^打招呼\s*\d*$/.test(t) || /^打招呼\s*[（(]?\d*[)）]?$/.test(t);
      } catch (_err) {
        return false;
      }
    });
    const navText = normalizeText(document.body ? document.body.innerText || "" : "");
    return {
      ok: true,
      hasGreetBtn,
      hasNav: navText.includes("推荐牛人") || navText.includes("牛人管理") || navText.includes("职位管理"),
      url: location.href,
      bodyText: navText.slice(0, 200),
    };
  }

  function greetIsDetailOpened() {
    return Array.from(
      document.querySelectorAll(
        "button, [role='button'], [class*='btn'], [class*='Btn'], [class*='button'], div, span, a"
      )
    ).some((b) => {
      try {
        if (!isVisible(b)) return false;
        const t = normalizeText(b.innerText || b.textContent || "");
        return GREET_DETAIL_MARKS.some((m) => t.includes(m));
      } catch (_err) {
        return false;
      }
    });
  }

  // 详情关闭基准：详情抽屉容器「不可见」才算真正关闭。
  // 文本信号（聊一聊/暂不沟通等）在关闭动画或隐藏 DOM 中可能仍残留，不能作为关闭依据；
  // 以容器几何状态为准：找不到容器 / 尺寸塌缩 / 滑出视口 任一成立即视为已关闭。
  function greetIsDetailClosed() {
    try {
      const scope = findDetailScope();
      if (!scope) return true;
      const r = scope.getBoundingClientRect();
      if (r.width < 50 || r.height < 50) return true;
      if (r.right <= 0 || r.left >= window.innerWidth) return true;
      return false;
    } catch (_err) {
      return true;
    }
  }

  // 轮询等待详情真正关闭（动画通常几百 ms），超时返回最终状态
  async function waitDetailClosed(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 2000);
    while (Date.now() < deadline) {
      if (greetIsDetailClosed()) return true;
      await sleep(400);
    }
    return greetIsDetailClosed();
  }

  function greetFindCandidatePanel() {
    const btns = Array.from(
      document.querySelectorAll(
        "button, [role='button'], [class*='btn'], [class*='Btn'], [class*='button'], div, span, a, li"
      )
    ).filter((b) => {
      try {
        if (!isVisible(b)) return false;
        const t = normalizeText(b.innerText || b.textContent || "");
        if (t === "打招呼") return true;
        if (/^打招呼\s*\d*$/.test(t)) return true;
        if (/^打招呼\s*[（(]?\d*[)）]?$/.test(t)) return true;
        return false;
      } catch (_err) {
        return false;
      }
    });
    if (btns.length < 1) return null;
    const counter = new Map();
    for (const b of btns) {
      let el = b.parentElement;
      for (let i = 0; el && el !== document.body && i < 12; i += 1) {
        counter.set(el, (counter.get(el) || 0) + 1);
        el = el.parentElement;
      }
    }
    let best = null;
    for (const [el, count] of counter) {
      if (count < 1 || !isVisible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 140 || rect.height < 100) continue;
      const area = rect.width * rect.height;
      if (!best || count > best.count || (count === best.count && area < best.area)) {
        best = { el, count, area };
      }
    }
    return best ? best.el : null;
  }

  function greetFindCardFromButton(btn, panel) {
    let node = btn;
    let card = null;
    for (let i = 0; i < 8; i += 1) {
      if (!node.parentElement || node.parentElement === panel || node.parentElement === document.body) break;
      node = node.parentElement;
      const rect = node.getBoundingClientRect();
      if (rect.height < 20) continue;
      const t = normalizeText(node.innerText || node.textContent || "");
      if (t.length >= 8) {
        card = node;
        break;
      }
    }
    return card;
  }

  function greetGetCandidateRows(panel) {
    const btns = Array.from(
      panel.querySelectorAll(
        "button, [role='button'], [class*='btn'], [class*='Btn'], [class*='button'], div, span, a, li"
      )
    ).filter((b) => {
      try {
        if (!isVisible(b)) return false;
        const t = normalizeText(b.innerText || b.textContent || "");
        if (t === "打招呼") return true;
        if (/^打招呼\s*\d*$/.test(t)) return true;
        if (/^打招呼\s*[（(]?\d*[)）]?$/.test(t)) return true;
        return false;
      } catch (_err) {
        return false;
      }
    });
    const rows = [];
    const seen = new Set();
    for (const b of btns) {
      const card = greetFindCardFromButton(b, panel);
      if (!card || seen.has(card)) continue;
      seen.add(card);
      rows.push(card);
    }
    rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return rows;
  }

  function greetExtractCandidateInfo(rowEl) {
    const text = normalizeText(rowEl.innerText || "");
    const lines = String(rowEl.innerText || "")
      .split("\n")
      .map((v) => normalizeText(v))
      .filter(Boolean);
    let name = "";
    const nameSelectors = ["[class*='name']", "[class*='title']", "strong", "b", "h3", "img[alt]"];
    for (const sel of nameSelectors) {
      const els = rowEl.querySelectorAll(sel);
      for (const el of els) {
        if (!isVisible(el)) continue;
        let t = "";
        if (sel === "img[alt]") {
          t = normalizeText(el.getAttribute("alt") || "");
        } else {
          t = normalizeText(el.innerText || el.textContent);
        }
        if (!t || t.length > 12 || /^\d+$/.test(t) || isTimeLikeText(t)) continue;
        name = t;
        break;
      }
      if (name) break;
    }
    if (!name) {
      for (const line of lines) {
        const t = line.split(/[ |\t|｜|丨|·|/]/).filter(Boolean)[0] || line;
        if (t.length <= 12 && t.length >= 2 && !/^\d+$/.test(t) && !isTimeLikeText(t)) {
          name = t;
          break;
        }
      }
    }
    const preview = lines.slice(0, 4).join(" ");
    const marker = hashText(`${name}|${text.slice(0, 160)}`);
    return { name_guess: name, preview, marker };
  }

  function greetListCandidates() {
    const panel = greetFindCandidatePanel();
    if (!panel) {
      const debugTexts = Array.from(
        document.querySelectorAll("button, [role='button'], [class*='btn'], [class*='Btn'], [class*='button'], a, li, span, div")
      )
        .filter((b) => {
          try {
            return isVisible(b);
          } catch (_err) {
            return false;
          }
        })
        .map((b) => {
          try {
            return normalizeText(b.innerText || b.textContent || "");
          } catch (_err) {
            return "";
          }
        })
        .filter((t) => t && t.length <= 12)
        .slice(0, 40);
      return {
        ok: false,
        error: "未定位到候选人列表，请确认已打开『推荐牛人』页面",
        debug: debugTexts,
        bodyText: (document.body ? document.body.innerText || "" : "").replace(/\s+/g, " ").trim().slice(0, 400),
      };
    }
    const rows = greetGetCandidateRows(panel);
    if (!rows.length) return { ok: false, error: "未识别到候选人卡片（列表中没有『打招呼』按钮）" };
    const seen = new Set();
    const sessions = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const info = greetExtractCandidateInfo(row);
      if (!info.name_guess || seen.has(info.marker)) continue;
      seen.add(info.marker);
      row.setAttribute("data-bzp-greet-marker", info.marker);
      sessions.push({
        marker: info.marker,
        name_guess: info.name_guess,
        preview: info.preview,
        visible_index: i + 1,
      });
    }
    return { ok: true, sessions };
  }

  function greetGetExpectJobBlockedAreas() {
    // 找出所有包含「期望职位」「同事沟通进度」等标签文本的元素，
    // 从标签向上定位其所属的区块容器（标题与记录共同所在的容器），
    // 整个区块的文本都不参与关键字匹配。不依赖 class 关键词猜测，避免漏掉实际结构。
    const BLOCK_LABELS = ["期望职位", "同事沟通进度", "沟通进度", "同事沟通"];
    // 正文区块标题：一旦上溯的容器里出现这些字样，说明已越过「期望职位」小块、
    // 进入整个简历正文容器，立即停止屏蔽，避免把个人优势/工作经历整块误杀导致漏报。
    const BODY_AREA_LABELS = ["个人优势", "工作经历", "教育经历", "自我介绍", "项目经历", "职业技能", "技能", "证书", "作品"];
    const blocked = new Set();
    const labels = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const t = String(node.nodeValue || "").trim();
      if (BLOCK_LABELS.some((label) => t.includes(label))) {
        const el = node.parentElement;
        if (el && isVisible(el)) labels.push(el);
      }
    }
    for (const label of labels) {
      // 从标签元素向上找「区块根」：取最后一个宽度/高度足够、但还没到大容器（详情面板/页面外壳）的元素。
      // 标签与其下方记录（如沟通记录列表）共享同一个区块容器，屏蔽该容器即可整体排除。
      let cur = label;
      let blockRoot = null;
      for (let i = 0; i < 12 && cur && cur !== document.body; i++) {
        try {
          if (!isVisible(cur)) { cur = cur.parentElement; continue; }
          const rect = cur.getBoundingClientRect();
          // 已上溯到详情面板 / 页面外壳等超大容器：停止，采用之前找到的区块根
          if (rect.width > 700 && rect.height > 400) break;
          const txt = (cur.innerText || "").trim();
          // 一旦容器里出现正文区块标题，说明已越界到简历正文容器，停止上溯；
          // 若尚未找到合适的区块根，就用标签的直接父容器兜底（只屏蔽小块，不误伤正文）。
          if (BODY_AREA_LABELS.some((m) => txt.includes(m))) break;
          if (rect.width > 150 && rect.height >= 40 && txt.length >= 4) blockRoot = cur;
        } catch (_err) {
          // ignore
        }
        cur = cur.parentElement;
      }
      // 兜底：至少屏蔽标签的直接父容器
      if (!blockRoot) {
        blockRoot =
          label.parentElement && label.parentElement !== document.body
            ? label.parentElement
            : label;
      }
      blocked.add(blockRoot);
      // 保险：若区块根的父容器还不是详情面板/页面外壳（宽度高度均未超限），一并屏蔽，
      // 覆盖「标题与记录列表是兄弟容器」的布局，避免记录文本漏网。
      // 注意：上溯父容器同样受 BODY_AREA_LABELS 保护，绝不把整个简历正文容器误屏蔽。
      let p = blockRoot.parentElement;
      for (let i = 0; i < 2 && p && p !== document.body; i++) {
        try {
          if (!isVisible(p)) break;
          const pr = p.getBoundingClientRect();
          if (pr.width > 700 && pr.height > 400) break;
          // 保护：父容器若是详情面板（含详情标记文本），不屏蔽，避免整个面板文字被排除导致漏报
          const pt = normalizeText(p.innerText || p.textContent || "");
          if (GREET_DETAIL_MARKS.some((m) => pt.includes(m))) break;
          // 保护：父容器已含正文区块标题（个人优势/工作经历等），说明是简历正文容器，不屏蔽
          if (BODY_AREA_LABELS.some((m) => pt.includes(m))) break;
          blocked.add(p);
        } catch (_err) {
          break;
        }
        p = p.parentElement;
      }
    }
    return blocked;
  }

  function greetIsInBlockedArea(el, blocked) {
    let p = el;
    while (p && p !== document.body) {
      if (blocked.has(p)) return true;
      p = p.parentElement;
    }
    return false;
  }

  async function greetCollectDetailText() {
    // v3（修复漏报）：
    // - 候选容器不再取第一个命中的，而是取「面积最大」的详情面板容器（整个抽屉），
    //   避免选中右侧沟通区/头部小面板导致个人优势/工作经历不在采集范围内
    // - 文本可见性不再依赖「视口内可见」，改为「位于详情面板边界内且样式可见」，
    //   修复长简历里个人优势/工作经历在首屏视口外被丢弃导致的漏报
    function findDetailScopeInline() {
      const all = Array.from(
        document.querySelectorAll("div, section, [class*='modal'], [class*='dialog'], [class*='drawer'], [class*='panel'], [class*='content']")
      );
      let best = null;
      let bestArea = 0;
      for (const el of all) {
        try {
          if (!isVisible(el)) continue;
          const t = normalizeText(el.innerText || el.textContent || "");
          if (!GREET_DETAIL_MARKS.some((m) => t.includes(m))) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 400 || rect.height <= 300) continue;
          const area = rect.width * rect.height;
          if (area > bestArea) {
            bestArea = area;
            best = el;
          }
        } catch (_err) {
          // ignore
        }
      }
      return best;
    }

    const scopeEl = findDetailScopeInline();
    if (!scopeEl) return { ok: false, error: "未定位到详情面板" };
    const sr = scopeEl.getBoundingClientRect();
    // 相对面板的裁剪：左侧让 5%，右侧让 18% 给悬浮沟通功能区（相对面板计算，不误伤面板外内容）
    const leftBound = sr.left + sr.width * 0.05;
    const rightBound = sr.right - sr.width * 0.18;

    // 详情面板内的文本可见性：TreeWalker 从详情面板容器开始遍历，
    // 只要样式未隐藏（display/visibility/opacity）即算可见参与匹配。
    // 严禁用「元素矩形与面板视口相交」判断可见性——长简历的个人优势/工作经历
    // 位于首屏视口外（需滚动才可见），坐标判断会把它们整段丢弃导致大量漏判。
    function isDetailTextVisible(el) {
      if (!el) return false;
      try {
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (parseFloat(style.opacity || "1") === 0) return false;
        return true;
      } catch (_err) {
        return false;
      }
    }

    const blocked = greetGetExpectJobBlockedAreas();
    let parts = [];
    const seen = new Set();
    // 沟通区红线：碰到这些字样（及其后的全部内容）一律不抓——用户明确指令
    const CUT_LABELS = ["了解同事沟通进度", "同事沟通进度", "我的沟通进度", "同事沟通"];
    // 面板头部/固定按钮噪音词：纯按钮文字不参与匹配，避免日志脏
    const NOISE_PARTS = new Set([
      "收藏", "转发", "举报", "继续沟通", "帮我联系", "经历概览",
      "不合适", "打招呼", "合作专享", "合作客户专享",
    ]);
    const walker = document.createTreeWalker(scopeEl, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const t = String(node.nodeValue || "").trim();
      if (!t || t.length < 2) continue;
      const el = node.parentElement;
      if (!el || !isDetailTextVisible(el)) continue; // 面板边界内可见即可，不要求视口内
      if (greetIsInBlockedArea(el, blocked)) continue; // 排除期望职位/同事沟通进度区块
      const rect = el.getBoundingClientRect();
      if (rect.right < leftBound) continue; // 完全位于左侧裁剪区外才排除，避免误杀横跨面板的正文块
      if (rect.left > rightBound) continue; // 文本从右侧沟通功能区开始才排除；横跨中部的正文（如职责描述块）保留
      const key = t.slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      if (NOISE_PARTS.has(t)) continue; // 纯按钮/噪音词不参与匹配
      parts.push(t);
    }
    // 截断：从第一个「同事沟通进度」类标签起，之后的内容一律不要（用户红线，DOM 结构兜底）
    let cutIndex = -1;
    for (let i = 0; i < parts.length; i += 1) {
      if (CUT_LABELS.some((lab) => parts[i].includes(lab))) {
        cutIndex = i;
        break;
      }
    }
    if (cutIndex >= 0) parts = parts.slice(0, cutIndex);
    return { ok: true, text: normalizeText(parts.join(" ")), segments: parts };
  }

  // 公司名红线：把经历段里「时间区间之前」的公司/门店名剥掉，
  // 防止把「XX瑜伽普拉提」「XX瑜伽馆」等店名里的关键字误判为候选人本人命中。
  // 只保留时间区间及其后的职位/描述/时长，个人优势、工作历程等不含时间的内容原样保留。
  // 注意：必须「逐段调用」且锚定段首，否则会对整段拼接文本全局吞掉第一个时间区间前
  // 的所有内容（含个人优势里的关键字），导致漏判。
  const STRIP_COMPANY_RE = /^[^\d]*?(\d{4}(?:\.\d{1,2})?\s*[-—–~]\s*(?:至今|\d{4}(?:\.\d{1,2})?))/;
  function stripCompanyNames(t) {
    return String(t || "").replace(STRIP_COMPANY_RE, "$1");
  }

  async function greetCheckKeywords(keywords) {
    if (!greetIsDetailOpened()) {
      return { ok: false, error: "未检测到候选人详情页，请确认已点进候选人" };
    }
    const res = await greetCollectDetailText();
    if (!res.ok) {
      return { ok: false, error: res.error || "读取候选人详情失败" };
    }
    const text = res.text;
    // 关键字匹配文本：逐段剥离公司名后再拼接。
    // 严禁对整体拼接文本一次性 stripCompanyNames——正则锚定段首并吞到第一个时间区间，
    // 会把姓名/个人优势等排在经历段前面的正文（常含关键字）整段误当公司名剥掉，导致漏判。
    const rawSegments = Array.isArray(res.segments) ? res.segments : [];
    const segments = rawSegments.map((s) => stripCompanyNames(s)).filter(Boolean);
    const matchText = normalizeText(segments.join(" "));
    const hits = [];
    const hitsContext = [];
    for (const kw of keywords) {
      if (!kw) continue;
      if (!matchText.includes(kw)) continue;
      hits.push(kw);
      // 定位关键字所在段落并取前后文（前后各 30 字）
      let ctx = "";
      for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i];
        if (!seg || !seg.includes(kw)) continue;
        const idx = seg.indexOf(kw);
        const pre = seg.slice(Math.max(0, idx - 30), idx);
        const post = seg.slice(idx + kw.length, idx + kw.length + 30);
        ctx = `[第${i + 1}段] …${pre}【${kw}】${post}…`;
        break;
      }
      if (!ctx) {
        // 兜底：直接从剥离后的拼接文本里截取
        const idx = matchText.indexOf(kw);
        ctx = `[拼接文本] …${matchText.slice(Math.max(0, idx - 30), idx)}【${kw}】${matchText.slice(idx + kw.length, idx + kw.length + 30)}…`;
      }
      hitsContext.push({ kw, ctx });
    }
    return { ok: true, matched: hits.length > 0, hits, hitsContext, preview: text.slice(0, 200), fullText: text };
  }

  async function greetOpenCandidate(marker) {
    let node = document.querySelector(`[data-bzp-greet-marker="${marker}"]`);
    if (!node) {
      const panel = greetFindCandidatePanel();
      const rows = greetGetCandidateRows(panel || document);
      for (const row of rows) {
        const info = greetExtractCandidateInfo(row);
        if (info.marker === marker) {
          node = row;
          break;
        }
      }
    }
    if (!node) return { ok: false, error: `未找到候选人节点: ${marker}` };

    async function panelSig() {
      const opened = greetIsDetailOpened();
      const res = await greetCollectDetailText();
      const text = res && res.ok ? res.text : "";
      return hashText((opened ? "HELP:" : "NOHELP:") + text.slice(0, 800));
    }

    function clickWithEvents(el) {
      if (!el) return;
      try {
        el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, view: window }));
      } catch (_err) {
        // ignore
      }
      try {
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
      } catch (_err) {
        // ignore
      }
      try {
        el.click();
      } catch (_err) {
        // ignore
      }
    }

    try {
      highlightElement(node);
      node.scrollIntoView({ block: "center", inline: "nearest" });
      const beforeSig = await panelSig();
      const clickTargets = [node];
      // 只点卡片本体/姓名/内容区来打开详情；绝不点头像（头像可能是链接，会打开新页/预览导致流程错乱），a 链接放最后兜底
      const selectors = ["[class*='name']", "[class*='content']", "[class*='info']", "[class*='card']", "a"];
      for (const sel of selectors) {
        const t = node.querySelector(sel);
        if (!t) continue;
        if (isGreetBtnLike(t)) continue;
        const cls = String(t.className || t.getAttribute("class") || "");
        if (/avatar/i.test(cls)) continue;
        if (!clickTargets.includes(t)) clickTargets.push(t);
      }
      let changed = false;
      for (let attempt = 0; attempt < 3 && !changed; attempt += 1) {
        for (const target of clickTargets) {
          clickWithEvents(target);
          await sleep(500 + attempt * 200);
          const afterSig = await panelSig();
          if (afterSig && beforeSig && afterSig !== beforeSig) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) {
        const opened = greetIsDetailOpened();
        if (opened) {
          return { ok: false, changed: false, already_opened: true, error: "详情页已处于打开状态但内容未切换（疑似上一位残留），已跳过" };
        }
        return { ok: false, changed: false, already_opened: false, error: "点击候选人卡片后详情页未打开（页面签名无变化）" };
      }
      return { ok: true, changed: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  function greetFindInputBox() {
    const selectors = [
      "textarea",
      "[contenteditable='true']",
      "[contenteditable='']",
      "input[type='text']",
      "[class*='chat-input'] textarea",
      "[class*='chat-input'] [contenteditable='true']",
      "[class*='input'] textarea",
      "[class*='input'] [contenteditable='true']",
      "[class*='editor']",
    ];
    for (const selector of selectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        if (isUiVisible(node)) return node;
      }
    }
    return null;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function greetFindDetailGreetButton() {
    const btns = Array.from(
      document.querySelectorAll(
        "button, [role='button'], [class*='btn'], [class*='Btn'], [class*='button'], div, span, a, li"
      )
    ).filter((b) => {
      try {
        if (!isVisible(b)) return false;
        const t = normalizeText(b.innerText || b.textContent || "");
        if (t === "打招呼") return true;
        if (/^打招呼\s*\d*$/.test(t)) return true;
        if (/^打招呼\s*[（(]?\d*[)）]?$/.test(t)) return true;
        return false;
      } catch (_err) {
        return false;
      }
    });
    if (!btns.length) return null;
    for (const b of btns) {
      let el = b;
      let found = false;
      for (let i = 0; i < 8; i += 1) {
        el = el.parentElement;
        if (!el) break;
        const t = normalizeText(el.innerText || "");
        if (GREET_DETAIL_MARKS.some((m) => t.includes(m))) {
          found = true;
          break;
        }
      }
      if (found) return b;
    }
    return btns.sort(
      (a, b) =>
        b.getBoundingClientRect().width * b.getBoundingClientRect().height -
        a.getBoundingClientRect().width * a.getBoundingClientRect().height
    )[0];
  }

  async function greetSendGreeting(text) {
    const detailBtn = greetFindDetailGreetButton();
    if (!detailBtn) return { ok: false, error: "未找到『打招呼』按钮（可能在详情页打开前就被调用了）" };
    try {
      highlightElement(detailBtn);
      detailBtn.click();
    } catch (_err) {
      // ignore
    }
    await sleep(1500);

    const input = greetFindInputBox();
    if (!input) {
      return { ok: true, note: "已点击『打招呼』按钮；未发现输入框，可能已直接发送或需人工确认" };
    }
    setNativeValue(input, text);
    await sleep(350);

    let sent = false;
    const nodes = Array.from(
      document.querySelectorAll("button, [role='button'], [class*='send'], [class*='btn'], [class*='action']")
    );
    const inputRect = input.getBoundingClientRect();
    for (const el of nodes) {
      if (!isUiVisible(el)) continue;
      const t = normalizeText(el.innerText || el.textContent || "");
      if (!/发送|打招呼|Enter|发送消息/.test(t)) continue;
      const rect = el.getBoundingClientRect();
      if (Math.abs(rect.top - inputRect.top) > 400) continue;
      try {
        el.click();
        sent = true;
        break;
      } catch (_err) {
        // ignore
      }
    }

    if (!sent) {
      try {
        input.focus();
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })
        );
        input.dispatchEvent(
          new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })
        );
        await sleep(300);
        sent = true;
      } catch (_err) {
        // ignore
      }
    }

    await sleep(600);
    return { ok: sent, note: "已执行发送动作，请留意页面是否真的发出" };
  }

  function greetDetailSig() {
    const text = normalizeText(document.body ? document.body.innerText || "" : "");
    return hashText(text.slice(0, 1200));
  }

  function greetPressArrowRight() {
    function fireKey(target) {
      if (!target) return false;
      try {
        const opts = {
          key: "ArrowRight",
          code: "ArrowRight",
          keyCode: 39,
          which: 39,
          bubbles: true,
          cancelable: true,
        };
        target.dispatchEvent(new KeyboardEvent("keydown", opts));
        target.dispatchEvent(new KeyboardEvent("keyup", opts));
        return true;
      } catch (_err) {
        return false;
      }
    }
    const before = greetDetailSig();
    let fired = fireKey(document.body);
    if (!fired) fired = fireKey(document);
    if (!fired) return { ok: false, error: "无法派发方向键事件" };
    return new Promise((resolve) => {
      setTimeout(() => {
        const after = greetDetailSig();
        resolve({ ok: true, changed: after !== before });
      }, 700);
    });
  }

  function greetCloseDetail() {
    function fireClick(el, x, y) {
      if (!el) return false;
      try {
        let cx = x;
        let cy = y;
        if (typeof cx !== "number" || typeof cy !== "number") {
          const rect = el.getBoundingClientRect();
          cx = rect.left + rect.width / 2;
          cy = rect.top + rect.height / 2;
        }
        const opts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: cx,
          clientY: cy,
          button: 0,
        };
        el.dispatchEvent(new MouseEvent("pointerdown", opts));
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));
        return true;
      } catch (_err) {
        try {
          el.click();
          return true;
        } catch (_err2) {
          return false;
        }
      }
    }

    function findCloseBtn(scope) {
      const root = scope || document;
      const sel =
        "button, [role='button'], [class*='btn'], [class*='Btn'], [class*='button'], a, i, [class*='icon'], [class*='close'], [class*='Close'], [class*='modal'], [class*='dialog'], [class*='drawer'], span, div";
      const els = Array.from(root.querySelectorAll(sel)).filter((el) => {
        try {
          return isVisible(el);
        } catch (_err) {
          return false;
        }
      });
      // 1) 语义优先：文本 / aria-label / title 含关闭或 ×
      for (const el of els) {
        const t = normalizeText(el.innerText || el.textContent || "").trim();
        if (t === "关闭" || t === "×" || t === "✕" || t === "✖") return el;
        const aria = (el.getAttribute("aria-label") || "").trim();
        const title = (el.getAttribute("title") || "").trim();
        const cls = String(el.className || el.getAttribute("class") || "");
        if (aria.includes("关闭") || title.includes("关闭")) return el;
        if (/(^|[\s_-])(close|Close|CLOSE)/.test(cls) && el.children.length <= 3) return el;
      }
      // 2) 右上角定位：优先按详情容器（右侧抽屉）的右上角，其次按视口右上角
      const scopeRect = scope ? scope.getBoundingClientRect() : null;
      const rightEdge = scopeRect ? scopeRect.right : window.innerWidth;
      const topEdge = scopeRect ? scopeRect.top : 0;
      const candidates = [];
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 72 && rect.height < 72 && rect.width > 6 && rect.height > 6) {
          const nearRight = scopeRect
            ? Math.abs(rect.right - rightEdge) <= 160
            : rect.right > window.innerWidth - 200;
          const nearTop = scopeRect
            ? rect.top - topEdge <= 180 && rect.top >= topEdge - 20
            : rect.top < 220;
          if (!nearRight || !nearTop) continue;
          const cls = String(el.className || el.getAttribute("class") || "");
          // 不强制要求 icon/close 特征，只要是右上角小元素都算候选，靠排序选中真正的 X
          candidates.push({ el, rect, cls });
        }
      }
      if (candidates.length) {
        candidates.sort(
          (a, b) => a.rect.top - b.rect.top || b.rect.right - a.rect.right
        );
        return candidates[0].el;
      }
      return null;
    }

    function findDetailScope() {
      const all = Array.from(
        document.querySelectorAll("div, section, [class*='modal'], [class*='dialog'], [class*='drawer'], [class*='panel'], [class*='content']")
      );
      for (const el of all) {
        try {
          if (!isVisible(el)) continue;
          const t = normalizeText(el.innerText || el.textContent || "");
          if (!GREET_DETAIL_MARKS.some((m) => t.includes(m))) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width > 400 && rect.height > 300) return el;
        } catch (_err) {
          // ignore
        }
      }
      return null;
    }

    // 点击详情面板旁边的灰色遮罩区域（抽屉/遮罩外区域），用户确认该方式可关闭详情页。
    // 返回 { el, x, y }：el 为遮罩/该坐标处元素，x/y 为灰色区域目标坐标（必须点这里，不能点元素中心——全屏遮罩的中心会落在详情面板上）
    function findMask(scope) {
      if (!scope) return null;
      const rect = scope.getBoundingClientRect();
      const y = Math.min(
        window.innerHeight - 2,
        Math.max(2, Math.round(rect.top + rect.height / 2))
      );
      // 详情面板左侧、右侧各取一个遮罩中点坐标，优先带遮罩特征的祖先元素
      const points = [
        Math.max(2, Math.round(rect.left / 2)),
        Math.min(window.innerWidth - 2, Math.round((rect.right + window.innerWidth) / 2)),
      ];
      for (const x of points) {
        let el = null;
        try {
          el = document.elementFromPoint(x, y);
        } catch (_err) {
          el = null;
        }
        if (!el) continue;
        let node = el;
        for (let i = 0; node && node !== document.body && i < 8; i += 1) {
          try {
            if (!isVisible(node)) { node = node.parentElement; continue; }
            const cls = String(node.className || node.getAttribute("class") || "");
            if (/mask|overlay|backdrop|shade|modal|dialog|drawer|popup/i.test(cls)) return { el: node, x, y };
          } catch (_err) {
            // ignore
          }
          node = node.parentElement;
        }
        return { el, x, y };
      }
      return null;
    }

    return new Promise(async (resolve) => {
      try {
        const scope = findDetailScope();
        const scopeInfo = scope
          ? `scope=${scope.tagName.toLowerCase()}.${String(scope.className || "").slice(0, 60)} rect=${Math.round(scope.getBoundingClientRect().width)}x${Math.round(scope.getBoundingClientRect().height)}`
          : "scope=null";
        if (!scope) {
          // 找不到详情容器，说明已经关闭
          resolve({ ok: true, method: "already_closed" });
          return;
        }
        // 关闭方式已确认：只点遮罩，多点几次直到抽屉容器消失。
        // X 按钮定位不可靠、Esc 无效，都不再尝试。
        let maskDiag = "";
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const mask = findMask(scope);
          if (!mask) {
            maskDiag = "未找到遮罩区域";
            break;
          }
          fireClick(mask.el, mask.x, mask.y);
          if (await waitDetailClosed(1800)) {
            resolve({ ok: true, method: "mask", attempts: attempt + 1 });
            return;
          }
          maskDiag = `已点击遮罩(${mask.el.tagName.toLowerCase()}.${String(mask.el.className || "").slice(0, 40)} @${mask.x},${mask.y})但详情页仍在`;
        }
        resolve({ ok: false, error: "多次点击遮罩仍未关闭详情页", diagnostic: `${scopeInfo}; ${maskDiag}` });
      } catch (err) {
        resolve({ ok: false, error: String(err) });
      }
    });
  }

  function greetEnsureNav() {
    if (greetFindCandidatePanel() || greetIsDetailOpened()) {
      return { ok: true, skipped: true };
    }
    // 已停在『推荐牛人』页但列表 iframe 未加载（如刷新后 iframe 未重建），点击已激活导航无效，直接标记等列表
    const curUrl = location.href || "";
    if (/recommend/i.test(curUrl)) {
      return { ok: true, skipped: true, already_on_page: true };
    }
    const candidates = Array.from(
      document.querySelectorAll("a, button, [role='menuitem'], [role='tab'], [class*='nav'], [class*='menu'], li, span, div")
    );
    let target = null;
    for (const n of candidates) {
      if (!isVisible(n)) continue;
      const t = normalizeText(n.innerText || n.textContent || "");
      if (t === "推荐牛人") {
        target = n;
        break;
      }
    }
    if (!target) return { ok: false, error: "未找到『推荐牛人』导航项，请手动点击左侧『推荐牛人』" };

    function fireClick(el) {
      if (!el) return;
      try {
        const rect = el.getBoundingClientRect();
        const opts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          button: 0,
        };
        el.dispatchEvent(new MouseEvent("pointerdown", opts));
        el.dispatchEvent(new MouseEvent("mousedown", opts));
        el.dispatchEvent(new MouseEvent("mouseup", opts));
        el.dispatchEvent(new MouseEvent("click", opts));
      } catch (_err) {
        try {
          el.click();
        } catch (_err2) {
          // ignore
        }
      }
    }

    // 优先点击最近的 <a> / <button> / 可点击祖先，再兜底点击文本节点本身
    let clicked = false;
    let el = target;
    for (let i = 0; el && el !== document.body && i < 7; i += 1) {
      if (el === target || /^(A|BUTTON|LI|DIV|SPAN)$/.test(el.tagName)) {
        if (isVisible(el)) {
          fireClick(el);
          clicked = true;
          break;
        }
      }
      el = el.parentElement;
    }
    if (!clicked) fireClick(target);
    return { ok: true, clicked: true, url: location.href };
  }

  function greetStatus() {
    const panel = greetFindCandidatePanel();
    const rows = panel ? greetGetCandidateRows(panel) : [];
    return {
      url: location.href,
      title: document.title,
      hasGreetBtn: !!panel,
      greetBtnCount: rows.length,
      hasDetailSignal: greetIsDetailOpened(),
      hasNav: Array.from(
        document.querySelectorAll("a, button, [role='menuitem'], [role='tab'], [class*='nav'], [class*='menu'], li, span, div")
      ).some((n) => {
        try {
          return isVisible(n) && normalizeText(n.innerText || n.textContent || "") === "推荐牛人";
        } catch (_err) {
          return false;
        }
      }),
    };
  }

  function greetScrollList() {
    const panel = greetFindCandidatePanel();
    if (!panel) return { ok: false, error: "未定位到候选人列表" };
    let scroller = panel;
    for (let i = 0; i < 10; i += 1) {
      if (scroller.scrollHeight > scroller.clientHeight + 60) break;
      if (!scroller.parentElement || scroller.parentElement === document.body) break;
      scroller = scroller.parentElement;
    }
    const prev = scroller.scrollTop;
    const step = Math.max(320, scroller.clientHeight * 0.6);
    scroller.scrollTop = prev + step;
    if (scroller.scrollTop === prev) {
      try {
        scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: step, bubbles: true, cancelable: true }));
      } catch (_err) {
        // ignore
      }
      scroller.scrollTop = prev + step;
    }
    return { ok: true, changed: scroller.scrollTop !== prev };
  }

  function scrollLeftPanel() {
    const panel = findLeftPanel();
    if (!panel) return { ok: false, error: "未定位到左侧列表面板" };
    const prev = panel.scrollTop;
    const step = Math.max(220, panel.clientHeight * 0.58);
    panel.scrollTop = prev + step;
    if (panel.scrollTop === prev) {
      try {
        panel.dispatchEvent(new WheelEvent("wheel", { deltaY: step, bubbles: true, cancelable: true }));
      } catch (_err) {
        // ignore
      }
      panel.scrollTop = prev + step;
    }
    return {
      ok: true,
      previous: prev,
      current: panel.scrollTop,
      changed: panel.scrollTop !== prev,
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    ensureStyles();

    (async () => {
      try {
        switch (message && message.type) {
          case "bzp_ping":
            sendResponse({ ok: true, url: location.href, title: document.title });
            break;
          case "bzp_prepare":
            if (message.skip_filter_click) {
              sendResponse({ ok: true, skipped: true });
              break;
            }
            sendResponse(await ensureExchangeFilter());
            break;
          case "bzp_list_sessions":
            sendResponse(listVisibleSessions());
            break;
          case "bzp_open_session":
            sendResponse(
              await openSessionByMarker(
                message.marker,
                message.session_key || "",
                message.name_guess || "",
                message.job_guess || ""
              )
            );
            break;
          case "bzp_extract_contact":
            sendResponse(await extractCurrentContact(Number(message.source_index || 0)));
            break;
          case "bzp_scroll_list":
            sendResponse(scrollLeftPanel());
            break;
          case "bzp_greet_probe":
            sendResponse(greetProbe());
            break;
          case "bzp_greet_list":
            sendResponse(greetListCandidates());
            break;
          case "bzp_greet_status":
            sendResponse(greetStatus());
            break;
          case "bzp_greet_nav":
            sendResponse(greetEnsureNav());
            break;
          case "bzp_greet_open":
            sendResponse(await greetOpenCandidate(String(message.marker || "")));
            break;
          case "bzp_greet_check":
            sendResponse(await greetCheckKeywords(Array.isArray(message.keywords) ? message.keywords : []));
            break;
          case "bzp_greet_send":
            sendResponse(await greetSendGreeting(String(message.greeting || "")));
            break;
          case "bzp_greet_scroll":
            sendResponse(greetScrollList());
            break;
          case "bzp_greet_arrow":
            sendResponse(await greetPressArrowRight());
            break;
          case "bzp_greet_close":
            sendResponse(await greetCloseDetail());
            break;
          case "bzp_clear_highlight":
            clearHighlight();
            sendResponse({ ok: true });
            break;
          case "bzp_overlay_show":
            ensureFloatingBadge(Boolean(message.force));
            setFloatingRunning(true);
            sendResponse({ ok: true });
            break;
          case "bzp_overlay_update":
            ensureFloatingBadge(false);
            setFloatingRunning(true);
            sendResponse({ ok: true });
            break;
          case "bzp_overlay_hide":
            ensureFloatingBadge(true);
            setFloatingRunning(false);
            sendResponse({ ok: true });
            break;
          case "bzp_overlay_idle":
            ensureFloatingBadge(false);
            setFloatingRunning(false);
            sendResponse({ ok: true });
            break;
          default:
            sendResponse({ ok: false, error: "unknown message type" });
            break;
        }
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();

    return true;
  });

  ensureStyles();
  removeFloatingBadge();
  setFloatingRunning(false);
})();
