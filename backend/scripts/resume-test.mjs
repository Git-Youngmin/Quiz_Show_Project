// 재접속 토큰 테스트: 백엔드를 `RESUME_GRACE_MS=8000` 으로 실행 후
//   RESUME_GRACE_MS=8000 npm run test:resume
// (RESUME_GRACE_MS 를 주지 않으면 대기 만료 시나리오는 건너뜀)
const BASE = process.env.WS_BASE ?? "ws://127.0.0.1:8787";
const HTTP = BASE.replace(/^ws/, "http");
const GRACE = Number(process.env.RESUME_GRACE_MS) || 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`); if (!ok) failed++; };

function connect(room, q) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE}/api/rooms/${room}/ws?${new URLSearchParams(q)}`);
    const c = { ws, log: [], id: null, token: null, welcome: null, closeCode: null };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data); c.log.push(m);
      if (m.type === "welcome") { c.id = m.selfId; c.token = m.resumeToken ?? null; c.welcome = m; resolve(c); }
    };
    ws.onclose = (e) => { c.closeCode = e.code; resolve(c); };
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
const lastGame = (c) => c.log.filter((m) => m.type === "game_state").at(-1)?.game;
const has = (c, pred) => c.log.some(pred);
async function waitPhase(c, phase, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  while (lastGame(c)?.phase !== phase && Date.now() < end) await sleep(50);
  return lastGame(c)?.phase === phase;
}
const createRoom = (roomId) => fetch(`${HTTP}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, adminPassword: "pw-1234" }) });
const selfIn = (welcome) => welcome.players.find((p) => p.id === welcome.selfId);
// 단계 시간: countdown 3s · 문제(timeLimitSec) · reveal 3s · elimination 4.5s
const Q = 3;

const ROOM = `resume-${Date.now()}`;
await createRoom(ROOM);
const admin = await connect(ROOM, { role: "admin", password: "pw-1234" });
const display = await connect(ROOM, { role: "display" });
let a = await connect(ROOM, { role: "player", name: "A" });
let b = await connect(ROOM, { role: "player", name: "B" });
let c = await connect(ROOM, { role: "player", name: "C" });
check("참가자는 welcome 에 재접속 토큰을 받음", typeof a.token === "string" && a.token.length >= 32 && a.welcome.resumed === false);
check("송출 화면에는 토큰 없음", display.welcome.resumeToken === undefined);

send(admin, {
  type: "admin_start_game",
  quizzes: [
    { quizType: "OX", question: "R1", answer: "O", timeLimitSec: Q },
    { quizType: "OX", question: "R2", answer: "O", timeLimitSec: Q },
  ],
});
await sleep(200);
send(a, { type: "move", p: [-5, 0.8, -5], r: 0 });
send(b, { type: "move", p: [-5, 0.8, 5], r: 0 });
send(c, { type: "move", p: [5, 0.8, 5], r: 0 }); // X 구역 → 오답
await sleep(300);

// 1) 문제 진행 중 끊김 → 같은 토큰으로 복귀하면 생존 상태·위치·id 유지
b.ws.close(); await sleep(300);
check("끊긴 참가자는 다른 화면에서 사라짐(player_left)", has(display, (m) => m.type === "player_left" && m.id === b.id));
const b2 = await connect(ROOM, { role: "player", name: "B", resume: b.token });
const meB = selfIn(b2.welcome);
check("문제 진행 중 재접속 → 같은 자리로 복귀 (관전자가 되지 않음)", b2.welcome.resumed === true && b2.id === b.id && meB.alive === true, `phase=${lastGame(b2)?.phase} alive=${meB.alive}`);
check("복귀 시 마지막 위치 유지", meB.p[0] === -5 && meB.p[2] === 5, JSON.stringify(meB.p));
check("복귀하면 다른 화면에 다시 나타남(player_joined, 같은 id)", has(display, (m) => m.type === "player_joined" && m.player.id === b.id));
b = b2;

// 2) 끊긴 동안에도 판정 대상: C 가 오답 구역에서 끊긴 채 정답 공개 → 탈락 처리
// 문제가 진행 중일 때 끊김 (대기 시간 안에 정답 공개·판정이 오도록)
await waitPhase(display, "question_active");
c.ws.close();
await waitPhase(display, "elimination");
await sleep(200);
check("끊긴 채로 있던 오답자도 탈락 판정", has(display, (m) => m.type === "players_eliminated" && m.ids.includes(c.id)));
const c2 = await connect(ROOM, { role: "player", name: "C", resume: c.token });
check("탈락 후 재접속 → 탈락 상태 그대로 복귀", c2.welcome.resumed === true && selfIn(c2.welcome).alive === false);
c = c2;

// 3) 서버가 아직 끊김을 모르는 상태에서 같은 토큰으로 다시 접속 → 옛 연결은 4010 으로 대체
const a2 = await connect(ROOM, { role: "player", name: "A", resume: a.token });
await sleep(300);
check("살아 있는 연결을 같은 토큰으로 대체 → 옛 연결 4010", a.closeCode === 4010 && a2.id === a.id && a2.welcome.resumed === true, `old close=${a.closeCode}`);
check("대체 시 player_left 없이 자리 유지", !has(display, (m) => m.type === "player_left" && m.id === a.id));
a = a2;

// 4) 스스로 나가기(leave) → 즉시 제거, 같은 토큰으로는 복귀 불가(새 참가자)
send(c, { type: "leave" });
await sleep(300);
check("나가기 → 즉시 player_left", has(display, (m) => m.type === "player_left" && m.id === c.id) && c.closeCode === 1000);
const c3 = await connect(ROOM, { role: "player", name: "C", resume: c.token });
check("나간 뒤 옛 토큰 → 새 참가자로 입장", c3.welcome.resumed === false && c3.id !== c.id);
check("잘못된 토큰 → 새 참가자로 입장", (await connect(ROOM, { role: "player", name: "Z", resume: "nope" })).welcome.resumed === false);

// 5) 대기 시간 만료: 라운드 결과 화면에서 생존자가 끊긴 채 돌아오지 않으면 자리 정리 → 1명 남아 game_over
if (GRACE) {
  await waitPhase(display, "round_standings");
  check("1번 문제 후 round_standings", lastGame(display)?.phase === "round_standings", lastGame(display)?.phase);
  b.ws.close();
  await sleep(GRACE / 2);
  check("대기 중에는 아직 게임 계속", lastGame(display)?.phase === "round_standings");
  await sleep(GRACE / 2 + 700);
  const g = lastGame(display);
  check("대기 만료 → 생존자 1명 → game_over (우승자 A)", g?.phase === "game_over" && g.winnerId === a.id, `phase=${g?.phase}`);
  const b3 = await connect(ROOM, { role: "player", name: "B", resume: b.token });
  check("만료 후 옛 토큰 → 새 참가자", b3.welcome.resumed === false);
} else {
  console.log("ℹ️  RESUME_GRACE_MS 미지정 — 대기 만료 시나리오 건너뜀");
}

for (const x of [admin, display, a, b, c, c3]) try { x.ws.close(); } catch {}
console.log(failed ? `❌ FAIL (${failed})` : "✅ PASS");
process.exit(failed ? 1 : 0);
