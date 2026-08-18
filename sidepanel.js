(function () {
  let db = null;
  const GLOBAL_SCOPE_KEY = "ui.accountScope.global";

  const state = {
    running: false,
    stopRequested: false,
    runId: null,
    processed: 0,
    saved: 0,
    skipped: 0,
    sourceIndex: 0,
    touchedMarkers: new Set(),
    accountScope: "default",
    mode: "collect",
    greeted: 0,
    matched: 0,
    notMatched: 0,
  };

  const ui = {
    accountScope: document.getElementById("accountScope"),
    maxItems: document.getElementById("maxItems"),
    maxEmptyCycles: document.getElementById("maxEmptyCycles"),
    modeCollect: document.getElementById("modeCollect"),
    modeGreet: document.getElementById("modeGreet"),
    greetConfig: document.getElementById("greetConfig"),
    greetKeywords: document.getElementById("greetKeywords"),
    greetMessage: document.getElementById("greetMessage"),
    greetMax: document.getElementById("greetMax"),
    startBtn: document.getElementById("startBtn"),
    exportBtn: document.getElementById("exportBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    clearBtn: document.getElementById("clearBtn"),
    kpiTotal: document.getElementById("kpiTotal"),
    kpiProcessed: document.getElementById("kpiProcessed"),
    kpiSaved: document.getElementById("kpiSaved"),
    kpiSkipped: document.getElementById("kpiSkipped"),
    statusBox: document.getElementById("statusBox"),
    logBox: document.getElementById("logBox"),
    runsBox: document.getElementById("runsBox"),
  };

  function currentMode() {
    return ui.modeGreet && ui.modeGreet.checked ? "greet" : "collect";
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function nowFileTime() {
    const d = new Date();
    const pad = (v) => String(v).padStart(2, "0");
    return (
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
      `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    );
  }

  function randDelay(min = 220, max = 550) {
    const ms = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setStatus(text, level) {
    ui.statusBox.textContent = text;
    ui.statusBox.classList.remove("ok", "warn", "err");
    if (level) ui.statusBox.classList.add(level);
  }

  function log(line) {
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    ui.logBox.textContent = `[${ts}] ${line}\n${ui.logBox.textContent}`;
  }

  function updateKpis(total) {
    ui.kpiTotal.textContent = String(total);
    ui.kpiProcessed.textContent = String(state.processed);
    ui.kpiSaved.textContent = String(state.saved);
    ui.kpiSkipped.textContent = String(state.skipped);
  }

  function normalizeText(v) {
    return String(v || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sanitizeJobName(v) {
    let t = normalizeText(v);
    if (!t) return "";
    const patterns = [
      /职位来源说明\s*查看职位/gi,
      /职位来源说明\s*查看岗位/gi,
      /查看职位/gi,
      /查看岗位/gi,
      /查看工作/gi,
    ];
    for (const p of patterns) {
      t = t.replace(p, " ");
    }
    t = t.replace(/\s+/g, " ").trim();
    return t;
  }

  function sanitizeHrName(v) {
    let t = normalizeText(v);
    if (!t) return "";
    t = t
      .replace(/(招聘者|HR|人事|主管|经理|总监)\s*$/i, "")
      .replace(/[，,。;；]+$/, "")
      .trim();
    if (!t) return "";
    const first = t.split(/[ |\t|｜|丨|/]+/).filter(Boolean)[0] || t;
    const mCn = first.match(/^([\u4e00-\u9fa5]{1,3}(?:先生|女士|小姐)?)/);
    if (mCn) return normalizeText(mCn[1]);
    const mEn = first.match(/^([A-Za-z][A-Za-z0-9_.-]{1,24})/);
    if (mEn) return normalizeText(mEn[1]);
    return first.slice(0, 8);
  }

  function normalizeScopeId(v) {
    const t = String(v || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "");
    return t || "default";
  }

  function getStoredScope() {
    try {
      return normalizeScopeId(window.localStorage.getItem(GLOBAL_SCOPE_KEY) || "default");
    } catch (_err) {
      return "default";
    }
  }

  function setStoredScope(scope) {
    try {
      window.localStorage.setItem(GLOBAL_SCOPE_KEY, normalizeScopeId(scope));
    } catch (_err) {
      // ignore
    }
  }

  async function getActiveBossTab(mode = "collect") {
    const isGeekChat = (url) =>
      typeof url === "string" && /https:\/\/([a-z0-9-]+\.)?zhipin\.com\/web\/geek\/chat/i.test(url);
    const isZhipin = (url) => typeof url === "string" && /^https:\/\/([a-z0-9-]+\.)?zhipin\.com\//i.test(url);
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const active = tabs[0];
    if (mode === "greet") {
      if (active && isZhipin(active.url)) {
        return active;
      }
      const matched = await chrome.tabs.query({ url: ["https://*.zhipin.com/*"] });
      if (matched && matched.length) {
        const focused = matched.find((t) => t.active) || matched[0];
        return focused || null;
      }
      return null;
    }
    if (active && isGeekChat(active.url)) {
      return active;
    }
    const matched = await chrome.tabs.query({ url: ["https://*.zhipin.com/web/geek/chat*"] });
    if (matched && matched.length) {
      const focused = matched.find((t) => t.active) || matched[0];
      return focused || null;
    }
    return null;
  }

  function sendToFrame(tabId, frameId, type, payload) {
    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.sendMessage(tabId, { type, ...payload }, { frameId }, (resp) => {
          const err = chrome.runtime.lastError;
          if (err) {
            reject(new Error("无法连接页面脚本，请刷新页面后重试"));
            return;
          }
          resolve(resp || {});
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async function greetResolveFrameId(tabId) {
    let frames = [];
    try {
      frames = await chrome.webNavigation.getAllFrames({ tabId });
    } catch (_err) {
      frames = [];
    }
    const candidates = [];
    for (const f of frames || []) {
      if (f.errorOccurred || f.frameId == null) continue;
      try {
        const r = await sendToFrame(tabId, f.frameId, "bzp_greet_probe", {});
        if (r && r.ok) {
          candidates.push({
            frameId: f.frameId,
            url: r.url || f.url || "",
            hasGreetBtn: !!r.hasGreetBtn,
            hasNav: !!r.hasNav,
            bodyText: r.bodyText || "",
          });
        }
      } catch (_err) {
        // 该 frame 无 content script，跳过
      }
    }
    const hit =
      candidates.find((c) => c.hasGreetBtn) ||
      candidates.find((c) => /\/web\/frame\/|c-resume/i.test(c.url)) ||
      candidates.find((c) => c.hasNav);
    if (hit) return { frameId: hit.frameId, frames: candidates };
    return { frameId: 0, frames: candidates };
  }

  async function sendToActiveTab(type, payload, mode) {
    const tab = await getActiveBossTab(mode || state.mode);
    if (!tab || !tab.id) {
      throw new Error(
        (mode || state.mode) === "greet"
          ? "未找到 BOSS 直聘页面标签，请先打开招聘者端候选人列表页（如候选人/牛人列表）"
          : "未找到 BOSS 消息页标签，请先打开 https://www.zhipin.com/web/geek/chat"
      );
    }
    if ((mode || state.mode) === "greet") {
      let frameId = state.greetFrameId;
      let frames = state.greetFrames || [];
      const cacheValid = frameId && frames.some((f) => f.frameId === frameId && f.hasGreetBtn);
      if (!cacheValid) {
        const r = await greetResolveFrameId(tab.id);
        frameId = r.frameId;
        frames = r.frames || [];
        if (frameId && frames.some((f) => f.frameId === frameId && f.hasGreetBtn)) {
          state.greetFrameId = frameId;
          state.greetFrames = frames;
        }
      }
      try {
        return await sendToFrame(tab.id, frameId, type, payload);
      } catch (err) {
        // 缓存帧失效（页面刷新 / iframe 重建），重新解析一次再发
        try {
          const r = await greetResolveFrameId(tab.id);
          frameId = r.frameId;
          frames = r.frames || [];
          state.greetFrameId = frameId;
          state.greetFrames = frames;
          return await sendToFrame(tab.id, frameId, type, payload);
        } catch (err2) {
          return { ok: false, error: `页面脚本通信失败（${err2 && err2.message ? err2.message : String(err2)}），请刷新招聘端页面后重试` };
        }
      }
    }
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { type, ...payload }, (resp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(
            new Error(
              "无法连接页面脚本，请刷新消息页后重试（常见于插件刚加载或页面长时间未刷新）"
            )
          );
          return;
        }
        resolve(resp || {});
      });
    });
  }

  function csvEscape(v) {
    const s = String(v == null ? "" : v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, "\"\"")}"`;
    return s;
  }

  async function exportCsv() {
    const rows = await db.listContacts();
    if (!rows.length) {
      setStatus("暂无可导出数据", "warn");
      return;
    }
    const sorted = rows
      .slice()
      .sort((a, b) => String(a.collected_at || "").localeCompare(String(b.collected_at || "")));
    const headers = ["序号", "岗位名称", "HR姓名", "微信号", "电话", "去重键"];
    const lines = [headers.join(",")];
    for (let i = 0; i < sorted.length; i += 1) {
      const r = sorted[i];
      const safeHr = sanitizeHrName(r.hr_name);
      const safeJob = sanitizeJobName(r.job_name);
      lines.push(
        [
          i + 1,
          safeJob,
          safeHr,
          r.wechat || "",
          r.phone || "",
          r.dedupe_key || "",
        ]
          .map(csvEscape)
          .join(",")
      );
    }
    const csv = `\ufeff${lines.join("\n")}`;
    const url = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    await chrome.downloads.download({
      url,
      filename: `boss_contacts_total_${nowFileTime()}.csv`,
      saveAs: false,
    });
    setStatus(`CSV 导出完成，共 ${sorted.length} 条`, "ok");
  }

  function renderRuns(runs) {
    if (!runs.length) {
      ui.runsBox.innerHTML = '<div class="run-item">暂无运行记录</div>';
      return;
    }
    const html = runs
      .map((r) => {
        const status = r.status || "unknown";
        const processed = Number(r.processed || 0);
        const saved = Number(r.saved || 0);
        const skipped = Number(r.skipped || 0);
        const started = r.started_at ? new Date(r.started_at).toLocaleString("zh-CN") : "-";
        const ended = r.ended_at ? new Date(r.ended_at).toLocaleString("zh-CN") : "-";
        return (
          `<div class="run-item">` +
          `<strong>#${r.id} ${status}</strong><br/>` +
          `处理 ${processed} · 新增 ${saved} · 跳过 ${skipped}<br/>` +
          `<small>${started} → ${ended}</small>` +
          `</div>`
        );
      })
      .join("");
    ui.runsBox.innerHTML = html;
  }

  async function refreshDashboard() {
    if (!db) {
      updateKpis(0);
      renderRuns([]);
      return;
    }
    const [contacts, runs] = await Promise.all([db.listContacts(), db.listRuns(12)]);
    updateKpis(contacts.length);
    renderRuns(runs);
  }

  async function loadSettings() {
    if (!db) return;
    const maxItems = await db.getKV("ui.maxItems", "240");
    const maxEmptyCycles = await db.getKV("ui.maxEmptyCycles", "6");
    const greetKeywords = await db.getKV("ui.greetKeywords", "");
    const greetMessage = await db.getKV(
      "ui.greetMessage",
      "您好，看到您的经历与我们的岗位很匹配，方便聊聊吗？"
    );
    const greetMax = await db.getKV("ui.greetMax", "50");
    const mode = await db.getKV("ui.mode", "collect");
    ui.maxItems.value = String(maxItems || "240");
    ui.maxEmptyCycles.value = String(maxEmptyCycles || "6");
    ui.greetKeywords.value = String(greetKeywords || "");
    ui.greetMessage.value = String(greetMessage || "");
    ui.greetMax.value = String(greetMax || "50");
    if (mode === "greet") {
      ui.modeGreet.checked = true;
      ui.modeCollect.checked = false;
    } else {
      ui.modeCollect.checked = true;
      ui.modeGreet.checked = false;
    }
    state.mode = currentMode();
    ui.greetConfig.classList.toggle("hidden", state.mode !== "greet");
  }

  async function saveSettings() {
    if (!db) return;
    await Promise.all([
      db.setKV("ui.maxItems", String(ui.maxItems.value || "240")),
      db.setKV("ui.maxEmptyCycles", String(ui.maxEmptyCycles.value || "6")),
      db.setKV("ui.greetKeywords", String(ui.greetKeywords.value || "")),
      db.setKV("ui.greetMessage", String(ui.greetMessage.value || "")),
      db.setKV("ui.greetMax", String(ui.greetMax.value || "50")),
      db.setKV("ui.mode", currentMode()),
    ]);
  }

  function setRunButtonState(running) {
    ui.startBtn.textContent = running ? "结束" : "开始";
    ui.startBtn.classList.toggle("danger", running);
    ui.startBtn.classList.toggle("primary", !running);
  }

  function setButtonsRunning(running) {
    setRunButtonState(Boolean(running));
    ui.startBtn.disabled = false;
    ui.exportBtn.disabled = running;
    ui.refreshBtn.disabled = running;
    ui.clearBtn.disabled = running;
    ui.accountScope.disabled = running;
    ui.maxItems.disabled = running;
    ui.maxEmptyCycles.disabled = running;
    ui.modeCollect.disabled = running;
    ui.modeGreet.disabled = running;
    ui.greetKeywords.disabled = running;
    ui.greetMessage.disabled = running;
    ui.greetMax.disabled = running;
  }

  async function switchScope(scopeValue, options = {}) {
    const scope = normalizeScopeId(scopeValue || "default");
    const silent = Boolean(options.silent);
    if (state.running) {
      throw new Error("运行中不可切换账号隔离ID，请先停止");
    }
    if (db && state.accountScope === scope) {
      ui.accountScope.value = scope;
      setStoredScope(scope);
      return;
    }

    if (db) {
      db.close();
    }
    db = new window.CollectorDB(scope);
    await db.open();

    state.accountScope = scope;
    state.processed = 0;
    state.saved = 0;
    state.skipped = 0;
    state.sourceIndex = 0;
    state.touchedMarkers = new Set();

    ui.accountScope.value = scope;
    setStoredScope(scope);
    await loadSettings();
    await refreshDashboard();

    if (!silent) {
      setStatus(`已切换账号隔离ID: ${scope}`, "ok");
      log(`已切换到账号隔离ID: ${scope}`);
    }
  }

  async function clearHistoryWithConfirm() {
    if (state.running) {
      setStatus("运行中不可清空，请先停止", "warn");
      return;
    }
    const ok1 = window.confirm("确认清空历史吗？将删除已采集联系人和运行记录。");
    if (!ok1) return;
    const ok2 = window.confirm("请再次确认：清空后不可恢复，确定继续吗？");
    if (!ok2) return;

    await db.clearHistory();
    state.processed = 0;
    state.saved = 0;
    state.skipped = 0;
    state.sourceIndex = 0;
    state.touchedMarkers = new Set();
    updateKpis(0);
    ui.logBox.textContent = "";
    await refreshDashboard();
    setStatus(`历史已清空（账号ID: ${state.accountScope}）`, "ok");
    log(`历史数据已清空（账号ID: ${state.accountScope}）。`);
  }

  async function finishRun(status, errorMessage) {
    state.running = false;
    setButtonsRunning(false);
    try {
      await sendToActiveTab("bzp_clear_highlight");
    } catch (_err) {
      // ignore
    }
    if (state.runId) {
      await db.updateRun(state.runId, {
        status,
        ended_at: nowIso(),
        processed: state.processed,
        saved: state.saved,
        skipped: state.skipped,
        error: errorMessage || "",
      });
    }
    await refreshDashboard();
  }

  async function runGreeter() {
    try {
      const inputScope = normalizeScopeId(ui.accountScope.value || state.accountScope || "default");
      if (!db || inputScope !== state.accountScope) {
        await switchScope(inputScope, { silent: true });
      }

      const keywords = String(ui.greetKeywords.value || "")
        .split(/[,，、;；\s]+/)
        .map((v) => String(v || "").trim())
        .filter(Boolean);
      const greeting = String(ui.greetMessage.value || "").trim();
      const greetMax = Math.max(1, Number(ui.greetMax.value || 50));
      const maxEmptyCycles = Math.max(1, Number(ui.maxEmptyCycles.value || 6));

      if (!keywords.length) {
        setStatus("请先填写关键字（如：普拉提、瑜伽）", "err");
        return;
      }
      if (!greeting) {
        setStatus("请先填写打招呼话术", "err");
        return;
      }
      setStatus("准备启动关键字打招呼…", null);

      state.running = true;
      state.stopRequested = false;
      state.runId = null;
      state.processed = 0;
      state.saved = 0;
      state.skipped = 0;
      state.greeted = 0;
      state.matched = 0;
      state.notMatched = 0;
      state.mode = "greet";
      state.touchedMarkers = new Set();
      state.greetFrameId = null;
      state.greetFrames = [];
      setButtonsRunning(true);

      await saveSettings();
      state.runId = await db.addRun({
        started_at: nowIso(),
        status: "running",
        processed: 0,
        saved: 0,
        skipped: 0,
        settings: { mode: "greet", keywords, greeting, greetMax, account_scope: state.accountScope },
      });
      log(`开始关键字打招呼 #${state.runId}：关键字 [${keywords.join("、")}]，上限 ${greetMax} 人。`);

      const ping = await sendToActiveTab("bzp_ping", {}, "greet");
      if (!ping || !ping.ok) {
        throw new Error("页面通信失败，请刷新招聘端页面后重试");
      }

      const st = await sendToActiveTab("bzp_greet_status", {}, "greet");
      if (st && st.url) {
        log(`当前页面: ${st.url}`);
        log(
          `页面状态: 候选人卡片 ${st.greetBtnCount} 张 / 详情已打开 ${st.hasDetailSignal ? "是" : "否"} / 含『推荐牛人』导航 ${st.hasNav ? "是" : "否"}`
        );
      }
      if (state.greetFrames && state.greetFrames.length) {
        log(
          `页面框架: ${state.greetFrames
            .map(
              (f) =>
                `#${f.frameId} ${f.url}${f.hasGreetBtn ? " [含打招呼按钮]" : ""}${
                  f.hasNav ? " [含招聘端导航]" : ""
                } 正文:${(f.bodyText || "").slice(0, 120)}`
            )
            .join(" | ")}`
        );
      }

      const navRes = await sendToActiveTab("bzp_greet_nav", {}, "greet");
      if (navRes && navRes.ok && (navRes.clicked || navRes.already_on_page)) {
        if (navRes.clicked) {
          log("已自动点击『推荐牛人』导航，等待列表加载…");
        } else if (navRes.already_on_page) {
          log("已在『推荐牛人』页面，等待列表 iframe 加载…");
        }
        let waitReady = false;
        for (let w = 0; w < 12; w += 1) {
          if (state.stopRequested) break;
          await randDelay(900, 1300);
          const probe = await sendToActiveTab("bzp_greet_list", {}, "greet");
          if (probe && probe.ok && Array.isArray(probe.sessions)) {
            log(`候选人列表已就绪，识别到 ${probe.sessions.length} 张卡片`);
            waitReady = true;
            break;
          }
          if (probe && probe.debug && probe.debug.length) {
            log(`页面可见按钮文本：${probe.debug.join(" / ")}`);
          }
        }
        if (!waitReady && !state.stopRequested) {
          const st2 = await sendToActiveTab("bzp_greet_status", {}, "greet");
          log(
            `等待列表超时。当前页面 ${(st2 && st2.url) || "未知"}，候选人卡片 ${(st2 && st2.greetBtnCount) || 0} 张。若已停在『推荐牛人』页但仍无列表，请刷新招聘端页面(F5)后再点开始`
          );
        }
      } else if (navRes && navRes.error) {
        log(`导航提示：${navRes.error}`);
      }

      let emptyCycles = 0;
      while (!state.stopRequested && state.greeted < greetMax && emptyCycles < maxEmptyCycles) {
        const listed = await sendToActiveTab("bzp_greet_list", {}, "greet");
        if (!listed || !listed.ok || !Array.isArray(listed.sessions)) {
          if (listed && listed.error && listed.error.includes("未定位到")) {
            emptyCycles += 1;
            log(`候选列表未定位（${emptyCycles}/${maxEmptyCycles}），请确认已打开招聘端候选人列表页`);
            if (listed.debug && listed.debug.length) {
              log(`页面可见按钮文本：${listed.debug.join(" / ")}`);
            }
            if (listed.bodyText) {
              log(`页面正文：${listed.bodyText}`);
            }
            setStatus("候选列表未定位，请检查招聘端页面", "warn");
            await randDelay(1200, 2200);
            continue;
          }
          throw new Error((listed && listed.error) || "读取候选人列表失败");
        }

        const sessions = listed.sessions.filter(
          (s) => s && s.marker && !state.touchedMarkers.has(s.marker)
        );
        if (!sessions.length) {
          emptyCycles += 1;
          log(`本轮无新候选人（${emptyCycles}/${maxEmptyCycles}），滚动列表继续查找…`);
          const scrolled = await sendToActiveTab("bzp_greet_scroll", {}, "greet");
          if (!scrolled || !scrolled.ok) {
            log("列表已滚动到底部或无法继续滚动");
            if (emptyCycles >= maxEmptyCycles) break;
          }
          await randDelay(800, 1400);
          continue;
        }

        emptyCycles = 0;
        for (const s of sessions) {
          try {
          if (state.stopRequested || state.greeted >= greetMax) break;
          if (!s || !s.marker) continue;
          if (state.touchedMarkers.has(s.marker)) continue;

          state.touchedMarkers.add(s.marker);
          state.processed += 1;
          setStatus(`检查中 ${state.processed} 人，已打招呼 ${state.greeted}/${greetMax}`, null);
          updateKpis(state.greeted);

          const opened = await sendToActiveTab("bzp_greet_open", { marker: s.marker }, "greet");
          if (!opened || !opened.ok) {
            state.skipped += 1;
            log(`打开候选人失败: ${s.name_guess || s.marker}（${(opened && opened.error) || "无响应"}）`);
            try { await sendToActiveTab("bzp_greet_close", {}, "greet"); } catch (_e) { /* ignore */ }
            continue;
          }
          await randDelay(900, 1500);

          const checked = await sendToActiveTab("bzp_greet_check", { keywords }, "greet");
          if (!checked || !checked.ok) {
            state.skipped += 1;
            log(`读取候选人详情失败: ${s.name_guess || s.marker}（${(checked && checked.error) || "无响应"}）`);
            continue;
          }
          if (checked.fullText) {
            const ft = String(checked.fullText);
            log(
              `抓到正文(${ft.length}字): ${ft.slice(0, 300)}${ft.length > 300 ? "…" : ""}`
            );
          }

          const name = s.name_guess || "未知候选人";
          const matchedKw = (checked.hits || []).join("、") || keywords[0] || "";
          if (checked.matched) {
            if (Array.isArray(checked.hitsContext) && checked.hitsContext.length) {
              for (const hc of checked.hitsContext) {
                log(`命中位置: ${hc.ctx}`);
              }
            }
            const sent = await sendToActiveTab(
              "bzp_greet_send",
              { greeting },
              "greet"
            );
            if (sent && sent.ok) {
              state.greeted += 1;
              state.matched += 1;
              log(`已打招呼: ${name}（命中: ${matchedKw}）`);
              const record = {
                hr_name: name,
                job_name: `[打招呼] 命中关键字: ${matchedKw}`,
                wechat: "已打招呼",
                phone: "",
                dedupe_key: buildDedupeKey(name, matchedKw, "", ""),
              };
              try {
                await db.putContact(record);
              } catch (_err) {
                // ignore
              }
              await db.setSignature(`greet:${s.marker}`, "1");
            } else {
              state.skipped += 1;
              log(`发送打招呼失败: ${name}（${(sent && sent.error) || "未知原因"}）`);
            }
            await randDelay(900, 1800);
          } else {
            state.notMatched += 1;
            log(`跳过（未命中关键字）: ${name}`);
            await randDelay(400, 800);
          }

          // 朴素流程：无论是否命中，都点遮罩关闭详情页，返回列表后再看下一位
          let closed = await sendToActiveTab("bzp_greet_close", {}, "greet");
          if (!closed || !closed.ok) {
            await randDelay(600, 1000);
            closed = await sendToActiveTab("bzp_greet_close", {}, "greet");
          }
          if (closed && closed.ok) {
            log(`已关闭详情页（${closed.method || "button"}），返回列表`);
          } else {
            log(`关闭详情页失败: ${(closed && closed.error) || "未知原因"}，尝试继续下一轮`);
          }
          await randDelay(800, 1400);

          if (state.greeted >= greetMax) break;
          } catch (err) {
            state.skipped += 1;
            log(`处理候选人异常: ${s.name_guess || s.marker}（${err && err.message ? err.message : String(err)}），已跳过`);
            try { await sendToActiveTab("bzp_greet_close", {}, "greet"); } catch (_e) { /* ignore */ }
            await randDelay(600, 1000);
          }
        }

        const scrolled = await sendToActiveTab("bzp_greet_scroll", {}, "greet");
        if (!scrolled || !scrolled.ok) {
          log("列表无法继续滚动，可能已到底");
        }
        await randDelay(900, 1600);
      }

      if (state.greeted >= greetMax) {
        log(`已达到上限 ${greetMax} 人，停止。`);
      } else if (emptyCycles >= maxEmptyCycles) {
        log("连续多轮无新候选人，停止。");
      }
      await finishRun("done");
      setStatus(
        `完成：检查 ${state.processed} 人，打招呼 ${state.greeted} 人，未命中 ${state.notMatched} 人`,
        "ok"
      );
      log(`完成：打招呼 ${state.greeted}/${greetMax} 人。`);
    } catch (err) {
      state.running = false;
      setButtonsRunning(false);
      setStatus(`出错: ${err.message}`, "err");
      log(`出错: ${err.message}`);
      if (state.runId) {
        await db.updateRun(state.runId, {
          status: "error",
          ended_at: nowIso(),
          processed: state.processed,
          saved: state.saved,
          skipped: state.skipped,
          error: err.message || "",
        });
      }
      await refreshDashboard();
    }
  }

  function buildDedupeKey(hrName, jobName, wechat, phone) {
    const parts = [hrName, jobName, wechat, phone].map((v) => String(v || "").trim()).filter(Boolean);
    return parts.join("|");
  }

  async function runCollector() {
    try {
      const inputScope = normalizeScopeId(ui.accountScope.value || state.accountScope || "default");
      if (!db || inputScope !== state.accountScope) {
        await switchScope(inputScope, { silent: true });
      }

      state.running = true;
      state.stopRequested = false;
      state.runId = null;
      state.processed = 0;
      state.saved = 0;
      state.skipped = 0;
      state.sourceIndex = 0;
      state.touchedMarkers = new Set();
      setButtonsRunning(true);

      await saveSettings();
      const maxItems = Math.max(20, Number(ui.maxItems.value || 240));
      const maxEmptyCycles = Math.max(2, Number(ui.maxEmptyCycles.value || 6));

      state.runId = await db.addRun({
        started_at: nowIso(),
        status: "running",
        processed: 0,
        saved: 0,
        skipped: 0,
        settings: { maxItems, maxEmptyCycles, account_scope: state.accountScope, auto_switch_exchange: true },
      });
      log(`开始运行 #${state.runId}（账号ID: ${state.accountScope}），上限 ${maxItems} 条。`);

      const ping = await sendToActiveTab("bzp_ping");
      if (!ping || !ping.ok) {
        throw new Error("消息页通信失败，请刷新页面后重试");
      }
      log("按当前页面筛选状态开始采集。");

      let emptyCycles = 0;
      while (!state.stopRequested && state.processed < maxItems && emptyCycles < maxEmptyCycles) {
        let cycleWorkCount = 0;
        let relistPass = 0;
        while (!state.stopRequested && state.processed < maxItems && relistPass < 4) {
          const listed = await sendToActiveTab("bzp_list_sessions");
          if (!listed || !listed.ok || !Array.isArray(listed.sessions)) {
            throw new Error((listed && listed.error) || "读取列表失败");
          }
          const sessions = listed.sessions.filter(
            (s) => s && s.marker && s.session_key && !state.touchedMarkers.has(s.marker)
          );
          if (!sessions.length) break;

          relistPass += 1;
          for (const s of sessions) {
            if (state.stopRequested || state.processed >= maxItems) break;
            if (!s || !s.marker || !s.session_key) continue;
            if (state.touchedMarkers.has(s.marker)) continue;

            state.touchedMarkers.add(s.marker);
            state.processed += 1;
            state.sourceIndex += 1;
            cycleWorkCount += 1;
            setStatus(`处理中 ${state.processed}/${maxItems}`, null);
            updateKpis(Number(ui.kpiTotal.textContent || 0));

            const oldSignature = await db.getSignature(s.session_key);
            if (oldSignature && oldSignature === String(s.signature || "") && !s.has_unread) {
              state.skipped += 1;
              continue;
            }
            if (oldSignature && oldSignature === String(s.signature || "") && s.has_unread) {
              log(`未读会话强制复核: ${s.name_guess || s.session_key}`);
            }

            const opened = await sendToActiveTab("bzp_open_session", {
              marker: s.marker,
              session_key: s.session_key,
              name_guess: s.name_guess,
              job_guess: s.job_guess,
            });
            if (!opened || !opened.ok) {
              state.skipped += 1;
              log(`打开会话失败: ${s.name_guess || s.session_key}`);
              if (opened && opened.error && String(opened.error).includes("未找到会话节点")) {
                state.touchedMarkers.delete(s.marker);
              }
              continue;
            }
            const openReliable = Boolean(opened.panel_changed || opened.selected || opened.header_matched);
            if (!openReliable) {
              log(`会话切换不确定，继续尝试采集: ${s.name_guess || s.session_key}`);
            }
            await randDelay(260, 680);

            const extracted = await sendToActiveTab("bzp_extract_contact", {
              source_index: state.sourceIndex,
            });
            if (!extracted || !extracted.ok) {
              state.skipped += 1;
              log(`提取失败: ${(extracted && extracted.error) || s.session_key}`);
              continue;
            }

            if (!extracted.has_contact) {
              state.skipped += 1;
              if (openReliable) {
                await db.setSignature(s.session_key, String(s.signature || ""));
              } else {
                log(`未采到联系方式且切换不确定，保留重试: ${s.name_guess || s.session_key}`);
              }
              continue;
            }

            const record = { ...(extracted.record || {}) };
            if (!record.hr_name) {
              record.hr_name = s.name_guess || opened.name_guess || opened.header_hr || "";
            }
            if (!record.job_name) record.job_name = s.job_guess || opened.job_guess || "";
            if (!record.source_index) record.source_index = String(state.sourceIndex);
            record.job_name = sanitizeJobName(record.job_name);
            record.hr_name = normalizeText(
              s.name_guess || opened.name_guess || record.hr_name || opened.header_hr || ""
            );
            record.hr_name = sanitizeHrName(record.hr_name);
            const nameMatched =
              !s.name_guess ||
              !record.hr_name ||
              String(record.hr_name).includes(String(s.name_guess)) ||
              String(s.name_guess).includes(String(record.hr_name));
            if (!openReliable && !nameMatched) {
              state.skipped += 1;
              log(`疑似未切到目标会话，跳过保存: ${s.name_guess || s.session_key}`);
              continue;
            }

            const inserted = await db.putContact(record);
            if (openReliable || nameMatched) {
              await db.setSignature(s.session_key, String(s.signature || ""));
            }
            if (inserted) {
              state.saved += 1;
              log(`新增: ${record.hr_name || "-"} / ${record.job_name || "-"}`);
            } else {
              state.skipped += 1;
            }

            await db.updateRun(state.runId, {
              processed: state.processed,
              saved: state.saved,
              skipped: state.skipped,
            });
            await randDelay(180, 520);
          }
          await randDelay(120, 260);
        }

        if (!cycleWorkCount) {
          emptyCycles += 1;
          log(`本轮无新会话可处理，空轮 ${emptyCycles}/${maxEmptyCycles}`);
        } else {
          emptyCycles = 0;
        }

        const scrolled = await sendToActiveTab("bzp_scroll_list");
        if (!scrolled || !scrolled.ok || !scrolled.changed) {
          emptyCycles += 1;
        }
        await randDelay(550, 980);
      }

      if (state.stopRequested) {
        log("运行已手动停止。");
        setStatus("已停止", "warn");
        await finishRun("stopped", "");
      } else {
        const reason =
          state.processed >= Number(ui.maxItems.value || 240)
            ? "达到最大处理条数"
            : "连续空轮到达阈值";
        log(`运行完成: ${reason}`);
        setStatus(`完成：新增 ${state.saved}，跳过 ${state.skipped}`, "ok");
        await finishRun("done", "");
      }
    } catch (err) {
      const message = String((err && err.message) || err || "未知错误");
      log(`错误: ${message}`);
      setStatus(`异常中断: ${message}`, "err");
      await finishRun("error", message);
    }
  }

  function bindEvents() {
    const applyScopeFromInput = async () => {
      const next = normalizeScopeId(ui.accountScope.value || "default");
      if (next === state.accountScope) {
        ui.accountScope.value = next;
        return;
      }
      await switchScope(next, { silent: false });
    };

    ui.accountScope.addEventListener("change", async () => {
      try {
        await applyScopeFromInput();
      } catch (err) {
        setStatus(`切换账号失败: ${String(err.message || err)}`, "err");
      }
    });
    ui.accountScope.addEventListener("keydown", async (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      try {
        await applyScopeFromInput();
      } catch (err) {
        setStatus(`切换账号失败: ${String(err.message || err)}`, "err");
      }
    });

    ui.modeCollect.addEventListener("change", async () => {
      state.mode = currentMode();
      ui.greetConfig.classList.toggle("hidden", state.mode !== "greet");
      try {
        await saveSettings();
      } catch (_err) {
        // ignore
      }
      setStatus(state.mode === "greet" ? "已切换：关键字自动打招呼" : "已切换：消息采集", "ok");
    });
    ui.modeGreet.addEventListener("change", async () => {
      state.mode = currentMode();
      ui.greetConfig.classList.toggle("hidden", state.mode !== "greet");
      try {
        await saveSettings();
      } catch (_err) {
        // ignore
      }
      setStatus(state.mode === "greet" ? "已切换：关键字自动打招呼" : "已切换：消息采集", "ok");
    });

    ui.startBtn.addEventListener("click", () => {
      if (state.running) {
        if (!state.stopRequested) {
          state.stopRequested = true;
          setStatus("正在停止...", "warn");
          log("收到结束指令，正在收尾当前轮。");
        }
        return;
      }
      if (currentMode() === "greet") {
        runGreeter();
      } else {
        runCollector();
      }
    });

    ui.exportBtn.addEventListener("click", async () => {
      try {
        await exportCsv();
      } catch (err) {
        setStatus(`导出失败: ${String(err.message || err)}`, "err");
      }
    });

    ui.refreshBtn.addEventListener("click", async () => {
      try {
        await refreshDashboard();
        setStatus("统计已刷新", "ok");
      } catch (err) {
        setStatus(`刷新失败: ${String(err.message || err)}`, "err");
      }
    });

    ui.clearBtn.addEventListener("click", async () => {
      try {
        await clearHistoryWithConfirm();
      } catch (err) {
        setStatus(`清空失败: ${String(err.message || err)}`, "err");
      }
    });
  }

  async function bootstrap() {
    try {
      const initScope = getStoredScope();
      ui.accountScope.value = initScope;
      await switchScope(initScope, { silent: true });
      bindEvents();
      setRunButtonState(false);
      setStatus(`就绪（账号ID: ${state.accountScope}）`, null);
      log(`插件已初始化，账号隔离ID: ${state.accountScope}`);
    } catch (err) {
      setStatus(`初始化失败: ${String(err.message || err)}`, "err");
    } finally {
      document.body.classList.remove("preload");
    }
  }

  bootstrap();
})();
