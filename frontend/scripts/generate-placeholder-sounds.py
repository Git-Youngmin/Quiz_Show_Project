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

# ── BGM: 대기 (잔잔한 코드 패드, 8초 루프) ──
bgm = np.zeros(int(SR * 8))
for i, chord in enumerate([[261.6, 329.6, 392.0], [220.0, 261.6, 329.6], [174.6, 220.0, 261.6], [196.0, 246.9, 293.7]]):
    for f in chord:
        place(bgm, tone(f, 2.0, a=0.3, r=0.5) * 0.25, i * 2)
for k in range(16):  # 가벼운 아르페지오
    place(bgm, tone([523.3, 659.3, 784.0, 659.3][k % 4], 0.25, a=0.005, r=0.2) * 0.12, k * 0.5)
save("bgm_waiting", bgm)

# ── BGM: 긴장 (140bpm 킥 + 하이햇 + 베이스, 약 3.43초 = 2마디 루프) ──
beat = 60 / 140
bars = np.zeros(int(SR * beat * 8))
for i in range(8):
    place(bars, kick(), i * beat)
    place(bars, hat(), i * beat + beat / 2)
    place(bars, tone([55, 55, 65.4, 49][i // 2] * 2, beat * 0.9, "saw", 0.005, 0.05) * 0.25, i * beat)
for i in range(16):  # 긴장감 있는 반음 신스
    place(bars, tone(440 if i % 2 == 0 else 466.2, beat / 2 * 0.8, "square", 0.002, 0.03) * 0.05, i * beat / 2)
save("bgm_tension", bars)

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
