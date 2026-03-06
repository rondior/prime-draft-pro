import {
  AppState,
  loadState,
  saveState,
  listDrafts,
  getActiveDraftId,
  setActiveDraftId,
  createNewDraftRecord,
  loadDraftById,
  deleteDraftById
} from "./state.js";
import {
  fetchEspnLeagueSettingsWithFallback,
  fetchEspnPlayerUniverse,
  parseEspnLeagueUrl,
  fetchEspnProTeamMap
} from "./espn.js";
import { normalizeEspnLeague } from "./normalize.js";
import { renderBoard } from "./board.js";

(async function () {
  const m = chrome.runtime.getManifest();
  const CURRENT_SEASON = new Date().getFullYear();

  await loadState();

  function setShellStatus(msg = "", isError = false) {
    const el = document.getElementById("status");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
  }

  function formatUpdatedAt(ts) {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch {
      return "—";
    }
  }

  function getStatusLabel(status) {
    if (status === "active") return "In Progress";
    if (status === "completed") return "Completed";
    return "Setup";
  }

  function getActiveDraftRecord(drafts) {
    return drafts.find((d) => d.status === "active") || null;
  }

    function isDraftBoardReady(draft) {
    return !!(draft?.state?.leagueConfig?.league && draft?.state?.leagueConfig?.draft);
  }

  function renderDraftCard(draft) {
    const teams = draft?.summary?.teams ?? 0;
    const rounds = draft?.summary?.rounds ?? 0;
    const picksMade = draft?.summary?.picksMade ?? 0;
    const totalPicks = draft?.summary?.totalPicks ?? 0;
    const status = draft?.status ?? "setup";
    const statusLabel = getStatusLabel(status);

    return `
      <div class="draftCard" data-draft-id="${draft.id}">
        <div class="draftCardTop">
          <div>
            <h3 class="draftName">${draft.name || "Untitled Draft"}</h3>
            <div class="draftMeta">
              Season ${draft.season ?? CURRENT_SEASON} • Updated ${formatUpdatedAt(draft.updatedAt)}
            </div>
          </div>
          <div class="statusBadge status-${status}">${statusLabel}</div>
        </div>

        <div class="draftStats">
          <div class="draftStat">
            <div class="draftStatLabel">Teams</div>
            <div class="draftStatValue">${teams}</div>
          </div>
          <div class="draftStat">
            <div class="draftStatLabel">Rounds</div>
            <div class="draftStatValue">${rounds}</div>
          </div>
          <div class="draftStat">
            <div class="draftStatLabel">Picks Made</div>
            <div class="draftStatValue">${picksMade}</div>
          </div>
          <div class="draftStat">
            <div class="draftStatLabel">Total Picks</div>
            <div class="draftStatValue">${totalPicks}</div>
          </div>
        </div>

          <button class="draftActionBtn primary" data-action="${isDraftBoardReady(draft) ? "open" : "setup"}" data-draft-id="${draft.id}">
            ${isDraftBoardReady(draft)
              ? (status === "completed" ? "View Board" : "Open Draft")
              : "Setup Draft"}
          </button>

          <button class="draftActionBtn" data-action="activate" data-draft-id="${draft.id}">
            Set Active
          </button>

          <button class="draftActionBtn danger" data-action="delete" data-draft-id="${draft.id}">
            Delete
          </button>
        </div>
      </div>
    `;
  }

  async function refreshDashboard() {
    const verEl = document.getElementById("ver");
    if (verEl) verEl.textContent = m.version;

    const seasonLabel = document.getElementById("seasonLabel");
    const heroSeasonValue = document.getElementById("heroSeasonValue");
    if (seasonLabel) seasonLabel.textContent = String(CURRENT_SEASON);
    if (heroSeasonValue) heroSeasonValue.textContent = String(CURRENT_SEASON);

    const drafts = await listDrafts();
    const activeDraftId = await getActiveDraftId();
    const activeDraft =
      drafts.find((d) => d.id === activeDraftId) ||
      getActiveDraftRecord(drafts);

    const heroActiveDraft = document.getElementById("heroActiveDraft");
    const heroSavedCount = document.getElementById("heroSavedCount");
    const heroCompletedCount = document.getElementById("heroCompletedCount");
    const draftList = document.getElementById("draftList");

    if (heroActiveDraft) {
      heroActiveDraft.textContent = activeDraft?.name || "None";
    }

    if (heroSavedCount) {
      heroSavedCount.textContent = String(drafts.length);
    }

    if (heroCompletedCount) {
      heroCompletedCount.textContent = String(
        drafts.filter((d) => d.status === "completed").length
      );
    }

    if (draftList) {
      if (!drafts.length) {
        draftList.innerHTML = `
          <div class="emptyState">
            No saved drafts yet. Create a new draft or import a league from ESPN to populate this dashboard.
          </div>
        `;
      } else {
        draftList.innerHTML = drafts.map(renderDraftCard).join("");
      }
    }

    const btnResume = document.getElementById("btnResume");
    if (btnResume) {
      btnResume.disabled = !activeDraft;
      btnResume.style.opacity = activeDraft ? "1" : ".6";
      btnResume.style.cursor = activeDraft ? "pointer" : "not-allowed";
    }
  }

  async function createBlankDraftFromPrompt() {
    const name = window.prompt("Enter a draft name:", `Prime Draft ${CURRENT_SEASON}`);
    if (name === null) return;

    const cleanName = name.trim() || `Prime Draft ${CURRENT_SEASON}`;
    const record = await createNewDraftRecord({
      name: cleanName,
      season: CURRENT_SEASON
    });

    setShellStatus(`Created draft: ${record.name}`);
    await refreshDashboard();
  }

  async function openDraftFromCard(draftId) {
    const record = await loadDraftById(draftId);
    if (!record) {
      setShellStatus("Draft could not be loaded.", true);
      return;
    }

    setShellStatus(`Opening ${record.name}...`);
    await renderBoard();
  }

  async function deleteDraftFromCard(draftId) {
    const ok = window.confirm("Delete this saved draft from local storage?");
    if (!ok) return;

    await deleteDraftById(draftId);
    setShellStatus("Draft deleted.");
    await refreshDashboard();
  }

  async function activateDraftFromCard(draftId) {
    await setActiveDraftId(draftId);
    const record = await loadDraftById(draftId);

    if (!record) {
      setShellStatus("Draft could not be activated.", true);
      return;
    }

    setShellStatus(`Active draft set to ${record.name}.`);
    await refreshDashboard();
  }

    function bindDashboardEvents() {
    const btnCustomDraft = document.getElementById("btnCustomDraft");
    const btnEspn = document.getElementById("btnEspn");
    const btnOpenBoard = document.getElementById("btnOpenBoard");
    const btnPastDrafts = document.getElementById("btnPastDrafts");
    const btnSettings = document.getElementById("btnSettings");
    const draftList = document.getElementById("draftList");

    btnCustomDraft?.addEventListener("click", () => {
      setShellStatus("Custom draft builder is the next page we will build.");
    });

    btnEspn?.addEventListener("click", renderEspnImport);

    btnSettings?.addEventListener("click", () => {
      setShellStatus("Draft settings is reserved for the next pass.");
    });

    draftList?.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const action = btn.dataset.action;
      const draftId = btn.dataset.draftId;
      if (!action || !draftId) return;

      if (action === "open") {
        await openDraftFromCard(draftId);
        return;
      }

      if (action === "setup") {
        const record = await loadDraftById(draftId);

        if (!record) {
          setShellStatus("Draft could not be loaded for setup.", true);
          return;
        }

        setShellStatus(`Setting up ${record.name}...`);
        renderEspnImport();
        return;
      }

      if (action === "activate") {
        await activateDraftFromCard(draftId);
        return;
      }

      if (action === "delete") {
        await deleteDraftFromCard(draftId);
      }
    });
  }

  function renderEspnImport() {
    document.body.innerHTML = `
      <div style="
        min-height:100vh;
        padding:28px;
        font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        color:rgba(255,255,255,.94);
        background:
          radial-gradient(1200px 700px at 10% 0%, rgba(87,166,255,.20), transparent 55%),
          radial-gradient(1000px 700px at 100% 10%, rgba(124,92,255,.16), transparent 50%),
          linear-gradient(180deg, #07111f, #0b1728);
      ">
        <div style="width:min(1180px,100%); margin:0 auto; display:grid; gap:22px;">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap;">
            <div>
              <div style="color:rgba(255,255,255,.54); font-size:12px; letter-spacing:.14em; text-transform:uppercase; font-weight:700; margin-bottom:10px;">
                Draft Mission Control
              </div>
              <h1 style="margin:0; font-size:34px; line-height:1.02;">Import From ESPN</h1>
              <p style="margin:10px 0 0 0; color:rgba(255,255,255,.72); font-size:15px; line-height:1.55; max-width:760px;">
                Name the draft, connect your ESPN league, and import teams, rounds, and roster rules into Prime Draft Pro.
              </p>
            </div>

            <button id="backBtn" style="
              appearance:none;
              border:1px solid rgba(255,255,255,.10);
              background:rgba(255,255,255,.08);
              color:rgba(255,255,255,.94);
              border-radius:14px;
              padding:12px 16px;
              cursor:pointer;
              font-weight:700;
            ">← Back to Dashboard</button>
          </div>

          <div style="display:grid; grid-template-columns:1.15fr .85fr; gap:22px; align-items:start;">
            <div style="
              background:rgba(255,255,255,.06);
              border:1px solid rgba(255,255,255,.10);
              border-radius:22px;
              box-shadow:0 20px 60px rgba(0,0,0,.35);
              backdrop-filter:blur(18px);
              padding:22px;
            ">
              <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:16px;">
                <div>
                  <h2 style="margin:0; font-size:18px; font-weight:800;">League Import Setup</h2>
                  <p style="margin:6px 0 0 0; color:rgba(255,255,255,.70); font-size:13px; line-height:1.45;">
                    Complete these fields in order, then launch the board.
                  </p>
                </div>
              </div>

              <div style="display:grid; gap:16px;">

                <div>
                  <div style="font-size:13px; font-weight:700; margin-bottom:8px; color:rgba(255,255,255,.88);">ESPN League URL</div>
                  <input id="leagueUrl" type="text"
                    placeholder="https://fantasy.espn.com/football/league?leagueId=35228&seasonId=2026"
                    style="
                      width:100%;
                      padding:14px 14px;
                      border-radius:14px;
                      border:1px solid rgba(255,255,255,.10);
                      background:rgba(255,255,255,.08);
                      color:white;
                      outline:none;
                    " />
                </div>

                <div style="
                  padding:16px;
                  border-radius:18px;
                  border:1px solid rgba(255,255,255,.10);
                  background:rgba(255,255,255,.05);
                ">
                  <div style="font-size:14px; font-weight:800; margin-bottom:6px;">Private League Support</div>
                  <div style="color:rgba(255,255,255,.70); font-size:12px; line-height:1.55;">
                    Prime Draft Pro will automatically use your ESPN sign-in from this Chrome profile. For private leagues, make sure you are already signed into ESPN in this browser before clicking Fetch + Normalize.
                  </div>
                </div>

                <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:2px;">
                  <button id="parseBtn"
                    style="
                      appearance:none;
                      padding:12px 18px;
                      border:none;
                      border-radius:14px;
                      cursor:pointer;
                      font-weight:800;
                      background:linear-gradient(135deg, rgba(87,166,255,.24), rgba(87,166,255,.12));
                      color:white;
                    ">
                    Parse URL
                  </button>

                  <button id="fetchBtn" disabled
                    style="
                      appearance:none;
                      padding:12px 18px;
                      border:none;
                      border-radius:14px;
                      cursor:not-allowed;
                      opacity:.6;
                      font-weight:800;
                      background:linear-gradient(135deg, rgba(41,195,106,.24), rgba(41,195,106,.12));
                      color:white;
                    ">
                    Fetch + Normalize
                  </button>

                  <button id="startBoardBtn" disabled
                    style="
                      appearance:none;
                      padding:12px 18px;
                      border:none;
                      border-radius:14px;
                      cursor:not-allowed;
                      opacity:.6;
                      font-weight:800;
                      background:linear-gradient(135deg, rgba(255,184,77,.24), rgba(255,184,77,.12));
                      color:white;
                    ">
                    Start Board
                  </button>

                  <button id="resumeBoardBtn" disabled
                    style="
                      appearance:none;
                      padding:12px 18px;
                      border:1px solid rgba(255,255,255,.10);
                      border-radius:14px;
                      cursor:not-allowed;
                      opacity:.6;
                      font-weight:800;
                      background:rgba(255,255,255,.08);
                      color:white;
                    ">
                    Resume Board
                  </button>
                </div>
              </div>
            </div>

            <div style="display:grid; gap:22px;">
              <div style="
                background:rgba(255,255,255,.06);
                border:1px solid rgba(255,255,255,.10);
                border-radius:22px;
                box-shadow:0 20px 60px rgba(0,0,0,.35);
                backdrop-filter:blur(18px);
                padding:22px;
              ">
                <h2 style="margin:0 0 10px 0; font-size:18px; font-weight:800;">System Status</h2>
                <p style="margin:0 0 12px 0; color:rgba(255,255,255,.70); font-size:13px; line-height:1.45;">
                  Parse, fetch, and import messages will appear here as you progress through setup.
                </p>
                <div id="status" style="min-height:48px; color:rgba(255,255,255,.88); font-size:13px; line-height:1.5;"></div>
              </div>

              <div style="
                background:rgba(255,255,255,.06);
                border:1px solid rgba(255,255,255,.10);
                border-radius:22px;
                box-shadow:0 20px 60px rgba(0,0,0,.35);
                backdrop-filter:blur(18px);
                padding:22px;
              ">
                <h2 style="margin:0 0 10px 0; font-size:18px; font-weight:800;">Import Preview</h2>
                <p style="margin:0 0 12px 0; color:rgba(255,255,255,.70); font-size:13px; line-height:1.45;">
                  League details, normalization results, and debug information will appear here.
                </p>
                <pre id="preview" style="
                  margin:0;
                  background:rgba(255,255,255,.05);
                  border:1px solid rgba(255,255,255,.10);
                  padding:14px;
                  border-radius:16px;
                  overflow:auto;
                  max-height:480px;
                  color:rgba(255,255,255,.86);
                  font-size:12px;
                  line-height:1.45;
                  white-space:pre-wrap;
                "></pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const statusEl = document.getElementById("status");
    const previewEl = document.getElementById("preview");

    const urlEl = document.getElementById("leagueUrl");
    if (urlEl && AppState.league?.lastEspnUrl) urlEl.value = AppState.league.lastEspnUrl;

    const fetchBtn = document.getElementById("fetchBtn");
    const startBoardBtn = document.getElementById("startBoardBtn");
    const resumeBoardBtn = document.getElementById("resumeBoardBtn");

    const setStatus = (msg) => (statusEl.textContent = msg || "");
    const setPreview = (obj) => (previewEl.textContent = obj ? JSON.stringify(obj, null, 2) : "");

    const enableBtn = (btn) => {
      btn.disabled = false;
      btn.style.cursor = "pointer";
      btn.style.opacity = "1";
    };

    const disableBtn = (btn) => {
      btn.disabled = true;
      btn.style.cursor = "not-allowed";
      btn.style.opacity = ".6";
    };

    if (resumeBoardBtn) {
      if (AppState.league && AppState.draft && Array.isArray(AppState.draft.teams) && AppState.draft.teams.length) {
        enableBtn(resumeBoardBtn);
      } else {
        disableBtn(resumeBoardBtn);
      }

      resumeBoardBtn.onclick = async () => {
        await loadState();

        if (!AppState.draft || !Array.isArray(AppState.draft.teams) || !AppState.draft.teams.length) {
          setStatus("Nothing to resume yet. Import a league first.");
          return;
        }

        await renderBoard();
      };
    }

    let parsed = null;

    document.getElementById("backBtn").onclick = () => location.reload();

    document.getElementById("parseBtn").onclick = async () => {
      const url = document.getElementById("leagueUrl").value;
      AppState.league = AppState.league || {};
      AppState.league.lastEspnUrl = url;
      await saveState();

      const p = parseEspnLeagueUrl(url);

      if (!p.ok) {
        parsed = null;
        disableBtn(fetchBtn);
        disableBtn(startBoardBtn);
        setStatus(`❌ ${p.error}`);
        setPreview(null);
        return;
      }

      parsed = p;

      AppState.league = AppState.league || {};
      AppState.league.platform = "espn";
      AppState.league.leagueId = parsed.leagueId;
      AppState.league.seasonId = parsed.seasonId;

      enableBtn(fetchBtn);
      disableBtn(startBoardBtn);

      setStatus(`✅ Parsed leagueId=${parsed.leagueId}, seasonId=${parsed.seasonId}`);
      setPreview({ parsed });
    };

    fetchBtn.onclick = async () => {
      if (!parsed?.leagueId || !parsed?.seasonId) return;

      setStatus("Fetching league settings from ESPN (season fallback enabled)...");
      setPreview(null);
      disableBtn(startBoardBtn);

      const result = await fetchEspnLeagueSettingsWithFallback(parsed);

      if (!result.ok) {
        setStatus(`❌ ${result.error}`);
        setPreview({ attempts: result.attempts || [] });
        return;
      }

      if (result.ok && result.kind === "auth") {
        setStatus(`❌ ${result.error}`);
        setPreview({ attempts: result.attempts || [] });
        return;
      }

      const normalized = normalizeEspnLeague(result.data);
      if (!normalized.ok) {
        setStatus(`❌ Normalize failed: ${normalized.error}`);
        return;
      }

      AppState.league = AppState.league || {};
      AppState.league.platform = "espn";
      AppState.league.leagueId = parsed.leagueId;
      AppState.league.seasonId = result.seasonIdResolved;
      AppState.league.name = result.leagueName;
      AppState.league._espnRaw = result.data;

      AppState.draft = AppState.draft || {};
      AppState.draft.rounds = normalized.draft.rounds;
      AppState.draft.teams = normalized.league.teams;
      AppState.draft.picks = [];

      AppState.playerSource = "espn";
      AppState.leagueConfig = {
        league: normalized.league,
        draft: normalized.draft
      };
      AppState.rosterConfig = normalized.roster ?? null;

      await saveState();

      setStatus("✅ League imported. Fetching ESPN player universe (this can take a moment)...");
      const seasonId = AppState.league?.seasonId;
      const cookies = AppState.league?.cookies;

      setStatus("🟦 Player fetch STARTED (debug) ...");
      const pRes = await fetchEspnPlayerUniverse({ seasonId, cookies, maxPlayers: 3000 });
      setPreview({ playerFetchResult: pRes });
      setStatus("🟦 Player fetch RETURNED (debug) ...");

      if (pRes.ok) {
        const teamRes = await fetchEspnProTeamMap({ seasonId, cookies });
        const teamMap = teamRes.ok ? teamRes.map : {};

        AppState._debug = AppState._debug || {};
        AppState._debug.teamMapSummary = {
          ok: teamRes.ok,
          mapSize: teamRes.ok ? Object.keys(teamMap).length : 0,
          has33: !!teamMap["33"],
          err: teamRes.ok ? null : (teamRes.error || "unknown")
        };

        const enriched = pRes.players.map((p) => {
          const meta = teamMap[String(p.proTeamId)] || {};
          return {
            ...p,
            team: meta.abbrev || "",
            bye: meta.bye ?? null
          };
        });

        AppState.players = enriched;
        await saveState();

        setStatus(`✅ Imported: ${normalized.league.name} (${normalized.league.teamCount} teams). Rounds=${normalized.draft.rounds}. Players cached: ${enriched.length}.`);
      } else {
        setStatus(`✅ Imported league, but player universe failed: ${pRes.error}`);
      }

      const playerCount = Array.isArray(AppState.players) ? AppState.players.length : 0;
      setStatus(`✅ Imported: ${normalized.league.name} (${normalized.league.teamCount} teams). Rounds=${normalized.draft.rounds}. Players cached: ${playerCount}.`);
      setPreview({
        league: normalized.league,
        roster: normalized.roster,
        draft: normalized.draft,
        playerFetchResult: pRes,
        teamFetchResult: AppState._debug?.teamMapSummary || null
      });

      enableBtn(startBoardBtn);
    };

    startBoardBtn.onclick = async () => {
      AppState.draft = AppState.draft || {};
      AppState.draft.picks = [];
      AppState.draft.cursor = { round: 1, teamIndex: 0 };

      await saveState();
      await renderBoard();
    };
  }

  bindDashboardEvents();
  await refreshDashboard();
})();
