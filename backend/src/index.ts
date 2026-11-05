/**
 * Worker 엔트리포인트.
 *  - GET /api/health                    : 헬스체크
 *  - GET /api/rooms/:roomId/ws          : WebSocket 업그레이드 → 해당 방의 Durable Object 로 전달
 *      query: role=player|admin|display, name=닉네임(player 전용)
 */
import type { Env } from "./env";

export { GameRoom } from "./GameRoom";

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const WS_ROUTE = /^\/api\/rooms\/([^/]+)\/ws$/;

function isOriginAllowed(origin: string | null, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());
  if (allowed.includes("*")) return true;
  // 브라우저가 아닌 클라이언트(테스트 스크립트 등)는 Origin 헤더가 없을 수 있음
  if (!origin) return true;
  return allowed.includes(origin);
}

function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, time: Date.now() }, { headers: corsHeaders(origin) });
    }

    const match = url.pathname.match(WS_ROUTE);
    if (match) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      if (!isOriginAllowed(origin, env)) {
        return new Response("Origin not allowed", { status: 403 });
      }

      const roomId = decodeURIComponent(match[1]);
      if (!ROOM_ID_PATTERN.test(roomId)) {
        return new Response("Invalid room id", { status: 400 });
      }

      // 같은 roomId 는 전 세계 어디서 접속하든 항상 같은 DO 인스턴스로 라우팅됨
      const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(roomId));

      // DO 내부에서 roomId 를 알 수 있도록 헤더로 전달
      const forwarded = new Request(request);
      forwarded.headers.set("X-Room-Id", roomId);
      return stub.fetch(forwarded);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
