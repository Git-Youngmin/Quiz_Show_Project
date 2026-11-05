"""
임시(placeholder) 사운드 생성기 — 실제 음원으로 교체하기 전까지 게임에서 소리가 나도록 합성.
필요: python3 + numpy + ffmpeg
사용: python3 frontend/scripts/generate-placeholder-sounds.py
결과: frontend/public/sounds/*.mp3 (같은 파일명으로 덮어쓰면 교체 완료)
"""
import os
import subprocess
import tempfile
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "sounds")
rng = np.random.default_rng(7)


def t(sec):
    return np.arange(int(SR * sec)) / SR


def env(n, a=0.005, r=0.1):
    """attack / release 엔벨로프"""
    e = np.ones(n)
    na, nr = min(n, int(SR * a)), min(n, int(SR * r))
    if na: e[:na] = np.linspace(0, 1, na)
    if nr: e[-nr:] *= np.linspace(1, 0, nr)
    return e


def tone(freq, sec, kind="sine", a=0.005, r=0.1):
    x = t(sec)
    ph = 2 * np.pi * np.cumsum(np.broadcast_to(freq, x.shape)) / SR
    if kind == "saw":
        w = 2 * ((ph / (2 * np.pi)) % 1) - 1
    elif kind == "square":
        w = np.sign(np.sin(ph))
    else:
        w = np.sin(ph)
    return w * env(len(x), a, r)


def place(buf, clip, at):
    i = int(at * SR)
    j = min(len(buf), i + len(clip))
    buf[i:j] += clip[: j - i]


