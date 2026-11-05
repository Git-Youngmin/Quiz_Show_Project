// 퀴즈 세트 진행 + 정원 제한 테스트: 백엔드 실행 후 `npm run test:quizset`
const BASE = process.env.WS_BASE ?? "ws://127.0.0.1:8787";
const HTTP = BASE.replace(/^ws/, "http");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`); if (!ok) failed++; };

function connect(room, q) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE}/api/rooms/${room}/ws?${new URLSearchParams(q)}`);
    const c = { ws, log: [], id: null, closeCode: null };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); c.log.push(m); if (m.type === "welcome") { c.id = m.selfId; resolve(c); } };
    ws.onclose = (e) => { c.closeCode = e.code; resolve(c); };
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
const phases = (c) => c.log.filter((m) => m.type === "game_state").map((m) => m.game);
const lastGame = (c) => phases(c).at(-1);
const errors = (c) => c.log.filter((m) => m.type === "error").map((m) => m.message);
const createRoom = (roomId) => fetch(`${HTTP}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, adminPassword: "pw-1234" }) });

// ───────────── 1. 3문제 세트: round_standings 에서 멈추고 관리자가 넘김 ─────────────
{
  const ROOM = `set-${Date.now()}`;
  await createRoom(ROOM);
  const admin = await connect(ROOM, { role: "admin", password: "pw-1234" });
  const display = await connect(ROOM, { role: "display" });
  const [a, b, c] = [await connect(ROOM, { role: "player", name: "A" }), await connect(ROOM, { role: "player", name: "B" }), await connect(ROOM, { role: "player", name: "C" })];
  // A: O/A 구역(-x,-z), B: X/B 구역(+x,-z), C: O/C 구역(-x,+z) — 게임 시작 후 이동

  // 잘못된 세트 → 몇 번 문제가 문제인지 알려줌
  send(admin, { type: "admin_start_game", quizzes: [{ quizType: "OX", question: "ok", answer: "O", timeLimitSec: 3 }, { quizType: "MULTIPLE", question: "bad", answer: "B", choices: ["1", "", "3", "4"], timeLimitSec: 3 }] });
  send(admin, { type: "admin_start_game", quizzes: Array.from({ length: 51 }, () => ({ quizType: "OX", question: "q", answer: "O", timeLimitSec: 3 })) });
  send(admin, { type: "admin_start_game", quizzes: [] });
  await sleep(200);
  check("잘못된 세트 거부 (문제 번호 안내 / 51개 / 빈 세트)", errors(admin).length === 3, errors(admin).join(" | "));

  // 정상 세트: Q1(OX, 정답 O → B 탈락), Q2(4지선다, 정답 A → C 탈락), Q3(남지 않음)
  const quizzes = [
    { quizType: "OX", question: "Q1", answer: "O", timeLimitSec: 3 },
    { quizType: "MULTIPLE", question: "Q2", answer: "A", choices: ["가", "나", "다", "라"], timeLimitSec: 3 },
    { quizType: "OX", question: "Q3", answer: "X", timeLimitSec: 3 },
  ];
  send(admin, { type: "admin_start_game", quizzes });
  await sleep(200);
  // 게임 시작 시 서버가 전원을 새 스폰 위치로 옮기므로(round_reset) 그 뒤에 각자 구역으로 이동
  send(a, { type: "move", p: [-5, 0.8, -5], r: 0 });
  send(b, { type: "move", p: [5, 0.8, -5], r: 0 });
  send(c, { type: "move", p: [-5, 0.8, 5], r: 0 });
  const g1 = lastGame(display);
  check("게임 시작 → 1번 문제 카운트다운", g1.phase === "countdown" && g1.round === 1 && g1.totalQuestions === 3 && g1.question === "Q1");
  check("다음 문제 내용은 클라이언트에 노출되지 않음", !JSON.stringify(display.log).includes("Q2"));

  await sleep(3000 + 3000 + 3000 + 4500 + 300);
  const st = lastGame(display);
  check("1번 문제 후 round_standings 에서 멈춤", st.phase === "round_standings" && st.round === 1 && st.lastEliminatedCount === 1,
    `phase=${st.phase} eliminated=${st.lastEliminatedCount}`);
  send(a, { type: "fell" }); // round_standings 중 낙하 → 탈락 아님
  await sleep(2500);
  check("관리자가 넘기기 전에는 자동 진행 안 함 + 대기 중 낙하는 탈락 아님",
    lastGame(display).phase === "round_standings" && !display.log.some((m) => m.type === "players_eliminated" && m.ids.includes(a.id)));

  send(b, { type: "admin_next_question" }); // 참가자는 불가
  send(admin, { type: "admin_next_question" });
  await sleep(200);
  const g2 = lastGame(display);
  check("다음 문제 → 2번 문제(4지선다) 카운트다운", g2.phase === "countdown" && g2.round === 2 && g2.quizType === "MULTIPLE" && g2.choices?.[0] === "가");
  check("참가자의 다음 문제 요청 거부", errors(b).includes("Admin only"));

  await sleep(3000 + 3000 + 3000 + 4500 + 300);
  const over = lastGame(display);
  check("생존자 1명 → 남은 문제가 있어도 game_over (우승자 A)", over.phase === "game_over" && over.winnerId === a.id, `phase=${over.phase}`);

  // game_over 에서 다시 게임 시작 → 전원 부활 + 1번 문제
  send(admin, { type: "admin_start_game", quizzes: [quizzes[0]] });
  await sleep(200);
  const reset = display.log.filter((m) => m.type === "round_reset").at(-1);
  check("game_over 후 재시작 → 전원 부활 + 새 게임", reset?.players.every((p) => p.alive) && lastGame(display).round === 1);
  // 1문제 세트에서 2명 이상 생존 → 문제 소진으로 game_over (공동 생존, winnerId=null)
  send(a, { type: "move", p: [-5, 0.8, -5], r: 0 }); send(b, { type: "move", p: [-6, 0.8, 5], r: 0 }); send(c, { type: "move", p: [5, 0.8, 5], r: 0 });
  await sleep(3000 + 3000 + 3000 + 4500 + 300);
  const end = lastGame(display);
  check("문제 소진 + 여러 명 생존 → game_over (공동 생존)", end.phase === "game_over" && end.winnerId === null && end.lastEliminatedCount === 1, `phase=${end.phase}`);
  // 입장 시 생존 여부: 게임 종료 화면에서 들어오면 바로 참가, 문제 진행 중 들어오면 관전
  const lateOver = await connect(ROOM, { role: "player", name: "AfterGame" });
  const meOver = lateOver.log.find((m) => m.type === "welcome").players.find((p) => p.id === lateOver.id);
  check("game_over 중 입장 → 관전이 아니라 생존 상태로 입장", meOver.alive === true);
  send(admin, { type: "admin_start_game", quizzes: [quizzes[0]] });
  await sleep(500);
  const lateMid = await connect(ROOM, { role: "player", name: "MidGame" });
  const meMid = lateMid.log.find((m) => m.type === "welcome").players.find((p) => p.id === lateMid.id);
  check("문제 진행 중 입장 → 관전으로 입장", meMid.alive === false);
  for (const x of [admin, display, a, b, c, lateOver, lateMid]) x.ws.close();
}

// ───────────── 2. 정원 100명 ─────────────
{
  const ROOM = `full-${Date.now()}`;
  const players = [];
  for (let i = 0; i < 100; i += 20) {
    players.push(...(await Promise.all(Array.from({ length: 20 }, (_, k) => connect(ROOM, { role: "player", name: `P${i + k}` })))));
  }
  check("참가자 100명 접속", players.filter((p) => p.id).length === 100);
  const extra = await connect(ROOM, { role: "player", name: "Late" });
  check("101번째 참가자 → 4009 로 거절", extra.closeCode === 4009 && !extra.id, `close=${extra.closeCode}`);
  const display = await connect(ROOM, { role: "display" });
  check("송출 화면은 정원과 무관하게 접속", !!display.id);
  players[0].ws.close();
  await sleep(200);
  const again = await connect(ROOM, { role: "player", name: "Retry" });
  check("한 명이 나가면 다시 입장 가능", !!again.id);
  for (const x of [...players, display, again]) x.ws.close();
}

console.log(failed === 0 ? "✅ PASS" : `❌ FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
