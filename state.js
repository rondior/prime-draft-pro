export const AppState = {
  league: null,
  playerSource: null,
  rosterConfig: null,
  draft: {
    rounds: 0,
    teams: [],
    picks: [] // { round, teamIndex, player }
  },
  settings: {
    autoAssign: true,
    enforceLimits: true,
    enforceRosterSize: true
  }
};

export function saveState() {
  return new Promise((resolve) => {
    chrome.storage.local.set({ primeDraftState: AppState }, resolve);
  });
}

export function loadState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["primeDraftState"], (result) => {
      if (result.primeDraftState) {
        Object.assign(AppState, result.primeDraftState);
      }
      resolve(AppState);
    });
  });
}

export function resetState() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(["primeDraftState"], () => {
      AppState.league = null;
      AppState.playerSource = null;
      AppState.rosterConfig = null;
      AppState.draft = { rounds: 0, teams: [], picks: [] };
      resolve();
    });
  });
}
