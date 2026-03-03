export function parseEspnLeagueUrl(input) {
  const raw = (input || "").trim();
  if (!raw) return { ok: false, error: "Paste an ESPN league URL first." };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "That doesn’t look like a valid URL." };
  }

  const hostOk = /(^|\.)espn\.com$/i.test(url.hostname) || /(^|\.)fantasy\.espn\.com$/i.test(url.hostname);
  if (!hostOk) {
    return { ok: false, error: "URL must be from ESPN (fantasy.espn.com / espn.com)." };
  }

  const leagueId = url.searchParams.get("leagueId") || "";
  if (!leagueId || !/^\d+$/.test(leagueId)) {
    return { ok: false, error: "Could not find leagueId in the URL (expected ?leagueId=####)." };
  }

  // Season can show up as seasonId=YYYY, seasonId in some links, or default to current year
  const now = new Date();
  const defaultSeason = String(now.getFullYear());

  const seasonId = (url.searchParams.get("seasonId") || url.searchParams.get("season") || defaultSeason).trim();
  if (!/^\d{4}$/.test(seasonId)) {
    return { ok: false, error: "seasonId must be a 4-digit year (e.g., 2026)." };
  }

  return { ok: true, leagueId, seasonId };
}
