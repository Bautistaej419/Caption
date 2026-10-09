import { AccessToken } from "livekit-server-sdk";

function allowedOrigins(env) {
    return (env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean);
}

function isAllowedOrigin(origin, env) {
    return Boolean(origin) && allowedOrigins(env).includes(origin.replace(/\/$/, ""));
}

function corsHeaders(origin) {
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
    };
}

function json(body, status, origin) {
    return Response.json(body, { status, headers: corsHeaders(origin) });
}

async function verifyLiveKitCredentials(env) {
    const verifier = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
        identity: "caption-worker-verification",
        ttl: "1m"
    });
    verifier.addGrant({ roomList: true });

    const apiUrl = `${env.LIVEKIT_URL.replace(/^wss:/, "https:").replace(/\/$/, "")}/twirp/livekit.RoomService/ListRooms`;
    const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${await verifier.toJwt()}`,
            "Content-Type": "application/json"
        },
        body: "{}"
    });
    return response.ok ? { valid: true } : { valid: false, status: response.status };
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get("Origin");
        const url = new URL(request.url);

        if (url.pathname === "/health" && request.method === "GET") {
            return Response.json({ ok: true });
        }

        if (url.pathname === "/verify" && request.method === "GET") {
            if (!isAllowedOrigin(origin, env)) {
                return Response.json({ error: "Origin is not allowed" }, { status: 403 });
            }
            if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
                return json({ valid: false, error: "LiveKit Worker secrets are not configured" }, 400, origin);
            }
            try {
                return json(await verifyLiveKitCredentials(env), 200, origin);
            } catch {
                return json({ valid: false, error: "Could not reach the LiveKit server" }, 502, origin);
            }
        }

        if (url.pathname !== "/token") {
            return Response.json({ error: "Not found" }, { status: 404 });
        }
        if (!isAllowedOrigin(origin, env)) {
            return Response.json({ error: "Origin is not allowed" }, { status: 403 });
        }
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders(origin) });
        }
        if (request.method !== "POST") {
            return json({ error: "Use POST /token" }, 405, origin);
        }

        try {
            const { room, identity } = await request.json();
            if (!/^[a-zA-Z0-9_-]{1,64}$/.test(room || "")) throw new Error("Invalid room ID");
            if (!/^caption-[a-zA-Z0-9_-]{8,128}$/.test(identity || "")) throw new Error("Invalid participant");
            if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
                throw new Error("LiveKit Worker secrets are not configured");
            }

            const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
                identity,
                ttl: "15m"
            });
            token.addGrant({
                room,
                roomJoin: true,
                canPublish: true,
                canSubscribe: true,
                canPublishData: true
            });
            return json({ token: await token.toJwt(), url: env.LIVEKIT_URL }, 200, origin);
        } catch (error) {
            return json({ error: error.message || "Could not create a video token" }, 400, origin);
        }
    }
};
