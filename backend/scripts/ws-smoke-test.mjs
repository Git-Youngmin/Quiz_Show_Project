// 로컬 스모크 테스트: `npm run dev` 실행 후 다른 터미널에서 `npm run test:ws`
// 플레이어 2명 + display 1명이 접속 → 플레이어가 움직이면 snapshot 이 브로드캐스트되는지 확인
const BASE = process.env.WS_BASE ?? "ws://127.0.0.1:8787";
const ROOM = process.env.ROOM ?? "test-room";

const url = (q) => `${BASE}/api/rooms/${ROOM}/ws?${new URLSearchParams(q)}`;

function connect(label, q) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url(q));
    const log = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      log.push(msg);
      console.log(`[${label}] ←`, msg.type, msg.type === "snapshot" ? JSON.stringify(msg.players) : "");
    };
    ws.onopen = () => resolve({ ws, log });
    ws.onerror = (e) => reject(new Error(`${label} 연결 실패: ${e.message ?? e}`));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const display = await connect("display", { role: "display" });
const alice = await connect("alice", { role: "player", name: "Alice" });
const bob = await connect("bob", { role: "player", name: "Bob" });
await sleep(200);

for (let i = 0; i < 5; i++) {
  alice.ws.send(JSON.stringify({ type: "move", p: [i, 1, 0], r: i * 0.1 }));
  bob.ws.send(JSON.stringify({ type: "move", p: [0, 1, -i], r: 0 }));
  await sleep(30);
}
await sleep(300);
bob.ws.close();
await sleep(300);

const snapshots = display.log.filter((m) => m.type === "snapshot");
const left = display.log.some((m) => m.type === "player_left");
const joined = display.log.filter((m) => m.type === "player_joined").length;

console.log(`\nsnapshots=${snapshots.length}, joined=${joined}, left=${left}`);
const ok = snapshots.length > 0 && snapshots.length < 10 && joined === 2 && left;
console.log(ok ? "✅ PASS" : "❌ FAIL");
alice.ws.close();
display.ws.close();
process.exit(ok ? 0 : 1);
