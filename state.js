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

const STORAGE_KEYS = {
  LEGACY_STATE: "primeDraftState",
  DRAFTS: "primeDraftDrafts",
  ACTIVE_DRAFT_ID: "primeDraftActiveDraftId"
};

function makeDefaultSettings() {
  return {
    autoAssign: true,
    enforceLimits: true,
    enforceRosterSize: true
  };
}

function makeEmptyDraftState() {
  return {
    league: null,
    playerSource: null,
    rosterConfig: null,
    draft: {
      rounds: 0,
      teams: [],
      picks: []
    },
    settings: makeDefaultSettings(),
    _debug: null
  };
}

function cloneCurrentAppState() {
  const league = AppState.league
    ? {
        platform: AppState.league.platform ?? null,
        leagueId: AppState.league.leagueId ?? null,
        seasonId: AppState.league.seasonId ?? null,
        name: AppState.league.name ?? null,
        lastEspnUrl: AppState.league.lastEspnUrl ?? null,
        cookies: AppState.league.cookies ?? null
      }
    : null;

  const leagueConfig = AppState.leagueConfig
    ? {
        league: AppState.leagueConfig.league ?? null,
        draft: AppState.leagueConfig.draft ?? null
      }
    : null;

  return {
    league,
    leagueConfig,
    playerSource: AppState.playerSource ?? null,
    rosterConfig: AppState.rosterConfig ?? null,
    draft: AppState.draft ?? { rounds: 0, teams: [], picks: [] },
    settings: AppState.settings ?? makeDefaultSettings(),
    _debug: AppState._debug ?? null
  };
}

function applyStateToApp(state) {
  const safe = state || makeEmptyDraftState();

  AppState.league = safe.league ?? null;
  AppState.leagueConfig = safe.leagueConfig ?? null;
  AppState.playerSource = safe.playerSource ?? null;
  AppState.rosterConfig = safe.rosterConfig ?? null;
  AppState.draft = safe.draft ?? { rounds: 0, teams: [], picks: [] };
  AppState.settings = safe.settings ?? makeDefaultSettings();
  AppState._debug = safe._debug ?? null;
}

function makeDraftId() {
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getDraftNameFromState(state) {
  return (
    state?.league?.name ||
    state?.league?.settings?.name ||
    state?.league?.leagueName ||
    "Untitled Draft"
  );
}

function buildDraftRecordFromState(state, draftId) {
  const teams = state?.draft?.teams ?? [];
  const rounds = state?.draft?.rounds ?? 0;
  const picks = state?.draft?.picks ?? [];
  const totalPicks = teams.length * rounds;

  let status = "setup";
  if (picks.length > 0 && totalPicks > 0 && picks.length >= totalPicks) {
    status = "completed";
  } else if (picks.length > 0) {
    status = "active";
  }

  return {
    id: draftId ?? makeDraftId(),
    name: getDraftNameFromState(state),
    season:
      state?.league?.seasonId ??
      state?.league?.season ??
      new Date().getFullYear(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status,
    summary: {
      teams: teams.length,
      rounds,
      picksMade: picks.length,
      totalPicks
    },
    state
  };
}

export function saveState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [STORAGE_KEYS.DRAFTS, STORAGE_KEYS.ACTIVE_DRAFT_ID],
      (result) => {
        const drafts = result[STORAGE_KEYS.DRAFTS] ?? {};
        let activeDraftId = result[STORAGE_KEYS.ACTIVE_DRAFT_ID] ?? null;

        const compact = cloneCurrentAppState();

        if (!activeDraftId) {
          activeDraftId = makeDraftId();
        }

        const existing = drafts[activeDraftId];
        const record = buildDraftRecordFromState(compact, activeDraftId);

        if (existing?.createdAt) {
          record.createdAt = existing.createdAt;
        }

        drafts[activeDraftId] = record;

        chrome.storage.local.set(
          {
            [STORAGE_KEYS.DRAFTS]: drafts,
            [STORAGE_KEYS.ACTIVE_DRAFT_ID]: activeDraftId,
            [STORAGE_KEYS.LEGACY_STATE]: compact
          },
          () => resolve()
        );
      }
    );
  });
}

