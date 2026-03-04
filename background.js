// Prime Draft Pro — background service worker
// - Opens app.html when the extension icon is clicked
// - Proxies ESPN JSON fetches using browser-managed cookies (avoids redirects/CORS)

chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
});

function getCookie(url, name) {
  return new Promise((resolve) => {
    chrome.cookies.get({ url, name }, (cookie) => resolve(cookie?.value || ""));
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (!msg || msg.type !== "ESPN_FETCH_JSON") return;

      const { url, timeoutMs = 15000 } = msg;

      // Use cookies from the browser cookie jar (most reliable)
      const swid = await getCookie("https://fantasy.espn.com/", "SWID");
      const s2 = await getCookie("https://fantasy.espn.com/", "espn_s2");

      // If missing (not logged in), we still try—ESPN may redirect
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), timeoutMs);

      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
        redirect: "follow",
        signal: ctrl.signal
      });

      clearTimeout(to);

      const text = await res.text().catch(() => "");
      const contentType = res.headers.get("content-type") || "";

      let json = null;
      let parseOk = false;
      try {
        json = text ? JSON.parse(text) : null;
        parseOk = (json !== null);
      } catch {
        parseOk = false;
      }

      // If ESPN redirected to an HTML page, fail and show where it went
      if (!res.ok || !parseOk) {
        sendResponse({
          ok: false,
          status: res.status,
          redirected: res.redirected,
          finalUrl: res.url,
          contentType,
          cookiePresent: { SWID: !!swid, espn_s2: !!s2 },
          textSnippet: text ? text.slice(0, 220) : ""
        });
        return;
      }

      sendResponse({
        ok: true,
        status: res.status,
        redirected: res.redirected,
        finalUrl: res.url,
        contentType,
        cookiePresent: { SWID: !!swid, espn_s2: !!s2 },
        json
      });
    } catch (e) {
      sendResponse({ ok: false, status: 0, error: String(e) });
    }
  })();

  return true;
});
