import type { CreateRoomRequest } from "@quiz/shared";

/** REST API 주소 — VITE_WS_BASE(wss://…)가 있으면 https://… 로, 없으면 같은 Origin */
export function apiBase(): string {
  const ws = import.meta.env.VITE_WS_BASE;
  return ws ? ws.replace(/^ws/, "http").replace(/\/$/, "") : "";
}

/** 방 생성 + 방장 비밀번호 설정 */
export async function createRoom(req: CreateRoomRequest): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${apiBase()}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (res.status === 201) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? `방 생성 실패 (${res.status})` };
  } catch {
    return { ok: false, error: "서버에 연결할 수 없습니다" };
  }
}
