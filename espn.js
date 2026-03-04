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

function buildEspnCookieHeader(cookies) {
  const swid = (cookies?.swid || "").trim();
  const s2 = (cookies?.espn_s2 || "").trim();
  const parts = [];
  if (swid) parts.push(`SWID=${swid}`);
  if (s2) parts.push(`espn_s2=${s2}`);
  return parts.join("; ");
}


function bgFetchJson({ url, cookies, timeoutMs = 15000 }) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "ESPN_FETCH_JSON", url, cookies, timeoutMs },
      (resp) => resolve(resp || { ok: false, status: 0, error: "No response from background" })
    );
  });
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

async function fetchOnce({ leagueId, seasonId, cookies }) {
  const url = buildEspnLeagueEndpoint({ leagueId, seasonId });
  const cookieHeader = buildEspnCookieHeader(cookies);

  const res = await fetch(url, {
    method: "GET",
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
    credentials: "include"
  });

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      kind: "auth",
      url,
      error: "ESPN blocked access (private league). Check SWID + espn_s2."
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

export async function fetchEspnLeagueSettingsWithFallback({ leagueId, seasonId, cookies }) {
  const s = Number(seasonId);
  const candidates = [s, s - 1, s - 2].filter((x) => x >= 2000).map(String);

  const attempts = [];
  for (const cand of candidates) {
    const r = await fetchOnce({ leagueId, seasonId: cand, cookies });
    attempts.push({ seasonId: cand, ok: r.ok, url: r.url, kind: r.kind || "ok" });

    if (r.ok) return { ...r, seasonIdResolved: cand, attempts };
    if (r.kind === "auth") return { ...r, seasonIdResolved: cand, attempts };
  }

  return {
    ok: false,
    error: `Could not find this league under seasons: ${candidates.join(", ")}.`,
    attempts
  };
}

/* -----------------------
   ESPN Player Universe
   ----------------------- */

const ESPN_POS_MAP = {
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
  13: "S"
};

function simplifyEspnPlayer(p) {
  const id = p?.id;
  const name = p?.fullName || p?.name || "";
  const pos =
    ESPN_POS_MAP[p?.defaultPositionId] ||
    (p?.defaultPositionId ? String(p.defaultPositionId) : "");
  const proTeamId = p?.proTeamId ?? null;
  const eligibleSlots = Array.isArray(p?.eligibleSlots) ? p.eligibleSlots : [];
  return { id, name, pos, proTeamId, eligibleSlots };
}

export async function fetchEspnPlayerUniverse({
  seasonId,
  cookies,
  maxPlayers = 3000,
  limit = 300,
  timeoutMs = 15000
}) {
  const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${seasonId}/players`;
  let offset = 0;
  const all = [];

  while (true) {
    const filter = { players: { limit, offset } };
    const url = `${base}?view=kona_player_info&filter=${encodeURIComponent(JSON.stringify(filter))}`;

    const resp = await bgFetchJson({ url, cookies, timeoutMs });

    if (!resp?.ok) {
      const status = resp?.status ?? 0;
      const finalUrl = resp?.finalUrl || url;
      const snip = resp?.textSnippet || resp?.error || "";
      return {
        ok: false,
        kind: "http",
        error: `ESPN player fetch failed (${status}) at offset=${offset}. ${finalUrl} ${snip}`.trim()
      };
    }

    const data = resp.json;
    const batch = Array.isArray(data)
      ? data
      : (Array.isArray(data?.players) ? data.players : []);

    // DEBUG (temporary): expose what ESPN actually returned
    if (offset === 0) {
      const sample = batch && batch.length ? batch[0] : null;
      if (!batch || batch.length === 0) {
        return {
          ok: false,
          kind: "empty",
          error: "ESPN player response parsed, but batch was empty at offset=0.",
          debug: {
            finalUrl: resp.finalUrl,
            status: resp.status,
            contentType: resp.contentType,
            jsonType: Array.isArray(data) ? "array" : typeof data,
            jsonKeys: data && !Array.isArray(data) ? Object.keys(data).slice(0, 20) : null
          }
        };
      }
      // Put a sample in the console too
      console.log("[ESPN players] sample item keys:", sample && typeof sample === "object" ? Object.keys(sample) : sample);
      console.log("[ESPN players] sample item:", sample);
    }


    const simplified = batch.map(simplifyEspnPlayer).filter(x => x.id && x.name);
    all.push(...simplified);

    if (all.length >= maxPlayers) break;
    if (!batch.length || batch.length < limit) break;

    offset += limit;
    if (offset > 9000) break; // safety
  }

  // de-dupe by id
  const seen = new Set();
  const uniq = [];
  for (const p of all) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    uniq.push(p);
  }

  return { ok: true, count: uniq.length, players: uniq };


}
