import { AppState, loadState, saveState } from "./state.js";
import { parseEspnLeagueUrl, fetchEspnLeagueSettingsWithFallback } from "./espn.js";

(async function () {
  const m = chrome.runtime.getManifest();
  document.getElementById("ver").textContent = `v${m.version}`;

  await loadState();

  const root = document.body;

  function renderEspnImport() {
    root.innerHTML = `
      <div style="padding:40px; font-family:system-ui; color:white; background:#0b0d12; min-height:100vh;">
        <h1>Import from ESPN</h1>
        <p>Paste your ESPN league URL below. We’ll fetch teams + roster/draft settings, then cache locally for draft night.</p>

        <input id="leagueUrl" type="text"
          placeholder="https://fantasy.espn.com/football/league?leagueId=35228&seasonId=2026"
          style="width:100%; padding:10px; margin:15px 0; border-radius:8px; border:none;" />

        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button id="parseBtn"
            style="padding:10px 20px; border:none; border-radius:8px; cursor:pointer;">
            Parse URL
          </button>

          <button id="fetchBtn" disabled
            style="padding:10px 20px; border:none; border-radius:8px; cursor:not-allowed; opacity:.6;">
            Fetch League Settings
          </button>
        </div>

        <p id="status" style="margin-top:20px; color:#ccc;"></p>

        <pre id="preview" style="margin-top:16px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.10); padding:12px; border-radius:12px; overflow:auto; max-height:280px;"></pre>

        <button id="backBtn" style="margin-top:28px;">← Back</button>
      </div>
    `;

    const statusEl = document.getElementById("status");
    const previewEl = document.getElementById("preview");
    const fetchBtn = document.getElementById("fetchBtn");

    const setStatus = (msg) => (statusEl.textContent = msg || "");
    const setPreview = (obj) => (previewEl.textContent = obj ? JSON.stringify(obj, null, 2) : "");

    let parsed = null;

    document.getElementById("backBtn").onclick = () => location.reload();

    document.getElementById("parseBtn").onclick = () => {
      const url = document.getElementById("leagueUrl").value;
      const p = parseEspnLeagueUrl(url);

      if (!p.ok) {
        parsed = null;
        fetchBtn.disabled = true;
        fetchBtn.style.cursor = "not-allowed";
        fetchBtn.style.opacity = ".6";
        setStatus(`❌ ${p.error}`);
        setPreview(null);
        return;
      }

      parsed = p;

      AppState.league = AppState.league || {};
      AppState.league.platform = "espn";
      AppState.league.leagueId = parsed.leagueId;
      AppState.league.seasonId = parsed.seasonId;

      fetchBtn.disabled = false;
      fetchBtn.style.cursor = "pointer";
      fetchBtn.style.opacity = "1";

      setStatus(`✅ Parsed leagueId=${parsed.leagueId}, seasonId=${parsed.seasonId}`);
      setPreview({ parsed });
    };

    fetchBtn.onclick = async () => {
      if (!parsed?.leagueId || !parsed?.seasonId) return;

      setStatus("Fetching league settings from ESPN (trying season fallback if needed)...");
      setPreview(null);

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

      // Cache raw ESPN league payload for offline use
      AppState.league = AppState.league || {};
      AppState.league.platform = "espn";
      AppState.league.leagueId = parsed.leagueId;
      AppState.league.seasonId = result.seasonIdResolved; // IMPORTANT: resolved season
      AppState.league.name = result.leagueName;
      AppState.league._espnRaw = result.data;

      await saveState();

      setStatus(`✅ Fetched: ${result.leagueName} (${result.teamCount} teams). Season resolved to ${result.seasonIdResolved}. Cached locally.`);
      setPreview({
        leagueName: result.leagueName,
        teamCount: result.teamCount,
        seasonResolved: result.seasonIdResolved,
        fetchedFrom: result.url,
        attempts: result.attempts
      });
    };
  }

  const btnEspn = document.getElementById("btnEspn");
  if (btnEspn) btnEspn.addEventListener("click", renderEspnImport);
})();
