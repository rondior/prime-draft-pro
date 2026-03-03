import { AppState, loadState } from "./state.js";

(async function(){

  const m = chrome.runtime.getManifest();
  document.getElementById("ver").textContent = `v${m.version}`;

  await loadState();

  const root = document.body;

  function renderHome() {
    root.innerHTML = `
      ${document.documentElement.innerHTML}
    `;
  }

  function renderEspnImport() {
    root.innerHTML = `
      <div style="padding:40px; font-family:system-ui; color:white; background:#0b0d12; min-height:100vh;">
        <h1>Import from ESPN</h1>
        <p>Paste your ESPN league URL below.</p>
        <input id="leagueUrl" type="text" placeholder="https://fantasy.espn.com/football/league?leagueId=XXXX"
          style="width:100%; padding:10px; margin:15px 0; border-radius:8px; border:none;" />
        <button id="importBtn"
          style="padding:10px 20px; border:none; border-radius:8px; cursor:pointer;">
          Import League
        </button>
        <p id="status" style="margin-top:20px; color:#ccc;"></p>
        <button id="backBtn" style="margin-top:40px;">← Back</button>
      </div>
    `;

    document.getElementById("backBtn").onclick = () => location.reload();

    document.getElementById("importBtn").onclick = () => {
      const url = document.getElementById("leagueUrl").value;
      document.getElementById("status").textContent = "Parsing URL (API coming next step)...";
      console.log("League URL:", url);
    };
  }

  document.getElementById("btnEspn").addEventListener("click", renderEspnImport);

})();
