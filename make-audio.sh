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

# 2) 每句解说起始时间（毫秒）
ST=(800 3000 6400 9400 12200 14400 19800 23000 27400)

# 3) 构建 filter_complex 并混音
python3 - "$OUT" "${ST[@]}" <<'PY'
import sys, subprocess
OUT=sys.argv[1]
ST=list(map(int,sys.argv[2:]))

def dur_ms(path):
    r=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',path],capture_output=True,text=True)
    return int(float(r.stdout.strip())*1000)

music=f'{OUT}/music.wav'
allin=[music]
for i in range(1,10):
    allin.append(f'{OUT}/narr_{i:02d}.wav')

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
parts.append('[0]aformat=channel_layouts=stereo,volume=0.35[m]'); labels.append('[m]')
for i,st in enumerate(ST):
    d=dur_ms(f'{OUT}/narr_{i+1:02d}.wav')
    labs=f'[n{i+1}]'
    parts.append(f'[{i+1}]aformat=channel_layouts=stereo,volume=1.0,adelay={st}|{st}{labs}')
    labels.append(labs)
base=1+9
for j,(name,ms) in enumerate(sfx_events):
    labs=f'[s{j}]'
    parts.append(f'[{base+j}]aformat=channel_layouts=stereo,volume=0.85,adelay={ms}|{ms}{labs}')
    labels.append(labs)

N=len(allin)
fc=';'.join(parts)+';'+''.join(labels)+f'amix=inputs={N}:normalize=0:dropout_transition=0[out]'
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
