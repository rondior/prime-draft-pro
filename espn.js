export function parseEspnLeagueUrl(input) {
  const raw = (input || "").trim();
  if (!raw) return { ok: false, error: "Paste an ESPN league URL first." };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "That doesn’t look like a valid URL." };
  }

  const hostOk =
    /(^|\.)espn\.com$/i.test(url.hostname) ||
    /(^|\.)fantasy\.espn\.com$/i.test(url.hostname);

  if (!hostOk) {
    return { ok: false, error: "URL must be from ESPN (fantasy.espn.com / espn.com)." };
  }

  const leagueId = url.searchParams.get("leagueId") || "";
  if (!leagueId || !/^\d+$/.test(leagueId)) {
    return { ok: false, error: "Could not find leagueId in the URL (expected ?leagueId=####)." };
  }

  const now = new Date();
  const defaultSeason = String(now.getFullYear());

  const seasonId = (
    url.searchParams.get("seasonId") ||
    url.searchParams.get("season") ||
    defaultSeason
  ).trim();

  if (!/^\d{4}$/.test(seasonId)) {
    return { ok: false, error: "seasonId must be a 4-digit year (e.g., 2026)." };
  }

  return { ok: true, leagueId, seasonId };
}

export function buildEspnLeagueEndpoint({ leagueId, seasonId }) {
  const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/segments/0/leagues/${leagueId}`;
  const params = new URLSearchParams();
  params.append("view", "mSettings");
  params.append("view", "mTeam");
  params.append("view", "mRoster");
  params.append("view", "mDraftDetail");
  return `${base}?${params.toString()}`;
}

async function fetchOnce({ leagueId, seasonId }) {
  const url = buildEspnLeagueEndpoint({ leagueId, seasonId });

  const res = await fetch(url, {
    method: "GET",
    credentials: "include"
  });

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      kind: "auth",
      url,
      error:
        "ESPN blocked access (private league). Next step will add private-league support via ESPN cookies."
    };
  }

  if (res.status === 404) {
    return { ok: false, kind: "notfound", url, error: `Not found for seasonId=${seasonId}` };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      kind: "http",
      url,
      error: `ESPN fetch failed (${res.status}). ${text ? text.slice(0, 140) : ""}`.trim()
    };
  }

  const data = await res.json();
  const leagueName = data?.settings?.name || data?.name || "ESPN League";
  const teamCount = Array.isArray(data?.teams) ? data.teams.length : 0;

  return { ok: true, url, leagueName, teamCount, data };
}

export async function fetchEspnLeagueSettingsWithFallback({ leagueId, seasonId }) {
  const s = Number(seasonId);
  const candidates = [s, s - 1, s - 2].filter((x) => x >= 2000).map(String);

  const attempts = [];
  for (const cand of candidates) {
    const r = await fetchOnce({ leagueId, seasonId: cand });
    attempts.push({ seasonId: cand, ok: r.ok, url: r.url, kind: r.kind || "ok" });

    if (r.ok) return { ...r, seasonIdResolved: cand, attempts };
    if (r.kind === "auth") return { ...r, seasonIdResolved: cand, attempts }; // stop on auth blocks
  }

  return {
    ok: false,
    error: `Could not find this league under seasons: ${candidates.join(", ")}.`,
    attempts
  };
}
