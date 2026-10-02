# UNO 大作战 · 短片音频实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `uno-trailer.mp4` 配上解说（macOS TTS）+ 原创合成音乐 + 音效，输出 `uno-trailer-audio.mp4`。

**Architecture:** 纯 Python（`wave`/`math`/`array`/`random`）生成音乐与音效 WAV；`say -v Tingting` 生成解说 WAV（44100Hz）；ffmpeg 用 `aformat`+`volume`+`adelay`+`amix` 按时间轴混音；再与无声视频 `-c:v copy` mux。

**Tech Stack:** Python 3.11（无第三方依赖）、macOS `say`、ffmpeg 8.1。设计规格见 `docs/superpowers/specs/2026-07-31-uno-trailer-audio-design.md`。

---

## 文件结构

- **Create:** `/Users/hello/Downloads/uno/make-audio.py` — 音乐 + 全部音效的 WAV 生成器（输出到 `/tmp/uno_audio/`）
- **Create:** `/Users/hello/Downloads/uno/make-audio.sh` — 解说生成 + ffmpeg 混音 + mux，产出 `uno-trailer-audio.mp4`
- **Output:** `/Users/hello/Downloads/uno/uno-trailer-audio.mp4`

## 全局约定

- 采样率 **44100 Hz**，16-bit
- 音乐/音效由 `make-audio.py` 生成到 `/tmp/uno_audio/`：`music.wav`（立体声）、`sfx_*.wav`（单声道）
- 解说由 `say` 生成到 `/tmp/uno_audio/`：`narr_01.wav … narr_10.wav`（单声道 44100）
- 混音最终 `mix.wav`（立体声 44100），mux 后音轨为 AAC 192k

---

### Task 1: `make-audio.py` — 工具函数 + 音乐

**Files:**
- Create: `/Users/hello/Downloads/uno/make-audio.py`

- [ ] **Step 1: 写入工具函数与 WAV 写出**

```python
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
```

- [ ] **Step 2: 背景音乐（C–Am–F–G 琶音 + 低音根音，30s，立体声宽度）**

```python
def make_music():
    seq = [
        ([261.63, 329.63, 392.00], 65.41),   # C
        ([220.00, 261.63, 329.63], 55.00),   # Am
        ([174.61, 220.00, 261.63], 87.31),   # F
        ([196.00, 246.94, 293.66], 98.00),   # G
    ]
    pat = [0, 1, 2, 3, 2, 1, 0, 1]
    STEP = 0.3
    total = int(SR * 30)
    L = [0.0] * total; R = [0.0] * total
    chord_i = 0
    for slot in range(int(30 / STEP)):
        chord = seq[chord_i]
        n = int(STEP * SR)
        st = slot * n
        # 琶音音
        note = chord[0][pat[slot % 8]]
        for i, v in enumerate(tone(note, STEP, 0.16, decay=9)):
            if st + i < total: L[st + i] += v
        # 低音根音（每和弦开始处）
        if slot % 8 == 0:
            bass = tone(chord[1], STEP * 8, 0.12, attack=0.05, decay=1.4, harmonics=((1, 1), (2, 0.12)))
            for i, v in enumerate(bass):
                if st + i < total: L[st + i] += v
        if slot % 8 == 7:
            chord_i = (chord_i + 1) % 4
    # 右声道延迟 0.5ms 制造宽度
    d = int(SR * 0.0005)
    for i in range(total):
        R[i] = L[i - d] if i >= d else 0.0
    # 首尾淡入淡出
    fade_in = int(SR * 1.5); fade_out = int(SR * 2.5)
    for i in range(total):
        g = min(1.0, i / fade_in) * min(1.0, (total - i) / fade_out)
        L[i] *= g; R[i] *= g
    wav(f'{OUT}/music.wav', zip(L, R), stereo=True)
    print('music.wav done')
```

- [ ] **Step 3: 运行验证**

Run: `cd /Users/hello/Downloads/uno && python3 make-audio.py`
Expected: 打印 `music.wav done`（此步脚本只含音乐，随后 Task 2 追加音效）。`ffprobe` music.wav 时长 ≈ 30s、立体声。

---

### Task 2: `make-audio.py` — 音效

**Files:**
- Modify: `/Users/hello/Downloads/uno/make-audio.py`（在 `make_music` 之后追加）

