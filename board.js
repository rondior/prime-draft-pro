import { AppState, loadState, saveState } from "./state.js";

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      n.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      n.setAttribute(k, v);
    }
  }
  for (const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
}

function getPick(picks, round, teamIndex) {
  return (picks || []).find(p => p.round === round && p.teamIndex === teamIndex) || null;
}

function snakeTeamIndexForPickNumber(pickNum, teamCount) {
  const round = Math.ceil(pickNum / teamCount);
  const inRound = ((pickNum - 1) % teamCount) + 1;
  const isOdd = round % 2 === 1;
  const teamIndex = isOdd ? (inRound - 1) : (teamCount - inRound);
  return { round, teamIndex };
}

function findNextOpenPickSnake(picks, rounds, teamCount) {
  const total = rounds * teamCount;
  for (let pickNum = 1; pickNum <= total; pickNum++) {
    const { round, teamIndex } = snakeTeamIndexForPickNumber(pickNum, teamCount);
    if (!getPick(picks, round, teamIndex)) return { round, teamIndex, pickNum };
  }
  return null;
}

// Player pool (ESPN universe cached in AppState.players)
// Filters out already-drafted players so the dropdown stays clean.
function getPlayerPool() {
  const all = Array.isArray(AppState.players) ? AppState.players : [];
  const draftedIds = new Set((AppState.draft?.picks || []).map(p => String(p.playerId || "")));

  return all
    .filter(p => p && p.id && p.name)
    .filter(p => !draftedIds.has(String(p.id)))
    .map(p => ({
      id: String(p.id),
      name: p.name,
      pos: p.pos || "",
      team: p.team || "",   // may be empty until we add proTeamId->abbr mapping
      bye: p.bye ?? ""      // may be empty until we enrich from ESPN payload later
    }));
}

function posColor(pos) {
  // simple, readable colors (close to clickydraft vibe)
  const map = {
    QB: "rgba(80, 220, 160, .22)",
    RB: "rgba(255, 90, 90, .22)",
    WR: "rgba(190, 120, 255, .22)",
    TE: "rgba(255, 200, 80, .22)",
    K:  "rgba(160, 200, 255, .18)",
    DST:"rgba(140, 200, 255, .18)",
    DL: "rgba(120, 220, 255, .18)",
    LB: "rgba(120, 255, 180, .18)",
    DB: "rgba(160, 160, 255, .18)",
    DT: "rgba(120, 220, 255, .18)",
    DE: "rgba(120, 220, 255, .18)",
    CB: "rgba(160, 160, 255, .18)",
    S:  "rgba(160, 160, 255, .18)",
    FLEX:"rgba(255,255,255,.10)"
  };
  return map[pos] || "rgba(255,255,255,.08)";
}

let draftTimerInterval = null;
let draftTimerEndAt = 0;
const DRAFT_TIMER_SECONDS = 90;

let pickSound = null;

let audioCtx = null;
let pickBuffer = null;

async function playPickSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (!pickBuffer) {
      const url = chrome.runtime.getURL("assets/pick-sound.mp3");
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      pickBuffer = await audioCtx.decodeAudioData(arr);
    }

    const src = audioCtx.createBufferSource();
    src.buffer = pickBuffer;

    // Lower pitch slightly
    src.playbackRate.value = 0.87;

    const gain = audioCtx.createGain();
    gain.gain.value = 1.00;

    src.connect(gain);
    gain.connect(audioCtx.destination);

    src.start(0);
  } catch (e) {}
}

function startDraftTimer() {
  const timerEl = document.getElementById("draftTimer");
  if (!timerEl) return;

  if (draftTimerInterval) {
    clearInterval(draftTimerInterval);
    draftTimerInterval = null;
  }

  draftTimerEndAt = Date.now() + (DRAFT_TIMER_SECONDS * 1000);

  draftTimerInterval = setInterval(() => {
    const remaining = Math.max(0, draftTimerEndAt - Date.now());
    const sec = Math.ceil(remaining / 1000);

    const m = Math.floor(sec / 60);
    const s = sec % 60;

    timerEl.textContent =
      String(m).padStart(2, "0") + ":" +
      String(s).padStart(2, "0");

    // Beep in last 10 seconds
    if (sec <= 10 && sec > 0) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.frequency.value = 880;
        osc.type = "sine";

        gain.gain.setValueAtTime(0.15, ctx.currentTime);

        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } catch (e) {}
    }

    if (sec <= 0) {
      clearInterval(draftTimerInterval);
      draftTimerInterval = null;
    }

  }, 250);
}

