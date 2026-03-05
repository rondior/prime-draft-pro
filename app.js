import { AppState, loadState, saveState } from "./state.js";
import {fetchEspnLeagueSettingsWithFallback, fetchEspnPlayerUniverse, parseEspnLeagueUrl} from "./espn.js";
import { normalizeEspnLeague } from "./normalize.js";
import { renderBoard } from "./board.js";
import { fetchEspnProTeamMap } from "./espn.js";

(async function () {
  const m = chrome.runtime.getManifest();
  document.getElementById("ver").textContent = `v${m.version}`;

  await loadState();

  const root = document.body;

  function renderEspnImport() {
    root.innerHTML = `
      <div style="padding:40px; font-family:system-ui; color:white; background:#0b0d12; min-height:100vh;">
        <h1>Import from ESPN</h1>
        <p>Paste your ESPN league URL below. We’ll fetch teams + roster/draft settings, cache locally, then normalize into Prime Draft Pro config.</p>

        <input id="leagueUrl" type="text"
          placeholder="https://fantasy.espn.com/football/league?leagueId=35228&seasonId=2026"
          style="width:100%; padding:10px; margin:15px 0; border-radius:8px; border:none;" />

        <div style="margin-top:10px; padding:12px; border-radius:12px; border:1px solid rgba(255,255,255,.10); background:rgba(255,255,255,.05);">
          <div style="font-weight:700; margin-bottom:6px;">Private league? Paste ESPN cookies:</div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <input id="swid" type="text" placeholder="SWID (example: {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX})"
              style="flex:1 1 340px; padding:10px; border-radius:8px; border:none;" />
            <input id="espn_s2" type="text" placeholder="espn_s2 (long token)"
              style="flex:1 1 340px; padding:10px; border-radius:8px; border:none;" />
          </div>
          <div style="margin-top:8px; color:#bbb; font-size:12px;">
            We only use these to fetch your league/player data from ESPN. They’re stored locally in your browser.
          </div>
        </div>

                <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button id="parseBtn"
            style="padding:10px 20px; border:none; border-radius:8px; cursor:pointer;">
            Parse URL
          </button>

          <button id="fetchBtn" disabled
            style="padding:10px 20px; border:none; border-radius:8px; cursor:not-allowed; opacity:.6;">
            Fetch + Normalize
          </button>

          <button id="startBoardBtn" disabled
            style="padding:10px 20px; border:none; border-radius:8px; cursor:not-allowed; opacity:.6;">
            Start Board (New)
          </button>

          <button id="resumeBoardBtn" disabled
            style="padding:10px 20px; border:none; border-radius:8px; cursor:not-allowed; opacity:.6;">
            Resume Board
          </button>
        </div>

        <p id="status" style="margin-top:20px; color:#ccc;"></p>

        <pre id="preview" style="margin-top:16px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.10); padding:12px; border-radius:12px; overflow:auto; max-height:360px;"></pre>

        <button id="backBtn" style="margin-top:28px;">← Back</button>
      </div>
    `;

    const statusEl = document.getElementById("status");
    const previewEl = document.getElementById("preview");
    const swidEl = document.getElementById("swid");
    const s2El = document.getElementById("espn_s2");

    // Prefill last-used ESPN info (quality-of-life)
    const urlEl = document.getElementById("leagueUrl");
    if (urlEl && AppState.league?.lastEspnUrl) urlEl.value = AppState.league.lastEspnUrl;

    if (swidEl && AppState.league?.cookies?.swid) swidEl.value = AppState.league.cookies.swid;
    if (s2El && AppState.league?.cookies?.espn_s2) s2El.value = AppState.league.cookies.espn_s2;

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

    // Enable Resume if we already have a saved league config
if (resumeBoardBtn) {
  if (AppState.leagueConfig?.league && AppState.leagueConfig?.draft) {
    enableBtn(resumeBoardBtn);
  } else {
    disableBtn(resumeBoardBtn);
  }

  resumeBoardBtn.onclick = async () => {
    // Load latest saved state (in case it changed)
    await loadState();

    if (!AppState.leagueConfig?.league || !AppState.leagueConfig?.draft) {
      setStatus("Nothing to resume yet. Import a league first.");
      return;
    }

    // Go straight to the board without re-importing
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

      // Private ESPN leagues need cookies (SWID + espn_s2)
      const swid = (swidEl?.value || "").trim();
      const espn_s2 = (s2El?.value || "").trim();
      AppState.league = AppState.league || {};
      AppState.league.cookies = { swid, espn_s2 };

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

      AppState.leagueConfig = normalized;

      AppState.draft = AppState.draft || {};
      AppState.draft.rounds = normalized.draft.rounds;
      AppState.draft.teams = normalized.league.teams;
      AppState.draft.picks = [];

      AppState.playerSource = "espn";

      await saveState();

      // Fetch + cache ESPN player universe (for dropdown/search)
      setStatus("✅ League imported. Fetching ESPN player universe (this can take a moment)...");
      const seasonId = AppState.league?.seasonId;
      const cookies = AppState.league?.cookies;

      setStatus("🟦 Player fetch STARTED (debug) ...");
      const pRes = await fetchEspnPlayerUniverse({ seasonId, cookies, maxPlayers: 3000 });
      setPreview({ playerFetchResult: pRes });
      setStatus("🟦 Player fetch RETURNED (debug) ...");

      if (pRes.ok) {
        // Fetch pro team map for team abbrev + bye
        const teamRes = await fetchEspnProTeamMap({ seasonId, cookies });
        // DEBUG: show pro team fetch result in preview// Enrich players
        // Build pro team map (abbrev + bye) via background fetch (CORS-safe)
        const teamMap = teamRes.ok ? teamRes.map : {};

        // DEBUG (kept small): confirm we can resolve Lamar's proTeamId=33
        AppState._debug = AppState._debug || {};
        AppState._debug.teamMapSummary = {
          ok: teamRes.ok,
          mapSize: teamRes.ok ? Object.keys(teamMap).length : 0,
          has33: !!teamMap["33"],
          err: teamRes.ok ? null : (teamRes.error || "unknown")
        };

        const enriched = pRes.players.map(p => {
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
      await renderBoard();
    };
  }

  const btnEspn = document.getElementById("btnEspn");
  if (btnEspn) btnEspn.addEventListener("click", renderEspnImport);
})();