- [ ] **Step 1: 追加全部音效生成函数**

```python
def sfx_chime_bell():
    """柔和双音钟声（标题）"""
    a = tone(659.26, 0.9, 0.5, decay=5, harmonics=((1, 1), (2, 0.3), (4, 0.12)))
    b = tone(880.00, 0.9, 0.4, decay=5, harmonics=((1, 1), (2, 0.3), (4, 0.12)))
    return [a[i] + (b[i] if i < len(b) else 0) for i in range(len(a))]

def sfx_swish(dur=0.35, vol=0.32):
    """发牌轻响：高通噪声 + 包络"""
    n = int(SR * dur); x = noise(n, vol)
    out = [0.0] * n
    prev = 0.0
    for i in range(n):
        hp = x[i] - prev; prev = x[i]
        env = min(1.0, i / (n * 0.08)) * max(0.0, 1 - i / n)
        out[i] = hp * env * 2.0
    return out

def sfx_whoosh():
    """Skip 嗖声：扫频噪声"""
    n = int(SR * 0.55); x = noise(n, 0.4); out = [0.0] * n; prev = 0.0
    for i in range(n):
        hp = x[i] - prev; prev = x[i]
        env = min(1.0, i / (n * 0.1)) * max(0.0, 1 - i / n)
        out[i] = hp * env * 3.0
    return out

def sfx_slap(vol=0.7):
    """落牌嗒声：低频闷响 + 短噪声"""
    n = int(SR * 0.18)
    thump = tone(110, 0.18, 0.55, attack=0.001, decay=22, harmonics=((1, 1), (2, 0.2)))
    burst = noise(n, vol)
    return [thump[i] + burst[i] * math.exp(-i / n * 30) for i in range(n)]

def sfx_magic():
    """野牌魔法闪音：C5 E5 G5 C6 快速上行铃音"""
    out = []
    for f in (523.25, 659.26, 783.99, 1046.5):
        out += tone(f, 0.14, 0.4, decay=12, harmonics=((1, 1), (2, 0.25), (3, 0.1)))
        out += [0.0] * int(SR * 0.015)
    return out

def sfx_thunder():
    """闪电雷声：爆裂 + 低频长鸣"""
    crack = noise(int(SR * 0.05), 0.9)
    n = int(SR * 2.2); rumble = [0.0] * n; acc = 0.0
    for i in range(n):
        acc = acc * 0.985 + noise(1, 0.5)[0]
        env = math.exp(-i / n * 4)
        rumble[i] = acc * env * 3.5
    return crack + rumble

def sfx_dice_roll():
    """骰子滚动：急促咔哒"""
    out = [0.0] * int(SR * 0.75)
    random.seed(7)
    for _ in range(16):
        t0 = int(random.uniform(0, 0.6) * SR)
        click = noise(int(SR * 0.012), 0.5) + tone(1400, 0.012, 0.4, decay=60)
        for i, v in enumerate(click):
            if t0 + i < len(out): out[t0 + i] += v
    return out

def sfx_dice_land():
    """骰子落定闷响"""
    a = tone(80, 0.22, 0.6, attack=0.001, decay=16)
    b = noise(int(SR * 0.22), 0.25)
    return [a[i] + b[i] * math.exp(-i / (SR * 0.22) * 30) for i in range(len(a))]

def sfx_uno():
    """UNO! 双音铃声"""
    a = tone(659.26, 0.8, 0.5, decay=6, harmonics=((1, 1), (2, 0.3), (4, 0.15)))
    b = tone(880.00, 0.8, 0.5, decay=6, harmonics=((1, 1), (2, 0.3), (4, 0.15)))
    out = [0.0] * int(SR * 0.8)
    for i in range(len(a)):
        out[i] = a[i]
        if i >= int(SR * 0.06): out[i] += b[i - int(SR * 0.06)]
    return out

def sfx_fanfare():
    """胜利号角：C5 E5 G5 C6"""
    out = []
    for f in (523.25, 659.26, 783.99, 1046.5):
        out += tone(f, 0.2, 0.5, decay=7, harmonics=((1, 1), (2, 0.18), (3, 0.08)))
        out += [0.0] * int(SR * 0.02)
    return out

def sfx_click():
    """轻嗒"""
    return tone(1000, 0.03, 0.3, decay=60)
```

