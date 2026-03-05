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
    // Save ONLY what we need for persistence (avoid quota issues)
    const compact = {
      league: AppState.league ?? null,
      playerSource: AppState.playerSource ?? null,
      rosterConfig: AppState.rosterConfig ?? null,
      draft: AppState.draft ?? { rounds: 0, teams: [], picks: [] },
      settings: AppState.settings ?? {
        autoAssign: true,
        enforceLimits: true,
        enforceRosterSize: true
      },

      // Keep optional debug, but do NOT store giant player pools
      _debug: AppState._debug ?? null
    };

    chrome.storage.local.set({ primeDraftState: compact }, () => resolve());
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
