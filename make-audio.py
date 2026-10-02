#!/usr/bin/env python3
"""UNO trailer 音频生成器：背景音乐 + 音效。输出 /tmp/uno_audio/"""
import math, random, array, wave, os

SR = 44100
OUT = '/tmp/uno_audio'
os.makedirs(OUT, exist_ok=True)

def wav(path, samples, stereo=False):
    nch = 2 if stereo else 1
    if stereo:
        a = array.array('h')
        for l, r in samples:
            a.append(int(max(-1, min(1, l)) * 32767))
            a.append(int(max(-1, min(1, r)) * 32767))
    else:
        a = array.array('h', (int(max(-1, min(1, s)) * 32767) for s in samples))
    with wave.open(path, 'w') as w:
        w.setnchannels(nch); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(a.tobytes())

def tone(freq, dur, vol=1.0, attack=0.01, decay=8.0, harmonics=((1, 1.0), (2, 0.22), (3, 0.10))):
    n = int(SR * dur); out = [0.0] * n
    for i in range(n):
        t = i / SR
        env = min(1.0, t / attack) if attack > 0 else 1.0
        env *= math.exp(-decay * t)
        v = 0.0
        for h, a in harmonics:
            v += a * math.sin(2 * math.pi * freq * h * t)
        out[i] = v * vol * env
    return out

def noise(n, vol=1.0):
    return [random.uniform(-1, 1) * vol for _ in range(n)]

# ============ 背景音乐 ============
def make_music():
    seq = [
        ([261.63, 329.63, 392.00], 65.41),   # C
        ([220.00, 261.63, 329.63], 55.00),   # Am
        ([174.61, 220.00, 261.63], 87.31),   # F
        ([196.00, 246.94, 293.66], 98.00),   # G
    ]
    pat = [0, 1, 2, 1, 0, 2, 1, 2]
    STEP = 0.3
    total = int(SR * 30)
    L = [0.0] * total
    chord_i = 0
    for slot in range(int(30 / STEP)):
        chord = seq[chord_i]
        n = int(STEP * SR)
        st = slot * n
        note = chord[0][pat[slot % 8]]
        for i, v in enumerate(tone(note, STEP, 0.16, decay=9)):
            if st + i < total: L[st + i] += v
        if slot % 8 == 0:
            bass = tone(chord[1], STEP * 8, 0.12, attack=0.05, decay=1.4, harmonics=((1, 1), (2, 0.12)))
            for i, v in enumerate(bass):
                if st + i < total: L[st + i] += v
        if slot % 8 == 7:
            chord_i = (chord_i + 1) % 4
    d = int(SR * 0.0005)  # 右声道 0.5ms 延迟制造宽度
    R = [L[i - d] if i >= d else 0.0 for i in range(total)]
    fade_in = int(SR * 1.5); fade_out = int(SR * 2.5)
    for i in range(total):
        g = min(1.0, i / fade_in) * min(1.0, (total - i) / fade_out)
        L[i] *= g; R[i] *= g
    wav(f'{OUT}/music.wav', zip(L, R), stereo=True)
    print('music.wav done')

# ============ 音效 ============
def sfx_chime_bell():
    a = tone(659.26, 0.9, 0.5, decay=5, harmonics=((1, 1), (2, 0.3), (4, 0.12)))
    b = tone(880.00, 0.9, 0.4, decay=5, harmonics=((1, 1), (2, 0.3), (4, 0.12)))
    return [a[i] + (b[i] if i < len(b) else 0) for i in range(len(a))]

def sfx_swish(dur=0.35, vol=0.32):
    n = int(SR * dur); x = noise(n, vol)
    out = [0.0] * n
    prev = 0.0
    for i in range(n):
        hp = x[i] - prev; prev = x[i]
        env = min(1.0, i / (n * 0.08)) * max(0.0, 1 - i / n)
        out[i] = hp * env * 2.0
    return out