export function loadState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.LEGACY_STATE,
        STORAGE_KEYS.DRAFTS,
        STORAGE_KEYS.ACTIVE_DRAFT_ID
      ],
      (result) => {
        const drafts = result[STORAGE_KEYS.DRAFTS] ?? {};
        const activeDraftId = result[STORAGE_KEYS.ACTIVE_DRAFT_ID] ?? null;
        const activeRecord = activeDraftId ? drafts[activeDraftId] : null;

        if (activeRecord?.state) {
          applyStateToApp(activeRecord.state);
          resolve(AppState);
          return;
        }

          applyStateToApp(makeEmptyDraftState());
          resolve(AppState);
      }
    );
  });
}

export function resetState() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEYS.LEGACY_STATE], () => {
      applyStateToApp(makeEmptyDraftState());
      resolve();
    });
  });
}

export function listDrafts() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.DRAFTS], (result) => {
      const drafts = Object.values(result[STORAGE_KEYS.DRAFTS] ?? {});
      drafts.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      resolve(drafts);
    });
  });
}

export function getActiveDraftId() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.ACTIVE_DRAFT_ID], (result) => {
      resolve(result[STORAGE_KEYS.ACTIVE_DRAFT_ID] ?? null);
    });
  });
}

export function setActiveDraftId(draftId) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { [STORAGE_KEYS.ACTIVE_DRAFT_ID]: draftId ?? null },
      () => resolve()
    );
  });
}

export function createNewDraftRecord({
  name = "Untitled Draft",
  season = new Date().getFullYear()
} = {}) {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.DRAFTS], (result) => {
      const drafts = result[STORAGE_KEYS.DRAFTS] ?? {};
      const draftId = makeDraftId();

      const emptyState = makeEmptyDraftState();
      emptyState.league = { name, seasonId: season };

      const record = buildDraftRecordFromState(emptyState, draftId);
      record.name = name;
      record.season = season;

      drafts[draftId] = record;

      chrome.storage.local.set(
        {
          [STORAGE_KEYS.DRAFTS]: drafts,
          [STORAGE_KEYS.ACTIVE_DRAFT_ID]: draftId
        },
        () => {
          applyStateToApp(emptyState);
          resolve(record);
        }
      );
    });
  });
}

export function loadDraftById(draftId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [STORAGE_KEYS.DRAFTS, STORAGE_KEYS.ACTIVE_DRAFT_ID],
      (result) => {
        const drafts = result[STORAGE_KEYS.DRAFTS] ?? {};
        const record = drafts[draftId] ?? null;

        if (!record?.state) {
          resolve(null);
          return;
        }

        applyStateToApp(record.state);

        chrome.storage.local.set(
          {
            [STORAGE_KEYS.ACTIVE_DRAFT_ID]: draftId,
            [STORAGE_KEYS.LEGACY_STATE]: record.state
          },
          () => resolve(record)
        );
      }
    );
  });
}

export function deleteDraftById(draftId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [STORAGE_KEYS.DRAFTS, STORAGE_KEYS.ACTIVE_DRAFT_ID],
      (result) => {
        const drafts = { ...(result[STORAGE_KEYS.DRAFTS] ?? {}) };
        const activeDraftId = result[STORAGE_KEYS.ACTIVE_DRAFT_ID] ?? null;

        delete drafts[draftId];

        const payload = {
          [STORAGE_KEYS.DRAFTS]: drafts
        };

        if (activeDraftId === draftId) {
          payload[STORAGE_KEYS.ACTIVE_DRAFT_ID] = null;
        }

        chrome.storage.local.set(payload, () => resolve());
      }
    );
  });
}