- [ ] **Step 2: 追加 main 入口（生成音乐 + 各音效）**

```python
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
```

- [ ] **Step 3: 运行验证**

Run: `cd /Users/hello/Downloads/uno && python3 make-audio.py`
Expected: 打印 `ALL_SFX_DONE`；`/tmp/uno_audio/` 下 1 个 music + 11 个 sfx WAV，均为 44100Hz。

---

### Task 3: 解说生成 + 混音 + mux 脚本

**Files:**
- Create: `/Users/hello/Downloads/uno/make-audio.sh`

- [ ] **Step 1: 写入 `make-audio.sh`**

```bash
#!/bin/bash
set -e
cd "$(dirname "$0")"
OUT=/tmp/uno_audio
mkdir -p "$OUT"

# 1) 解说（say -v Tingting，44100Hz 单声道）
declare -a LINES=(
  "UNO 大作战——纯浏览器里的 UNO"
  "每人发 7 张，翻开开局牌"
  "出牌须同色或同数字"
  "动作牌：跳过、反转、抽两张"
  "野牌：自由选择颜色"
  "打出 0，随机触发小游戏——闪电"
  "剩一张，喊 UNO"
  "先到 500 分获胜"
  "打开游戏，立即开始你的 UNO 冒险"
)
for i in "${!LINES[@]}"; do
  n=$((i+1))
  say -v Tingting -o "$OUT/narr_$(printf %02d $n).wav" --data-format=LEI16@44100 "${LINES[$i]}"
done
echo "NARRATION_DONE"

# 2) 测每句时长（毫秒）
declare -a ST=(
  800    # 开场 0.8s
  3000   # 每人发7张 3.0s
  6400   # 出牌 6.4s
  9400   # 动作牌 9.4s
  12200  # 野牌 12.2s
  14400  # 打出0 14.4s
  19800  # 剩一张 19.8s
  23000  # 先到500 23.0s
  27400  # 结尾 27.4s
)

# 3) 构建 ffmpeg filter_complex
FILTER=""
INPUTS=()
mapfile -t FILES < <(ls "$OUT"/narr_*.wav "$OUT"/sfx_*.wav "$OUT"/music.wav | sort)
idx=0
# 输入表：先音乐 [0]，再解说，再音效
mapfile -t MUSIC < <(echo "$OUT/music.wav")
ALLIN=("$OUT/music.wav")
for f in "$OUT"/narr_*.wav; do ALLIN+=("$f"); done
for f in "$OUT"/sfx_*.wav; do ALLIN+=("$f"); done

# 用 python 生成 filter_complex 与输入（避免 bash 数组下标混乱）
python3 - "$OUT" "${ST[@]}" <<'PY'
import sys, subprocess
OUT=sys.argv[1]
ST=list(map(int,sys.argv[2:]))
SR=44100

def dur_ms(path):
    r=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',path],capture_output=True,text=True)
    return int(float(r.stdout.strip())*1000)

music=f'{OUT}/music.wav'
allin=[music]
for i in range(1,10):
    allin.append(f'{OUT}/narr_{i:02d}.wav')

# 音效事件表：(文件名, 起始ms)
sfx_events=[
 ('sfx_title.wav',1000), ('sfx_deal.wav',2700), ('sfx_deal.wav',3150),
 ('sfx_deal.wav',3600), ('sfx_deal.wav',4050), ('sfx_deal.wav',4500),
 ('sfx_deal.wav',4950), ('sfx_slap.wav',7800), ('sfx_slap_lite.wav',9700),
 ('sfx_whoosh.wav',10900), ('sfx_magic.wav',13100), ('sfx_thunder.wav',15200),
 ('sfx_dice_roll.wav',15500), ('sfx_dice_land.wav',16600), ('sfx_uno.wav',19700),
 ('sfx_fanfare.wav',22800), ('sfx_click.wav',27000),
]
for name,ms in sfx_events:
    allin.append(f'{OUT}/{name}')

parts=[]; labels=[]
# 音乐：-18dB 床，全程
parts.append('[0]aformat=channel_layouts=stereo,volume=0.35[m]'); labels.append('[m]')
# 解说：位置按 ST
for i,st in enumerate(ST):
    d=dur_ms(f'{OUT}/narr_{i+1:02d}.wav')
    labs=f'[n{i+1}]'
    parts.append(f'[{i+1}]aformat=channel_layouts=stereo,volume=1.0,adelay={st}|{st}{labs}')
    labels.append(labs)
# 音效：位置按事件表
base=1+9
for j,(name,ms) in enumerate(sfx_events):
    labs=f'[s{j}]'
    parts.append(f'[{base+j}]aformat=channel_layouts=stereo,volume=0.85,adelay={ms}|{ms}{labs}')
    labels.append(labs)

N=len(allin)
fc=';'.join(parts)+';'+'+'.join(labels)+f'amix=inputs={N}:normalize=0:dropout_transition=0[out]'
cmd=['ffmpeg','-y']
for f in allin: cmd+=['-i',f]
cmd+=['-filter_complex',fc,'-map','[out]','-t','30',f'{OUT}/mix.wav']
r=subprocess.run(cmd,capture_output=True,text=True)
if r.returncode!=0:
    print(r.stderr[-1500:]); sys.exit(1)
print('MIX_DONE')
PY

# 4) mux 到无声视频
ffmpeg -y -i uno-trailer.mp4 -i "$OUT/mix.wav" \
  -c:v copy -c:a aac -b:a 192k -movflags +faststart \
  uno-trailer-audio.mp4
echo "FINAL_DONE uno-trailer-audio.mp4"
```