def sfx_whoosh():
    n = int(SR * 0.55); x = noise(n, 0.4); out = [0.0] * n; prev = 0.0
    for i in range(n):
        hp = x[i] - prev; prev = x[i]
        env = min(1.0, i / (n * 0.1)) * max(0.0, 1 - i / n)
        out[i] = hp * env * 3.0
    return out

def sfx_slap(vol=0.7):
    n = int(SR * 0.18)
    thump = tone(110, 0.18, 0.55, attack=0.001, decay=22, harmonics=((1, 1), (2, 0.2)))
    burst = noise(n, vol)
    return [thump[i] + burst[i] * math.exp(-i / n * 30) for i in range(n)]

def sfx_magic():
    out = []
    for f in (523.25, 659.26, 783.99, 1046.5):
        out += tone(f, 0.14, 0.4, decay=12, harmonics=((1, 1), (2, 0.25), (3, 0.1)))
        out += [0.0] * int(SR * 0.015)
    return out

def sfx_thunder():
    crack = noise(int(SR * 0.05), 0.9)
    n = int(SR * 2.2); rumble = [0.0] * n; acc = 0.0
    for i in range(n):
        acc = acc * 0.985 + random.uniform(-1, 1) * 0.5
        env = math.exp(-i / n * 4)
        rumble[i] = acc * env * 3.5
    return crack + rumble

def sfx_dice_roll():
    out = [0.0] * int(SR * 0.75)
    random.seed(7)
    for _ in range(16):
        t0 = int(random.uniform(0, 0.6) * SR)
        click = noise(int(SR * 0.012), 0.5) + tone(1400, 0.012, 0.4, decay=60)
        for i, v in enumerate(click):
            if t0 + i < len(out): out[t0 + i] += v
    return out

def sfx_dice_land():
    a = tone(80, 0.22, 0.6, attack=0.001, decay=16)
    b = noise(int(SR * 0.22), 0.25)
    return [a[i] + b[i] * math.exp(-i / (SR * 0.22) * 30) for i in range(len(a))]

def sfx_uno():
    a = tone(659.26, 0.8, 0.5, decay=6, harmonics=((1, 1), (2, 0.3), (4, 0.15)))
    b = tone(880.00, 0.8, 0.5, decay=6, harmonics=((1, 1), (2, 0.3), (4, 0.15)))
    out = [0.0] * int(SR * 0.8)
    for i in range(len(a)):
        out[i] = a[i]
        if i >= int(SR * 0.06): out[i] += b[i - int(SR * 0.06)]
    return out

def sfx_fanfare():
    out = []
    for f in (523.25, 659.26, 783.99, 1046.5):
        out += tone(f, 0.2, 0.5, decay=7, harmonics=((1, 1), (2, 0.18), (3, 0.08)))
        out += [0.0] * int(SR * 0.02)
    return out

def sfx_click():
    return tone(1000, 0.03, 0.3, decay=60)

if __name__ == '__main__':
    make_music()
    wav(f'{OUT}/sfx_title.wav', sfx_chime_bell())
    wav(f'{OUT}/sfx_deal.wav', sfx_swish())
    wav(f'{OUT}/sfx_whoosh.wav', sfx_whoosh())
    wav(f'{OUT}/sfx_slap.wav', sfx_slap())
    wav(f'{OUT}/sfx_slap_lite.wav', sfx_slap(0.5))
    wav(f'{OUT}/sfx_magic.wav', sfx_magic())
    wav(f'{OUT}/sfx_thunder.wav', sfx_thunder())
    wav(f'{OUT}/sfx_dice_roll.wav', sfx_dice_roll())
    wav(f'{OUT}/sfx_dice_land.wav', sfx_dice_land())
    wav(f'{OUT}/sfx_uno.wav', sfx_uno())
    wav(f'{OUT}/sfx_fanfare.wav', sfx_fanfare())
    wav(f'{OUT}/sfx_click.wav', sfx_click())
    print('ALL_SFX_DONE')
