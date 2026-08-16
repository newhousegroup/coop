const TTL_SECONDS = 6 * 60 * 60;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function normalizeIceServers(iceServers) {
  if (!Array.isArray(iceServers)) return [];

  return iceServers
    .map((server) => {
      if (!server || typeof server !== "object") return null;

      const urls = Array.isArray(server.urls)
        ? server.urls
        : typeof server.urls === "string"
          ? [server.urls]
          : [];

      // Cloudflare notes that browser clients commonly block the alternate
      // port 53. Keep the primary UDP/TCP ports plus TLS/443 instead.
      const filteredUrls = urls.filter((url) => {
        if (typeof url !== "string") return false;
        return !/:53(?:\?|$)/.test(url);
      });

      if (!filteredUrls.length) return null;

      return {
        ...server,
        urls: filteredUrls
      };
    })
    .filter(Boolean);
}

export default async function handler(request) {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const token = process.env.TURNTOKEN;
  const keyId = process.env.TURNKEYID;

  if (!token || !keyId) {
    return json({
      error: "TURN is not configured",
      missing: [
        !token ? "TURNTOKEN" : null,
        !keyId ? "TURNKEYID" : null
      ].filter(Boolean)
    }, 503);
  }

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ ttl: TTL_SECONDS })
      }
    );

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload) {
      console.error("Cloudflare TURN credential request failed", response.status, payload);
      return json({ error: "TURN credential service unavailable" }, 502);
    }

    const iceServers = normalizeIceServers(payload.iceServers);
    const hasTurn = iceServers.some((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      return urls.some((url) => typeof url === "string" && /^turns?:/i.test(url));
    });

    if (!hasTurn) {
      console.error("Cloudflare response did not contain a usable TURN server");
      return json({ error: "TURN credential service returned no relay" }, 502);
    }

    return json({
      iceServers,
      expiresAt: Date.now() + TTL_SECONDS * 1000
    });
  } catch (error) {
    console.error("TURN credential function error", error);
    return json({ error: "TURN credential service unavailable" }, 502);
  }
}

export const config = {
  path: "/api/turn-credentials"
};
