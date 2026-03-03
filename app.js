(async function(){
  // Show manifest version
  const m = chrome.runtime.getManifest();
  document.getElementById("ver").textContent = `v${m.version}`;

  // Temp status area (we'll use this for import errors)
  const status = document.getElementById("status");
  const setStatus = (msg) => { status.textContent = msg || ""; };

  // Placeholder nav (next step will implement real screens/routes)
  document.getElementById("btnNew").addEventListener("click", () => {
    setStatus("Next: New Board wizard (coming in Step 2).");
  });

  document.getElementById("btnEspn").addEventListener("click", () => {
    setStatus("Next: ESPN Import screen (league URL → parse leagueId/season → fetch settings).");
  });

  document.getElementById("btnManual").addEventListener("click", () => {
    setStatus("Next: Manual Setup wizard (choose player source + roster schema).");
  });
})();