def save(name, x, bitrate="96k"):
    x = x / max(1e-9, np.max(np.abs(x))) * 0.9
    pcm = (x * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    with wave.open(tmp, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    out = os.path.join(OUT, f"{name}.mp3")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-b:a", bitrate, out], check=True)
    os.remove(tmp)
    print(f"{out}  {os.path.getsize(out) // 1024}KB")


def kick():
    x = t(0.25)
    return np.sin(2 * np.pi * np.cumsum(50 + 120 * np.exp(-x * 30)) / SR) * np.exp(-x * 12)


def hat(sec=0.05):
    return rng.normal(0, 1, int(SR * sec)) * np.exp(-t(sec) * 80) * 0.3


os.makedirs(OUT, exist_ok=True)

# ───────────── BGM (신나는 칩튠 스타일) ─────────────
mrng = np.random.default_rng(42)  # 음악 전용 난수 (효과음 결과가 바뀌지 않도록 분리)


def note(name):
    """'C4' → 주파수"""
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    return 440.0 * 2 ** ((names[name[:-1]] + 12 * (int(name[-1]) + 1) - 69) / 12)


def lowpass(x, a=0.15):
    """1차 저역 통과 (베이스를 둥글게)"""
    y = np.zeros_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += a * (v - acc)
        y[i] = acc
    return y


def pluck(freq, sec, kind="square", decay=8.0):
    x = t(sec)
    return tone(freq, sec, kind, 0.002, 0.03) * np.exp(-x * decay)


def snare():
    n = mrng.normal(0, 1, int(SR * 0.18)) * np.exp(-t(0.18) * 22)
    return n * 0.5 + tone(190, 0.18, a=0.001, r=0.1) * np.exp(-t(0.18) * 30) * 0.4


def clap():
    c = np.zeros(int(SR * 0.2))
    for d in (0, 0.012, 0.024):
        place(c, mrng.normal(0, 1, int(SR * 0.15)) * np.exp(-t(0.15) * 35) * 0.5, d)
    return c


def mhat(sec=0.04, amp=0.22):
    return mrng.normal(0, 1, int(SR * sec)) * np.exp(-t(sec) * 90) * amp


def master(x):
    """살짝 눌러 주는 리미터 (펀치감)"""
    return np.tanh(x * 1.6) / np.tanh(1.6)


# ── 대기: 120bpm, C–G–Am–F 8마디 (16초), 밝고 통통 튀는 느낌 ──
bpm = 120
beat = 60 / bpm
bars = 8
song = np.zeros(int(SR * beat * 4 * bars))
prog = [["C3", "C4", "E4", "G4"], ["G2", "B3", "D4", "G4"], ["A2", "A3", "C4", "E4"], ["F2", "A3", "C4", "F4"]]
for bar in range(bars):
    root, *triad = prog[bar % 4]
    t0 = bar * 4 * beat
    for b in range(4):
        tb = t0 + b * beat
        place(song, kick() * 0.9, tb) if b in (0, 2) else place(song, clap() * 0.8, tb)
        place(song, mhat(), tb + beat / 2)
        place(song, mhat(amp=0.12), tb)
        # 통통 튀는 옥타브 베이스 (8분음표)
        for k, mul in enumerate((1, 2)):
            place(song, lowpass(tone(note(root) * mul, beat / 2 * 0.9, "saw", 0.003, 0.05)) * 0.55, tb + k * beat / 2)
    # 반짝이는 코드 스탭 (엇박)
    for b in (0.5, 1.5, 2.5, 3.5):
        for nm in triad:
            place(song, pluck(note(nm), beat * 0.4, "square", 12) * 0.07, t0 + b * beat)
# 경쾌한 멜로디 훅 (C 장조 펜타토닉, 8분음표 단위 — None = 쉼표)
hook = [
    "E5", "G5", "A5", "G5", "E5", None, "C5", "D5",  "D5", "G5", "B5", "A5", "G5", None, "D5", None,
    "C5", "E5", "A5", "G5", "E5", "C5", "E5", None,  "F5", "A5", "C6", "A5", "G5", "F5", "E5", None,
]
for rep in range(2):
    for i, nm in enumerate(hook):
        if nm:
            place(song, pluck(note(nm), beat / 2 * 0.95, "square", 6) * 0.16, rep * 16 * beat + i * beat / 2)
save("bgm_waiting", master(song), "128k")

# ── 긴장: 150bpm, Am–F–G–E 4마디, 16분음표 베이스가 몰아침 ──
bpm = 150
beat = 60 / bpm
bars = 4
song = np.zeros(int(SR * beat * 4 * bars))
prog = [["A2", "A4", "C5", "E5"], ["F2", "F4", "A4", "C5"], ["G2", "G4", "B4", "D5"], ["E2", "E4", "G#4", "B4"]]
for bar in range(bars):
    root, *triad = prog[bar]
    t0 = bar * 4 * beat
    for b in range(4):
        tb = t0 + b * beat
        place(song, kick(), tb)  # 4-on-the-floor
        if b in (1, 3):
            place(song, snare() * 0.9, tb)
        for k in range(4):  # 16분음표 하이햇 + 베이스
            place(song, mhat(0.03, 0.18 if k % 2 else 0.1), tb + k * beat / 4)
            place(song, lowpass(tone(note(root) * (2 if k == 2 else 1), beat / 4 * 0.85, "saw", 0.002, 0.03), 0.2) * 0.5, tb + k * beat / 4)
    # 올라가는 아르페지오 (16분음표)
    arp = triad + [triad[1]]
    for k in range(16):
        nm = arp[k % 4]
        place(song, pluck(note(nm), beat / 4 * 0.9, "square", 14) * 0.09, t0 + k * beat / 4)
# 마지막 마디 끝에 긴장감 있는 스네어 롤
for k in range(8):
    place(song, snare() * (0.3 + k * 0.08), (bars * 4 - 1) * beat + k * beat / 8)
save("bgm_tension", master(song), "128k")

# 이전 버전과 같은 만큼 효과음용 난수를 소비 (효과음 파일이 바뀌지 않게)
_ = rng.normal(0, 1, 8 * int(SR * 0.05))

# ── SFX ──
# 우승 팡파르: 도-미-솔 + 높은 도 화음
fan = np.zeros(int(SR * 2.6))
for f, st, d in [(523.3, 0, 0.18), (659.3, 0.18, 0.18), (784.0, 0.36, 0.18),
                 (1046.5, 0.54, 1.8), (659.3, 0.54, 1.8), (784.0, 0.54, 1.8)]:
    place(fan, tone(f, d, "saw", 0.01, 0.25) * 0.4, st)
save("fanfare", fan)
save("jump", tone(np.linspace(380, 900, int(SR * 0.16)), 0.16, "square", 0.002, 0.08) * 0.5)
x = t(1.4)
save("fall", tone(1100 * np.exp(-x * 1.6) * (1 + 0.04 * np.sin(2 * np.pi * 7 * x)), 1.4, "sine", 0.01, 0.3))  # 휘이익~ 하강
# 폭죽 펑: 노이즈 버스트 + 저음 쿵
pop = np.zeros(int(SR * 0.4))
place(pop, rng.normal(0, 1, int(SR * 0.3)) * np.exp(-t(0.3) * 25), 0)
place(pop, tone(180, 0.35, a=0.001, r=0.3) * np.exp(-t(0.35) * 20), 0)
save("pop", pop)
save("tick", tone(1500, 0.05, "sine", 0.001, 0.04))
n = rng.normal(0, 1, int(SR * 0.8))
save("barrier", np.convolve(n, np.ones(40) / 40, mode="same") * np.sin(np.linspace(0, np.pi, len(n))) + tone(np.linspace(120, 480, len(n)), 0.8, "saw", 0.01, 0.2) * 0.3)
# 바닥 붕괴: 저음 럼블 + 쿵
r = rng.normal(0, 1, int(SR * 1.2))
drop = np.convolve(r, np.ones(300) / 300, mode="same") * 6 * np.exp(-t(1.2) * 2.5)
place(drop, kick(), 0)
save("drop", drop)

# 방해물 발사: 짧은 휘익 (상승 노이즈 스윕)
n = rng.normal(0, 1, int(SR * 0.45))
whoosh = np.convolve(n, np.ones(25) / 25, mode="same") * np.sin(np.linspace(0, np.pi, len(n))) ** 2
place(whoosh, tone(np.linspace(300, 900, int(SR * 0.3)), 0.3, "sine", 0.01, 0.15) * 0.25, 0.05)
save("throw", whoosh)

# 방해물에 맞음: 통통 튀는 "뿅" (하강 사인 + 짧은 클릭)
bonk = tone(np.linspace(700, 180, int(SR * 0.25)), 0.25, "sine", 0.001, 0.12)
place(bonk, rng.normal(0, 1, int(SR * 0.01)) * 0.5, 0)
save("bonk", bonk)
