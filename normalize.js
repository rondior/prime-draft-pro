function safeInt(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

// ESPN position IDs -> our atomic/group keys (V1)
const ESPN_POS_ID_TO_KEY = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST",

  // IDP
  9: "DT",
  10: "DE",
  11: "LB",
  12: "CB",
  13: "S",

  // Sometimes ESPN exposes grouped positions too
  14: "DB",
  15: "DL"
};

// ESPN lineup slot IDs -> roster slot keys (based on your league debug)
const SLOT_ID_TO_KEY = {
  0: "QB",
  2: "RB",
  4: "WR",
  6: "TE",
  16: "DST",
  17: "K",

  20: "BE",
  21: "IR",   // ignored during draft (V1)

  23: "FLEX",

  // IDP starters (YOUR LEAGUE)
  10: "LB",
  11: "DL",
  14: "DB"
};

export function normalizeEspnLeague(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Missing ESPN raw league data." };
  }

  const leagueName = raw?.settings?.name || raw?.name || "ESPN League";

  const teams = Array.isArray(raw?.teams)
    ? raw.teams
        .map((t) => ({
          id: t?.id,
          name:
            t?.location && t?.nickname
              ? `${t.location} ${t.nickname}`
              : (t?.name || `Team ${t?.id ?? ""}`.trim()),
          abbrev: t?.abbrev || ""
        }))
        .filter((t) => t.id != null)
    : [];

  const teamCount = teams.length;

  const lineupSlotCounts = raw?.settings?.rosterSettings?.lineupSlotCounts || {};

  // Build slots (include BE, exclude IR per V1)
  const slots = [];
  Object.keys(lineupSlotCounts).forEach((slotIdStr) => {
    const slotId = Number(slotIdStr);
    const count = safeInt(lineupSlotCounts[slotIdStr], 0);
    if (!count) return;

    const key = SLOT_ID_TO_KEY[slotId];
    if (!key) return;

    if (key === "IR") return; // ignored during draft

    slots.push({ key, count, slotId });
  });

  const benchCount = slots.find((s) => s.key === "BE")?.count || 0;

  const starterCount = slots
    .filter((s) => s.key !== "BE")
    .reduce((a, s) => a + s.count, 0);

  // Draft rounds = starters + bench (IR ignored in draft)
  const rounds = starterCount + benchCount;

  // Limits (ignore 0 and ignore negatives like -1)
  const positionLimitsRaw = raw?.settings?.rosterSettings?.positionLimits || {};
  const limits = {};

  Object.keys(positionLimitsRaw).forEach((posIdStr) => {
    const posId = Number(posIdStr);
    const max = safeInt(positionLimitsRaw[posIdStr], 0);

    if (max <= 0) return; // skips 0 and -1

    const key = ESPN_POS_ID_TO_KEY[posId];
    if (!key) return;

    limits[key] = max;
  });

  // Groups (V1 keys only)
  const groups = {};
  const usesDL = slots.some((s) => s.key === "DL") || limits.DL != null;
  const usesDB = slots.some((s) => s.key === "DB") || limits.DB != null;

  if (usesDL) groups.DL = ["DT", "DE"];
  if (usesDB) groups.DB = ["CB", "S"];

  // FLEX eligibility (ESPN FLEX is RB/WR/TE)
  const flex = {};
  if (slots.some((s) => s.key === "FLEX")) {
    flex.FLEX = ["RB", "WR", "TE"];
  }

  return {
    ok: true,
    league: {
      platform: "espn",
      name: leagueName,
      teams,
      teamCount
    },
    draft: {
      rounds,
      type: raw?.settings?.draftSettings?.type ?? null
    },
    roster: {
      rosterSize: rounds,
      starters: starterCount,
      bench: benchCount,
      slots: slots
        .filter((s) => s.key !== "BE")
        .map((s) => ({ key: s.key, count: s.count })),
      groups,
      flex,
      limits
    }
  };
}
