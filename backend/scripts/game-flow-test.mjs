// 게임 루프 테스트: `npm run dev` 후 `npm run test:game`
// Alice 는 O 구역(x<0), Bob 은 X 구역(x>0) 에 서 있고 정답이 O → Bob 탈락 확인
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
        console.log(`[${label}] phase=${m.game.phase} answer=${m.game.answer} dropped=${m.game.droppedZone} q="${m.game.question ?? ""}"`);
      if (m.type === "players_eliminated") console.log(`[${label}] eliminated`, m.ids);
      if (m.type === "error") console.log(`[${label}] error: ${m.message}`);
    };
    ws.onopen = () => resolve(c);
    ws.onerror = () => reject(new Error(label));
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));

const display = await connect("display", { role: "display" });
const admin = await connect("admin", { role: "admin" });
const alice = await connect("alice", { role: "player", name: "Alice" });
const bob = await connect("bob", { role: "player", name: "Bob" });
await sleep(200);
send(alice, { type: "move", p: [-5, 0.8, 0], r: 0 });
send(bob, { type: "move", p: [5, 0.8, 0], r: 0 });

send(bob, { type: "admin_start_question", question: "hack", answer: "X", timeLimitSec: 3 }); // 권한 없음
send(admin, { type: "admin_start_question", question: "지구는 둥글다?", answer: "O", timeLimitSec: 3 });
await sleep(200);
send(admin, { type: "admin_start_question", question: "중복", answer: "O", timeLimitSec: 3 }); // 진행 중 거부

// countdown 3s + question 3s + reveal 3s + elimination 4.5s ≈ 13.5s
await sleep(14500);

const phases = display.log.filter((m) => m.type === "game_state").map((m) => m.game.phase);
const elim = display.log.find((m) => m.type === "players_eliminated");
const answerLeakedEarly = alice.log.some(
  (m) => m.type === "game_state" && ["countdown", "question_active"].includes(m.game.phase) && m.game.answer,
);
console.log("phases:", phases.join(" → "));

send(admin, { type: "admin_reset" });
await sleep(300);
const reset = display.log.find((m) => m.type === "round_reset");

const ok =
  phases.join(",") === "countdown,question_active,reveal,elimination,waiting" &&
  elim?.ids.length === 1 && elim.ids[0] === bob.selfId &&
  !answerLeakedEarly &&
  reset?.players.every((p) => p.alive);
console.log(`bob eliminated=${elim?.ids[0] === bob.selfId}, answerLeak=${answerLeakedEarly}, resetAllAlive=${reset?.players.every((p) => p.alive)}`);
console.log(ok ? "✅ PASS" : "❌ FAIL");
for (const c of [display, admin, alice, bob]) c.ws.close();
process.exit(ok ? 0 : 1);
