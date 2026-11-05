// 관리자 인증 테스트: 서버를 TRUST_PROXY=1 로 띄운 뒤 `npm run test:auth`
// (실패 횟수 제한은 X-Forwarded-For 로 IP 를 바꿔가며 검증 → 다른 테스트에 영향 없음)
import WebSocket from "ws";

const HTTP = process.env.HTTP_BASE ?? "http://127.0.0.1:8787";
const WS = HTTP.replace(/^http/, "ws");
const ROOM = `auth-${Date.now()}`;
let failed = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failed++;
};

const createRoom = (roomId, adminPassword) =>
  fetch(`${HTTP}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, adminPassword }) })
    .then(async (r) => ({ status: r.status, body: await r.json() }));

/** 관리자 접속 결과: welcome 을 받으면 "welcome", 닫히면 close code */
const adminConnect = (room, password, ip = "10.0.0.1") =>
  new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/api/rooms/${room}/ws?role=admin&password=${encodeURIComponent(password)}`, {
      headers: { "X-Forwarded-For": ip },
    });
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === "welcome") {
        resolve({ result: "welcome", role: m.role });
        ws.close();
      }
    });
    ws.on("close", (code) => resolve({ result: code }));
    ws.on("error", () => {});
  });

check("없는 방에 관리자 접속 → 4004", (await adminConnect(ROOM, "x")).result === 4004);

let r = await createRoom(ROOM, "abc");
check("짧은 비밀번호 → 400", r.status === 400, r.body.error);
r = await createRoom("bad room!", "secret1");
check("잘못된 방 코드 → 400", r.status === 400, r.body.error);
r = await createRoom(ROOM, "secret1");
check("방 생성 → 201", r.status === 201);
r = await createRoom(ROOM, "other-pw");
check("이미 방장이 있는 방 → 409 (비밀번호 덮어쓰기 불가)", r.status === 409, r.body.error);

check("틀린 비밀번호 → 4001", (await adminConnect(ROOM, "wrong")).result === 4001);
const ok = await adminConnect(ROOM, "secret1");
check("맞는 비밀번호 → welcome(role=admin)", ok.result === "welcome" && ok.role === "admin");

// 참가자/송출은 비밀번호 없이 그대로 접속 가능
const player = await new Promise((resolve) => {
  const ws = new WebSocket(`${WS}/api/rooms/${ROOM}/ws?role=player&name=P`);
  ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "welcome") { resolve(m.role); ws.close(); } });
  ws.on("close", (c) => resolve(c));
});
check("참가자는 비밀번호 없이 접속", player === "player");

// 관리자 권한 없는 출제 시도 (player 가 admin 메시지 전송) → 거부
const denied = await new Promise((resolve) => {
  const ws = new WebSocket(`${WS}/api/rooms/${ROOM}/ws?role=player&name=Hacker`);
  ws.on("open", () => ws.send(JSON.stringify({ type: "admin_reset" })));
  ws.on("message", (d) => { const m = JSON.parse(d.toString()); if (m.type === "error") { resolve(m.message); ws.close(); } });
});
check("참가자의 관리자 명령 → Admin only", denied === "Admin only");

// 무차별 대입: 같은 IP 로 10번 실패 → 11번째는 맞는 비밀번호여도 4029
const attackerIp = "10.66.6.6";
for (let i = 0; i < 10; i++) await adminConnect(ROOM, `guess${i}`, attackerIp);
check("10회 실패 후 같은 IP → 4029 (맞는 비밀번호여도 차단)", (await adminConnect(ROOM, "secret1", attackerIp)).result === 4029);
check("다른 IP 는 영향 없음", (await adminConnect(ROOM, "secret1", "10.0.0.2")).result === "welcome");
// X-Forwarded-For 첫 값 위조로 우회 불가 (프록시가 붙인 마지막 값 기준)
check("XFF 첫 값 위조로 우회 불가", (await adminConnect(ROOM, "secret1", `1.2.3.4, ${attackerIp}`)).result === 4029);

console.log(failed === 0 ? "✅ PASS" : `❌ FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