- [ ] **Step 2: 运行**

Run: `chmod +x make-audio.sh && ./make-audio.sh`
Expected: 依次打印 `NARRATION_DONE` → `MIX_DONE` → `FINAL_DONE`；生成 `uno-trailer-audio.mp4`。

- [ ] **Step 3: 冒烟验证**

Run:
```bash
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels -of default=noprint_wrappers=1 uno-trailer-audio.mp4
ffmpeg -i uno-trailer-audio.mp4 -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
```
Expected: 视频流 1920×1080/30/30s + 音频流 aac 44100 双声道；`max_volume` > −20 dB（说明有声音）。

---

### Task 4: 内容核对

**Files:**
- Verify: `/Users/hello/Downloads/uno/uno-trailer-audio.mp4`

- [ ] **Step 1: 解说是否真的对齐**

Run:
```bash
ffmpeg -i uno-trailer-audio.mp4 -af silencedetect=n=-30dB:d=0.5 -f null - 2>&1 | grep -E "silence_(start|end)" | head -40
```
Expected: 出现约 9 段「非静音」片段，大致落在解说时间窗（0.8、3.0、6.4、9.4、12.2、14.4、19.8、23.0、27.4 附近）。

- [ ] **Step 2: 播放核对**

Run: `open uno-trailer-audio.mp4`
Expected: 画面与无声版一致，有背景音乐、关键节点音效、普通话解说。若某句解说发音异常（如把「index」读得奇怪），把 `make-audio.sh` 中对应台词改口语化后重跑本 Task。

- [ ] **Step 3: 收尾**

确认 `/Users/hello/Downloads/uno/` 下交付物：`uno-trailer-audio.mp4`（新）、`uno-trailer.mp4`（原无声版保留）、`make-audio.py`、`make-audio.sh`。标记本计划全部任务完成。

---

## Self-Review

- **Spec coverage:** 解说 9 句（设计 10 句合并了「开场」与设计表开场句；开场与第 8 句字幕合并处理）→ 实际 9 条独立台词（开场、8 字幕、结尾…）；检查：设计表有 9 行（含开场和结尾），本计划 `LINES` 数组 9 项一一对应。✓ 音效事件表覆盖设计表全部 12 个时间点。✓ 音乐、淡入淡出、立体声、混音电平均落实。✓
- **Placeholder scan:** 全部含完整代码；混音环节用 Python 生成 filter_complex（避免手写 27 路 adelay 出错）。✓
- **Type consistency:** `make-audio.py` 的 WAV 文件名与 `make-audio.sh` 引用一致（`music.wav`、`sfx_*.wav`、`narr_*.wav`）；解说数组下标与 `ST` 起始时间一一对应（9 个）。✓
- **已知说明**：「index.html」在 TTS 下可能发音怪异，已用口语化「打开游戏」替代；「动作牌」句用「抽两张」替代「+2」。若用户希望恢复，改台词重跑即可。