export async function renderBoard() {
  await loadState();
  window.__APPSTATE__ = AppState; // DEBUG

  const league = AppState.leagueConfig?.league;
  const draftCfg = AppState.leagueConfig?.draft;

  if (!league || !draftCfg) {
    document.body.innerHTML = `
      <div style="padding:40px;font-family:system-ui;background:#0b0d12;color:white;min-height:100vh;">
        <h1>No league loaded</h1>
        <button id="boardHomeBtn">← Home</button>
      </div>`;
    return;
  }

  AppState.draft = AppState.draft || {};
  AppState.draft.picks = AppState.draft.picks || [];
  AppState.draft.draftType = AppState.draft.draftType || "SNAKE";

  const teams = league.teams || [];
  const teamCount = teams.length;
  const rounds = draftCfg.rounds || 0;

    const nextOpen = (AppState.draft.draftType === "SNAKE")
    ? findNextOpenPickSnake(AppState.draft.picks, rounds, teamCount)
    : null;

  // Treat as "empty draft" when there are no actual drafted players yet.
  // (Some flows may create placeholder pick objects; we only count picks with a playerId.)
    const hasAnyRealPick = (AppState.draft.picks || []).some(p => p && (p.playerId != null));

  // If there are no real picks, force the cursor to the beginning,
  // even if a stale cursor was saved from prior sessions.
  if (!hasAnyRealPick) {
    const cur = AppState.draft.cursor;
    const isStart = cur && cur.round === 1 && cur.teamIndex === 0;

    if (!isStart) {
      AppState.draft.cursor = { round: 1, teamIndex: 0 };
      await saveState();
    }
  } else if (!AppState.draft.cursor && nextOpen) {
    // Resume draft: go to next open pick
    AppState.draft.cursor = { round: nextOpen.round, teamIndex: nextOpen.teamIndex };
    await saveState();
  }

  const cursor =
    AppState.draft.cursor ||
    (nextOpen ? { round: nextOpen.round, teamIndex: nextOpen.teamIndex } : null);

  const style = el("style", {
    html: `
    :root{
      --bg:#070a12;
      --stroke:rgba(255,255,255,.10);
      --text:rgba(255,255,255,.92);
      --muted:rgba(255,255,255,.62);
      --r:14px;
      --active: rgba(120,160,255,.20);
      --activeBorder: rgba(120,160,255,.55);
    }
    html, body{height:100% !important; width:100% !important;}
    body{
      margin:0 !important;
      padding:0 !important;
      display:flex !important;
      flex-direction:column !important;
      overflow:hidden !important;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif !important;
      background: radial-gradient(1200px 700px at 15% 10%, rgba(120,160,255,.14), transparent 60%),
                  radial-gradient(900px 600px at 85% 30%, rgba(180,120,255,.10), transparent 55%),
                  var(--bg) !important;
      color:var(--text) !important;
    }

    header{
      flex: 0 0 62px;
      height:62px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      padding:10px 12px;
      border-bottom:1px solid var(--stroke);
      background: rgba(7,10,18,.78);
      backdrop-filter: blur(14px);
      position:relative;
      z-index:10;
    }
    .left{display:flex; align-items:center; gap:10px; min-width:0;}
    .meta{display:flex; flex-direction:column; gap:2px; min-width:0;}
    .leagueName{font-weight:900;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width: 32vw;}
    .leagueSub{font-size:12px; color:var(--muted); white-space:nowrap;}

    .btn{
      border:1px solid var(--stroke);
      background:rgba(255,255,255,.08);
      color:var(--text);
      padding:8px 10px;
      border-radius:12px;
      cursor:pointer;
      font-size:13px;
      white-space:nowrap;
    }
    .btn:hover{background:rgba(255,255,255,.12)}
    .tag{
      font-size:11px;
      color:var(--muted);
      border:1px solid var(--stroke);
      background:rgba(255,255,255,.06);
      padding:4px 8px;
      border-radius:999px;
      white-space:nowrap;
    }

    /* Pick console + dropdown */
    .console{display:flex;align-items:center;gap:10px;min-width:0;flex:1 1 auto;justify-content:center;}
    .consoleWrap{position:relative; width:min(820px, 62vw);}
    .consoleBox{
      display:flex;align-items:center;gap:10px;
      border:1px solid rgba(255,255,255,.12);
      background:rgba(255,255,255,.06);
      border-radius:14px;
      padding:8px 10px;
    }
    .consoleLabel{font-size:11px;color:var(--muted);font-weight:900;letter-spacing:.4px;white-space:nowrap;}
    .consoleHint{font-size:11px;color:var(--muted);white-space:nowrap;}
    .consoleInput{
      flex:1; min-width:0;
      border:none; outline:none;
      background:transparent;
      color:var(--text);
      font-size:13px;
      font-weight:800;
    }
    .draftBtn{
      padding:8px 14px;border-radius:12px;
      border:1px solid rgba(255,255,255,.18);
      background:rgba(255,255,255,.16);
      color:var(--text);
      font-weight:900;
      cursor:pointer;
      white-space:nowrap;
    }
    .draftBtn:hover{background:rgba(255,255,255,.22)}
    .draftBtn:disabled{opacity:.45;cursor:not-allowed;}

    .dropdown{
      position:absolute;
      top: calc(100% + 8px);
      left:0;
      right:0;
      max-height: 360px;
      overflow:auto;
      border:1px solid rgba(255,255,255,.14);
      background: rgba(10,12,18,.96);
      border-radius:14px;
      box-shadow: 0 22px 70px rgba(0,0,0,.6);
      display:none;
    }
    .dropdown.open{display:block;}
    .opt{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:12px;
      padding:10px 12px;
      cursor:pointer;
      border-bottom:1px solid rgba(255,255,255,.06);
    }
    .opt:last-child{border-bottom:none;}
    .opt:hover{background:rgba(255,255,255,.06);}
    .opt.active{background:rgba(120,160,255,.14);}
    .optLeft{display:flex;align-items:center;gap:10px;min-width:0;}
    .pill{
      font-size:11px;
      font-weight:900;
      border:1px solid rgba(255,255,255,.14);
      padding:4px 8px;
      border-radius:999px;
      white-space:nowrap;
    }
    .pname{
      font-weight:900;
      font-size:13px;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      max-width: 44vw;
    }
    .pmeta{font-size:11px;color:var(--muted);white-space:nowrap;}

    .board{flex:1;min-height:0;padding:10px 12px 14px;}
    .frame{height:100%;border:1px solid var(--stroke);border-radius:var(--r);overflow:auto;background: rgba(255,255,255,.03);box-shadow:0 18px 60px rgba(0,0,0,.35);}
    table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed;}
    thead th{border-bottom:1px solid rgba(255,255,255,.10);padding:8px 6px;text-align:center;vertical-align:middle;overflow:hidden;}
    .teamHead{display:flex;flex-direction:column;align-items:center;gap:2px;line-height:1.05;width:100%;}
    .teamName{font-size:12px;font-weight:900;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;}
    .teamAbbrev{font-size:10px;color:var(--muted);font-weight:800;letter-spacing:.4px;white-space:nowrap;}
    thead th.roundHead{width:52px;color:var(--muted);font-size:12px;font-weight:900;}
    tbody th{border-right:1px solid rgba(255,255,255,.10);color:var(--muted);font-weight:900;text-align:center;width:52px;font-size:12px;}
    tbody td{border:1px solid rgba(255,255,255,.045);text-align:center;font-size:13px;padding:6px;cursor:pointer;user-select:none;position:relative;}
    tbody td:hover{background:rgba(255,255,255,.05)}
    td.activePick{background:var(--active);outline: 2px solid var(--activeBorder);outline-offset:-2px;}
    td.activePick::after{content:"ON CLOCK";position:absolute;top:6px;right:6px;font-size:9px;color:rgba(255,255,255,.72);background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.14);padding:2px 6px;border-radius:999px;}
        /* Highlight entire "on clock" team column (header + body) */
    th.onClockCol,
    td.onClockCol{
      background: rgba(255,255,255,.055);
    }
          /* Highlight entire current round row */
    tr.onClockRow th,
    tr.onClockRow td{
      background: rgba(255,255,255,.04);
    }
    .pickName{font-weight:900;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .pickMeta{font-size:10px;color:var(--muted);margin-top:2px;}
    tbody tr{height: calc((100vh - 62px - 24px - 44px)/${Math.max(1, rounds)});}
  `
  });

  async function upsertPick(round, teamIndex, pick) {
    AppState.draft.picks = AppState.draft.picks.filter(p => !(p.round === round && p.teamIndex === teamIndex));
    AppState.draft.picks.push({ round, teamIndex, ...pick });

    if (AppState.draft.draftType === "SNAKE") {
      const next = findNextOpenPickSnake(AppState.draft.picks, rounds, teamCount);
      AppState.draft.cursor = next ? { round: next.round, teamIndex: next.teamIndex } : null;
    }
    await saveState();
  }

// Draft a selected player object into the cursor cell
async function draftSelectedPlayer(player) {
  if (!cursor) return;

  await upsertPick(cursor.round, cursor.teamIndex, {
    playerId: player.id,
    name: player.name,
    pos: player.pos,
    proTeam: player.team,
    bye: player.bye
  });

  await saveState();

  // Play broadcast-style confirmation sound
  playPickSound();

  renderBoard();
}

let pickSound = null;

  // Undo the most recent pick (commissioner control)
  let undoLockUntil = 0;

  async function undoLastPick() {
  // 200ms protection window (survives re-renders)
  const now = Date.now();
  if (now < undoLockUntil) return;
  undoLockUntil = now + 400;

  if (!AppState?.draft) return;
  if (!Array.isArray(AppState.draft.picks) || AppState.draft.picks.length === 0) return;

  const teamCount = (AppState.draft.teams && AppState.draft.teams.length) ? AppState.draft.teams.length : 0;
  const rounds = AppState.draft.rounds || 0;
  if (!teamCount || !rounds) return;

  // Only snake-accurate behavior (your board is snake)
  // If you ever add non-snake, we can add a different path.
  const isSnake = (AppState.draft.draftType || "").toUpperCase() === "SNAKE";
  if (!isSnake) return;

  // Convert (round, teamIndex) <-> linear pick number (1..rounds*teamCount)
  const toPickNum = (round, teamIndex) => {
    const offset = (round % 2 === 1) ? teamIndex : (teamCount - 1 - teamIndex);
    return (round - 1) * teamCount + offset + 1;
  };

  const fromPickNum = (pickNum) => {
    const r = Math.floor((pickNum - 1) / teamCount) + 1;
    const offset = (pickNum - 1) % teamCount;
    const t = (r % 2 === 1) ? offset : (teamCount - 1 - offset);
    return { round: r, teamIndex: t };
  };

  // "Cursor" is the next open slot. Undo should remove the pick immediately BEFORE it.
  // If cursor is null (draft complete), treat it as "after the last pick".
  let cursorPickNum;
  if (AppState.draft.cursor && AppState.draft.cursor.round && (AppState.draft.cursor.teamIndex ?? null) !== null) {
    cursorPickNum = toPickNum(AppState.draft.cursor.round, AppState.draft.cursor.teamIndex);
  } else {
    cursorPickNum = (rounds * teamCount) + 1; // one past the end
  }

  // Start from the pick immediately before the cursor and walk backward
  // until we find an actual saved pick to remove.
  let targetPickNum = cursorPickNum - 1;
  if (targetPickNum < 1) return;

  const hasPickAt = (round, teamIndex) =>
    AppState.draft.picks.some(p => p.round === round && p.teamIndex === teamIndex);

  while (targetPickNum >= 1) {
    const { round, teamIndex } = fromPickNum(targetPickNum);
    if (hasPickAt(round, teamIndex)) {
      // Remove that pick
      AppState.draft.picks = AppState.draft.picks.filter(p => !(p.round === round && p.teamIndex === teamIndex));

      // Cursor goes back to the undone slot
      AppState.draft.cursor = { round, teamIndex };

      await saveState();
      renderBoard();
      return;
    }
    targetPickNum--;
  }
}

// Build header + dropdown behavior
  const playerPool = getPlayerPool();
  let filtered = [];
  let activeIndex = 0;

  function filterPlayers(q) {
    const query = (q || "").trim().toLowerCase();
    if (!query) return [];
    return playerPool
      .filter(p => p.name.toLowerCase().includes(query))
      .slice(0, 50);
  }

  function renderDropdown(drop, input) {
    drop.innerHTML = "";
    if (!filtered.length) {
      drop.classList.remove("open");
      return;
    }
    drop.classList.add("open");

    filtered.forEach((p, idx) => {
      const pill = el("span", {
        class: "pill",
        style: `background:${posColor(p.pos)};`
      }, [`${p.pos}`]);

      const row = el("div", {
        class: `opt ${idx === activeIndex ? "active" : ""}`,
        onClick: () => draftSelectedPlayer(p)
      }, [
        el("div", { class: "optLeft" }, [
          pill,
          el("div", { style: "min-width:0;" }, [
            el("div", { class: "pname", title: p.name }, [p.name]),
            el("div", { class: "pmeta" }, [`${p.team} • BYE ${p.bye}`])
          ])
        ]),
        el("div", { class: "pmeta" }, ["Click to draft"])
      ]);

      drop.appendChild(row);
    });
  }

  const header = el("header", {}, [
    el("div", { class: "left" }, [
      el("button", { class: "btn", id: "homeBtn" }, ["← Home"]),
      el("div", { class: "meta" }, [
        el("div", { class: "leagueName", title: league.name }, [league.name]),
        el("div", { class: "leagueSub" }, [
          `${teams.length} teams • ${rounds} rounds • ${AppState.draft.draftType}`
        ])
      ])
    ]),
    el("div", { class: "console" }, [
      el("div", { class: "consoleWrap" }, [
        el("div", { class: "consoleBox" }, [
                    el("div", { class: "consoleLabel" }, ["ON CLOCK"]),
          el("div", {
            class: "consoleHint",
            id: "onClockTeam"
          }, [
            cursor
              ? `${teams[cursor.teamIndex]?.name || teams[cursor.teamIndex]?.abbrev || "TEAM"} • Pick ${String(cursor.round).padStart(2, "0")}.${String(cursor.teamIndex + 1).padStart(2, "0")}`
              : "Draft Complete"
          ]),
          el("div", {
            class: "consoleHint",
            id: "draftTimer"
          }, ["01:30"]),
          (() => {
            const inp = el("input", {
              class: "consoleInput",
              placeholder: "Search players…",
              id: "playerSearch"
            });

            inp.addEventListener("input", () => {
              filtered = filterPlayers(inp.value);
              activeIndex = 0;
              renderDropdown(document.getElementById("playerDropdown"), inp);
            });

            inp.addEventListener("keydown", (e) => {
              const drop = document.getElementById("playerDropdown");
              if (!drop.classList.contains("open")) return;

              if (e.key === "ArrowDown") {
                e.preventDefault();
                activeIndex = Math.min(activeIndex + 1, filtered.length - 1);
                renderDropdown(drop, inp);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                activeIndex = Math.max(activeIndex - 1, 0);
                renderDropdown(drop, inp);
              } else if (e.key === "Enter") {
                e.preventDefault();
                const p = filtered[activeIndex];
                if (p) draftSelectedPlayer(p);
              } else if (e.key === "Escape") {
                drop.classList.remove("open");
              }
            });

            inp.addEventListener("focus", () => {
              filtered = filterPlayers(inp.value);
              renderDropdown(document.getElementById("playerDropdown"), inp);
            });

            return inp;
          })(),
          el("button", {
            class: "draftBtn",
            id: "draftBtn",
            disabled: cursor ? null : "disabled"
          }, ["Draft"]),
          el("button", {
            class: "btn",
            id: "undoBtn"
          }, ["Undo"])
        ]),
        el("div", { class: "dropdown", id: "playerDropdown" }, [])
      ])
    ]),
    el("div", { class: "tag" }, ["BOARD v7"])
  ]);

  const table = el("table");
  const thead = el("thead");
  const headRow = el("tr");
  headRow.appendChild(el("th", { class: "roundHead" }, ["Rd"]));

  teams.forEach((t, idx) => {
  const name = (t.name || "").trim() || "Team";
  const abbr = (t.abbrev || "").trim();

  headRow.appendChild(el("th", {
    class: (cursor && cursor.teamIndex === idx) ? "onClockCol" : ""
  }, [
    el("div", { class: "teamHead" }, [
      el("div", { class: "teamName", title: name }, [name]),
      el("div", { class: "teamAbbrev" }, [abbr ? abbr : ""])
    ])
  ]));
});

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (let r = 1; r <= rounds; r++) {
    const tr = el("tr", {
      class: (cursor && cursor.round === r) ? "onClockRow" : ""
    });
    tr.appendChild(el("th", {}, [String(r)]));

    for (let c = 0; c < teamCount; c++) {
      const existing = getPick(AppState.draft.picks, r, c);
      const td = el("td", {
        class: [
          (cursor && cursor.round === r && cursor.teamIndex === c) ? "activePick" : "",
          (cursor && cursor.teamIndex === c) ? "onClockCol" : ""
        ].join(" "),
        title: existing ? "Pick saved" : "Use header search to draft",
      }, []);

      td.onclick = async () => {
        AppState.draft.cursor = { round: r, teamIndex: c };
        await saveState();
        renderBoard();
      };

      if (existing) {
        td.appendChild(el("div", { class: "pickName", title: existing.name }, [existing.name]));
        const metaParts = [];
        if (existing.pos) metaParts.push(existing.pos);
        if (existing.proTeam) metaParts.push(existing.proTeam);
        if (existing.bye) metaParts.push(`BYE ${existing.bye}`);
        if (metaParts.length) td.appendChild(el("div", { class: "pickMeta" }, [metaParts.join(" • ")]));
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);

  const frame = el("div", { class: "frame" }, [table]);
  const board = el("div", { class: "board" }, [frame]);

  document.head.appendChild(style);
  document.body.innerHTML = "";
  document.body.appendChild(header);

  // Wire buttons (el() helper does not bind onClick props)
  const undoBtn = document.getElementById("undoBtn");
  if (undoBtn) {
    undoBtn.disabled = !(AppState.draft?.picks?.length > 0);
  undoBtn.onclick = () => undoLastPick();
  }

  document.body.appendChild(board);

    const homeBtn = document.getElementById("homeBtn");
    if (homeBtn) homeBtn.onclick = () => location.reload();

    const boardHomeBtn = document.getElementById("boardHomeBtn");
    if (boardHomeBtn) boardHomeBtn.onclick = () => location.reload();

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    const wrap = document.querySelector(".consoleWrap");
    const drop = document.getElementById("playerDropdown");
    if (!wrap || !drop) return;
    if (!wrap.contains(e.target)) drop.classList.remove("open");
  }, { once: true });

  // Focus the search input automatically
  const search = document.getElementById("playerSearch");
  if (search) setTimeout(() => search.focus(), 50);

   // Auto-center the active pick row inside the scroll frame
  setTimeout(() => {
    const frame = document.querySelector(".frame");
    const active = document.querySelector("td.activePick");
    if (!frame || !active) return;

    const activeTop = active.offsetTop;
    const activeHeight = active.offsetHeight;
    const targetScrollTop = activeTop - (frame.clientHeight / 2) + (activeHeight / 2);

    frame.scrollTop = Math.max(0, targetScrollTop);
  }, 0);

  startDraftTimer();

  // Keyboard shortcut: Cmd/Ctrl + Z = Undo last pick (register once)
  if (!window.__primeDraftUndoHotkeyBound) {
    window.__primeDraftUndoHotkeyBound = true;

    document.addEventListener("keydown", (e) => {

  // Cmd/Ctrl + Z → Undo
  if ((e.metaKey || e.ctrlKey) && (e.key || "").toLowerCase() === "z") {
    e.preventDefault();
    undoLastPick();
    return;
  }

  // "/" → focus player search
  if (e.key === "/") {
    e.preventDefault();
    const search = document.getElementById("playerSearch");
    if (search) search.focus();
    return;
  }

  // Backspace → Undo (only when NOT typing in search)
  if (e.key === "Backspace") {
    const active = document.activeElement;
    if (!active || active.id !== "playerSearch") {
      e.preventDefault();
      undoLastPick();
     }
   }
     });
   }
}
