// 방해물 투척 테스트: 백엔드 실행 후 `npm run test:throw`
const BASE = process.env.WS_BASE ?? "ws://127.0.0.1:8787";
const HTTP = BASE.replace(/^ws/, "http");
const ROOM = `throw-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`); if (!ok) failed++; };

const PAD = { x: -22.8, z: 0 }; // shared THROW_PADS[1]
const ZONE_Y = 3.8;

function connect(q) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE}/api/rooms/${ROOM}/ws?${new URLSearchParams(q)}`);
    const c = { ws, log: [], id: null };
    ws.onmessage = (e) => { const m = JSON.parse(e.data); c.log.push(m); if (m.type === "welcome") { c.id = m.selfId; resolve(c); } };
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
const items = (c) => c.log.filter((m) => m.type === "item_spawned").map((m) => m.item);
const cooldowns = (c) => c.log.filter((m) => m.type === "throw_cooldown");

await fetch(`${HTTP}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId: ROOM, adminPassword: "pw-1234" }) });
const admin = await connect({ role: "admin", password: "pw-1234" });
const display = await connect({ role: "display" });
const alice = await connect({ role: "player", name: "Alice" });
const bob = await connect({ role: "player", name: "Bob" });
const carol = await connect({ role: "player", name: "Carol" });
send(alice, { type: "move", p: [-5, 0.8, 0], r: 0 });

// 생존자는 던질 수 없음
send(bob, { type: "move", p: [PAD.x, ZONE_Y, PAD.z], r: 0 });
await sleep(150);
send(bob, { type: "throw_item", pad: 1 });
await sleep(150);
check("생존자의 투척 요청 무시", items(display).length === 0);

// 문제 진행 중 Bob, Carol 이 떨어져 탈락 → 관전석 발판으로 이동
send(admin, { type: "admin_start_question", quizType: "OX", question: "Q", answer: "O", timeLimitSec: 20 });
await sleep(3300); // countdown 끝
send(bob, { type: "fell" }); send(carol, { type: "fell" });
await sleep(150);
send(bob, { type: "move", p: [PAD.x + 0.3, ZONE_Y, PAD.z - 0.2], r: 0 });
send(carol, { type: "move", p: [PAD.x, ZONE_Y, 8], r: 0 }); // pad 2
await sleep(150);

send(bob, { type: "throw_item", pad: 1 });
await sleep(150);
const first = items(display)[0];
check("탈락자가 발판 위에서 투척 → item_spawned 브로드캐스트", !!first && items(alice).length === 1 && items(bob).length === 1,
  first && `kind=${first.kind} origin=[${first.origin.map((v) => v.toFixed(1))}] speed=${first.speed.toFixed(1)}`);

// 포물선 검증: 발사 후 비행 시간 동안 중력만 받으면 보드 위(±15) 높이 ~0.6 에 도달해야 함
if (first) {
  const v = first.direction.map((d) => d * first.speed);
  let hit = null;
  for (let t = 0; t < 3; t += 0.01) {
    const y = first.origin[1] + v[1] * t - 0.5 * 9.81 * t * t;
    if (t > 0.3 && y <= 0.6) { hit = [first.origin[0] + v[0] * t, first.origin[2] + v[2] * t, t]; break; }
  }
  check("포물선 착지 지점이 보드 위", !!hit && Math.abs(hit[0]) < 15 && Math.abs(hit[1]) < 15,
    hit && `x=${hit[0].toFixed(1)} z=${hit[1].toFixed(1)} t=${hit[2].toFixed(2)}s`);
  check("발사 위치가 관전석 유리벽 바깥(보드 쪽) + 벽보다 높음", first.origin[0] > -20.85 + 0.55 && first.origin[1] > 3 + 4 + 0.55);
}

// 같은 플레이어 즉시 재투척 → 쿨타임
send(bob, { type: "throw_item", pad: 1 });
await sleep(150);
const cd = cooldowns(bob).at(-1);
check("유저당 쿨타임 2초", items(display).length === 1 && !!cd && cd.retryInMs > 1500 && cd.retryInMs <= 2000, cd && `retryInMs=${cd.retryInMs}`);

// 방 전체 쿨타임: Bob 투척 직후(0.5초 이내) Carol 투척 → 거부, 0.5초 뒤 → 허용
send(bob, { type: "move", p: [PAD.x, ZONE_Y, PAD.z], r: 0 });
await sleep(100);
// 위에서 이미 ~300ms 지남 → 아직 방 쿨타임 안
send(carol, { type: "throw_item", pad: 2 });
await sleep(100);
check("방 전체 쿨타임 0.5초 (직후 다른 유저 거부)", items(display).length === 1 && cooldowns(carol).length === 1);
await sleep(400);
send(carol, { type: "throw_item", pad: 2 });
await sleep(150);
check("방 쿨타임 경과 후 다른 유저 허용", items(display).length === 2 && items(display)[1].throwerId === carol.id);

// 발판이 아닌 곳 / 잘못된 발판 번호 → 무시
await sleep(2000);
send(bob, { type: "move", p: [-35, ZONE_Y, 0], r: 0 });
await sleep(150);
send(bob, { type: "throw_item", pad: 1 });
send(bob, { type: "throw_item", pad: 7 });
await sleep(200);
check("발판 밖 위치 / 잘못된 발판 번호 무시", items(display).length === 2);
// 다른 발판 번호를 대면서 위치는 pad 1 인 경우도 무시
send(bob, { type: "move", p: [PAD.x, ZONE_Y, PAD.z], r: 0 });
await sleep(150);
send(bob, { type: "throw_item", pad: 0 });
await sleep(150);
check("밟지 않은 발판 번호로 요청 → 무시", items(display).length === 2);
send(bob, { type: "throw_item", pad: 1 });
await sleep(150);
check("쿨타임 후 정상 투척", items(display).length === 3);

console.log(failed === 0 ? "✅ PASS" : `❌ FAIL (${failed})`);
for (const c of [admin, display, alice, bob, carol]) c.ws.close();
process.exit(failed === 0 ? 0 : 1);
