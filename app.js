import { AppState, loadState } from "./state.js";
import { parseEspnLeagueUrl } from "./espn.js";

(async function () {
  const m = chrome.runtime.getManifest();
  document.getElementById("ver").textContent = `v${m.version}`;

  await loadState();

  const root = document.body;

  function renderEspnImport() {
    root.innerHTML = `
      <div style="padding:40px; font-family:system-ui; color:white; background:#0b0d12; min-height:100vh;">
        <h1>Import from ESPN</h1>
        <p>Paste your ESPN league URL below.</p>

        <input id="leagueUrl" type="text"
          placeholder="https://fantasy.espn.com/football/league?leagueId=XXXX&seasonId=2026"
          style="width:100%; padding:10px; margin:15px 0; border-radius:8px; border:none;" />

        <button id="importBtn"
          style="padding:10px 20px; border:none; border-radius:8px; cursor:pointer;">
          Parse URL
        </button>

        <p id="status" style="margin-top:20px; color:#ccc;"></p>

        <button id="backBtn" style="margin-top:40px;">← Back</button>
      </div>
    `;

    const statusEl = document.getElementById("status");
    const setStatus = (msg) => (statusEl.textContent = msg || "");

    document.getElementById("backBtn").onclick = () => location.reload();

    document.getElementById("importBtn").onclick = () => {
      const url = document.getElementById("leagueUrl").value;
      const parsed = parseEspnLeagueUrl(url);

      if (!parsed.ok) {
        setStatus(`❌ ${parsed.error}`);
        return;
      }

      // stash in state for next step (API fetch)
      AppState.league = AppState.league || {};
      AppState.league.platform = "espn";
      AppState.league.leagueId = parsed.leagueId;
      AppState.league.seasonId = parsed.seasonId;

      setStatus(`✅ Parsed leagueId=${parsed.leagueId}, seasonId=${parsed.seasonId}`);
      console.log("Parsed ESPN league:", parsed);
      console.log("AppState.league:", AppState.league);
    };
  }

  // Hook ESPN button on the existing home screen
  const btnEspn = document.getElementById("btnEspn");
  if (btnEspn) btnEspn.addEventListener("click", renderEspnImport);
})();
