// 게임 루프 테스트: `npm run dev` 후 `npm run test:game`
// Alice 는 O 구역(x<0), Bob 은 X 구역(x>0) 에 서 있고 정답이 O → Bob 탈락 → Alice 우승(game_over)
// + 차단벽 시각, reveal 중 순간이동(구역 lock) 무시 확인
const BASE = process.env.WS_BASE ?? "ws://127.0.0.1:8787";
const ROOM = `game-${Date.now()}`;
const url = (q) => `${BASE}/api/rooms/${ROOM}/ws?${new URLSearchParams(q)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(label, q) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url(q));
    const c = { ws, log: [], selfId: null };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      c.log.push(m);
      if (m.type === "welcome") c.selfId = m.selfId;
      if (label === "display" && m.type === "game_state")
        console.log(`[${label}] phase=${m.game.phase} answer=${m.game.answer} dropped=${m.game.droppedZones.join("")} q="${m.game.question ?? ""}"`);
      if (m.type === "players_eliminated") console.log(`[${label}] eliminated`, m.ids);
      if (m.type === "error") console.log(`[${label}] error: ${m.message}`);
    };
    ws.onopen = () => resolve(c);
    ws.onerror = () => reject(new Error(label));
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));

// 관리자는 방을 먼저 만들고(비밀번호 설정) 그 비밀번호로 접속
const HTTP = BASE.replace(/^ws/, "http");
const created = await fetch(`${HTTP}/api/rooms`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ roomId: ROOM, adminPassword: "test-pass" }),
});
if (created.status !== 201) throw new Error(`room create failed: ${created.status}`);
const display = await connect("display", { role: "display" });
const admin = await connect("admin", { role: "admin", password: "test-pass" });
const alice = await connect("alice", { role: "player", name: "Alice" });
const bob = await connect("bob", { role: "player", name: "Bob" });
await sleep(200);

send(bob, { type: "admin_start_game", quizzes: [{ question: "hack", answer: "X", timeLimitSec: 3 }] }); // 권한 없음
send(admin, { type: "admin_start_game", quizzes: [{ question: "지구는 둥글다?", answer: "O", timeLimitSec: 3 }] });
await sleep(200);
// 게임 시작 시 전원이 새 스폰 위치로 옮겨지므로(round_reset) 그 뒤에 각자 구역으로 이동
send(alice, { type: "move", p: [-5, 0.8, 0], r: 0 });
send(bob, { type: "move", p: [5, 0.8, 0], r: 0 });
send(admin, { type: "admin_start_game", quizzes: [{ question: "중복", answer: "O", timeLimitSec: 3 }] }); // 진행 중 거부

// question_active 진입 확인 후, reveal 시작 직후 Bob 이 O 구역으로 순간이동 시도 (무시되어야 함)
await sleep(3000 + 3000 + 400);
send(bob, { type: "move", p: [-5, 0.8, 0], r: 0 });

// countdown 3s + question 3s + reveal 3s + elimination 4.5s ≈ 13.5s
await sleep(14500 - 6400);

const phases = display.log.filter((m) => m.type === "game_state").map((m) => m.game.phase);
const elim = display.log.find((m) => m.type === "players_eliminated");
const answerLeakedEarly = alice.log.some(
  (m) => m.type === "game_state" && ["countdown", "question_active"].includes(m.game.phase) && m.game.answer,
);
console.log("phases:", phases.join(" → "));
const qa = display.log.find((m) => m.type === "game_state" && m.game.phase === "question_active")?.game;
const barrierOk = qa && qa.barrierRaisesAt === qa.phaseEndsAt - 1500;
const over = display.log.findLast((m) => m.type === "game_state")?.game;
const winnerOk = over?.phase === "game_over" && over.winnerId === alice.selfId;
console.log(`barrierRaisesAt ok=${barrierOk}, winner=alice ${winnerOk}`);
send(admin, { type: "admin_next_question" }); // game_over 에서는 다음 문제 불가 → 거부
await sleep(200);

send(admin, { type: "admin_reset" });
await sleep(300);
const reset = display.log.findLast((m) => m.type === "round_reset");

const ok =
  phases.join(",") === "countdown,question_active,reveal,elimination,game_over" &&
  barrierOk && winnerOk &&
  elim?.ids.length === 1 && elim.ids[0] === bob.selfId &&
  !answerLeakedEarly &&
  reset?.players.every((p) => p.alive);
console.log(`bob eliminated=${elim?.ids[0] === bob.selfId}, answerLeak=${answerLeakedEarly}, resetAllAlive=${reset?.players.every((p) => p.alive)}`);
console.log(ok ? "✅ PASS (OX)" : "❌ FAIL (OX)");

// ───────────── 4지선다: 4명이 A/B/C/D 구역에, 정답 B → 3명 탈락, B 구역 플레이어 우승 ─────────────
const carol = await connect("carol", { role: "player", name: "Carol" });
const dave = await connect("dave", { role: "player", name: "Dave" });
await sleep(200);
const quad = { alice: [-5, 0.8, -5], bob: [5, 0.8, -5], carol: [-5, 0.8, 5], dave: [5, 0.8, 5] }; // A B C D
const moveToQuads = () => {
  for (const [c, p] of [[alice, quad.alice], [bob, quad.bob], [carol, quad.carol], [dave, quad.dave]]) send(c, { type: "move", p, r: 0 });
};
send(admin, { type: "admin_start_game", quizzes: [{ quizType: "MULTIPLE", question: "보기 누락", answer: "B", choices: ["1", "2", ""], timeLimitSec: 3 }] }); // 거부
send(admin, { type: "admin_start_game", quizzes: [{ quizType: "MULTIPLE", question: "정답 X 는 4지선다에서 불가", answer: "X", choices: ["1", "2", "3", "4"], timeLimitSec: 3 }] }); // 거부
await sleep(100);
const mark = display.log.length;
send(admin, { type: "admin_start_game", quizzes: [{ quizType: "MULTIPLE", question: "태양계에서 가장 큰 행성은?",
  answer: "B", choices: ["화성", "목성", "토성", "지구"], timeLimitSec: 3 }] });
await sleep(150);
moveToQuads(); // 게임 시작(round_reset) 후 각자 구역으로
await sleep(14500);
const mLog = display.log.slice(mark);
const mStates = mLog.filter((m) => m.type === "game_state").map((m) => m.game);
const mPhases = mStates.map((g) => g.phase).join(",");
const mElim = mLog.find((m) => m.type === "players_eliminated");
const mElimNames = (mElim?.ids ?? []).map((id) => [alice, bob, carol, dave].find((c) => c.selfId === id)?.ws && ({ [alice.selfId]: "alice", [bob.selfId]: "bob", [carol.selfId]: "carol", [dave.selfId]: "dave" })[id]).sort();
const dropped = mStates.find((g) => g.phase === "elimination")?.droppedZones.join("");
const mOver = mStates.at(-1);
const choicesOk = mStates[0]?.quizType === "MULTIPLE" && mStates[0]?.choices?.[1] === "목성" && mStates[0]?.answer === null;
console.log("multiple phases:", mPhases.replaceAll(",", " → "));
console.log(`choices ok=${choicesOk}, eliminated=${mElimNames.join(",")}, droppedZones=${dropped}, winner=bob ${mOver?.winnerId === bob.selfId}`);
const ok2 =
  mPhases === "countdown,question_active,reveal,elimination,game_over" &&
  choicesOk && mElimNames.join(",") === "alice,carol,dave" && dropped === "ACD" && mOver?.winnerId === bob.selfId;
console.log(ok2 ? "✅ PASS (MULTIPLE)" : "❌ FAIL (MULTIPLE)");

for (const c of [display, admin, alice, bob, carol, dave]) c.ws.close();
process.exit(ok && ok2 ? 0 : 1);
