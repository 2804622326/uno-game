# UNO 大作战 · 玩法演示动画短片实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 制作一段 30 秒、1080p、30fps 的 MP4 动画短片，演示 UNO 大作战核心玩法，带解说字幕，Claude 美学风格。

**Architecture:** 确定性时间轴 HTML 场景 `index-trailer.html` + `trailer.js`，由时间 `t`（秒）驱动 `render(t)` 计算每一帧画面；node 脚本 `render-trailer.mjs` 用 headless Chrome 逐帧截图（`?t=<秒>`），ffmpeg 合成 MP4。

**Tech Stack:** HTML5 / CSS3 / 原生 JS / node（无依赖）/ Chrome headless / ffmpeg 8.1。设计规格见 `docs/superpowers/specs/2026-07-31-uno-trailer-design.md`。

---

## 文件结构

- **Create:** `/Users/hello/Downloads/uno/index-trailer.html` — 场景骨架 + CSS（设计令牌、座位、牌堆、卡牌、字幕、叠加层）
- **Create:** `/Users/hello/Downloads/uno/trailer.js` — 卡牌工厂 + 插值/缓动工具 + 8 幕时间轴 `render(t)` + 实时/`?t=` 双模式
- **Create:** `/Users/hello/Downloads/uno/render-trailer.mjs` — 截帧脚本（并发 Chrome）+ 输出 ffmpeg 命令
- **Output:** `/Users/hello/Downloads/uno/uno-trailer.mp4`

## 关键约定（所有 Task 必须一致）

- 场景坐标：1920×1080 视口，卡片尺寸 **120×168px**，圆角 12px
- 座位：玩家 `seat-player`(下, 手牌 y≈840)、`seat-left`(左, x≈150 y≈430)、`seat-top`(上, y≈150)、`seat-right`(右, x≈1770 y≈430)
- 牌堆：弃牌堆 `discard`(中心 830,470)、抽牌堆 `draw`(1020,450)
- 当前行动座位用 `.acting` 类加高亮描边
- 所有运动由 `render(t)` 计算（禁 CSS transition）；缓动用 `easeInOut/easeOut` helper
- 字幕/叠加层：`caption`(底部居中)、`title`、`overlay`、`unoBadge`、`winBanner`、`burst`、`dice`、`arrow`
- 牌面类名：`.card.red/.green/.blue/.yellow/.wild/.wild4`，背面 `.back`（星纹白面）
- 设计令牌与 PPT 一致（`--bg:#F5F0EA` `--ink:#1F1E1D` `--ink-2:#6B675F` `--accent:#D97757` `--accent-soft:#F0D9CE`）

---

### Task 1: 场景骨架 + CSS + 工具函数 + 双模式引导

**Files:**
- Create: `/Users/hello/Downloads/uno/index-trailer.html`
- Create: `/Users/hello/Downloads/uno/trailer.js`

- [ ] **Step 1: 写入 `index-trailer.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>UNO 大作战 · 演示动画</title>
<style>
  :root{
    --bg:#F5F0EA;--ink:#1F1E1D;--ink-2:#6B675F;--line:#E6E1D8;
    --accent:#D97757;--accent-soft:#F0D9CE;
    --card-red:#E63946;--card-green:#2A9D4B;--card-blue:#2B6CB0;--card-yellow:#F4B41A;
    --serif:Georgia,"Songti SC","STSong",serif;
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1920px;height:1080px;overflow:hidden;background:var(--bg);color:var(--ink)}
  body{font-family:var(--sans);-webkit-font-smoothing:antialiased}
  #scene{position:relative;width:1920px;height:1080px}
  /* 牌桌 */
  #table{position:absolute;left:50%;top:50%;width:1500px;height:900px;transform:translate(-50%,-50%);
         background:#fff;border:2px solid var(--line);border-radius:48px;
         box-shadow:0 10px 40px rgba(31,30,29,.06)}
  #tableCenter{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
         font-family:var(--serif);font-size:52px;color:var(--accent-soft);letter-spacing:.3em;white-space:nowrap}
  /* 座位 */
  .seat{position:absolute;text-align:center}
  .seat .ring{position:absolute;inset:-14px;border:4px solid transparent;border-radius:24px}
  .seat.acting .ring{border-color:var(--accent);box-shadow:0 0 24px rgba(217,119,87,.45)}
  .seat .count{position:absolute;background:var(--ink);color:#fff;font-size:20px;font-weight:700;
         border-radius:20px;padding:4px 12px;top:-34px;left:50%;transform:translateX(-50%);min-width:52px}
  #seat-player{bottom:30px;left:50%;transform:translateX(-50%);width:760px;height:230px}
  #seat-left{left:24px;top:50%;transform:translateY(-50%);width:150px;height:420px}
  #seat-top{top:24px;left:50%;transform:translateX(-50%);width:520px;height:190px}
  #seat-right{right:24px;top:50%;transform:translateY(-50%);width:150px;height:420px}
  /* 卡牌 */
  .card,.card .back{position:absolute;width:120px;height:168px;border-radius:12px;overflow:hidden}
  .card{box-shadow:0 4px 14px rgba(0,0,0,.18);border:2px solid rgba(0,0,0,.06);
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-weight:800;font-size:52px;color:#fff;line-height:1}
  .card small{position:absolute;top:8px;left:10px;font-size:18px;font-weight:800;opacity:.9}
  .card.red{background:linear-gradient(150deg,#f4666f,var(--card-red))}
  .card.green{background:linear-gradient(150deg,#38c76b,var(--card-green))}
  .card.blue{background:linear-gradient(150deg,#4a8ad4,var(--card-blue))}
  .card.yellow{background:linear-gradient(150deg,#ffd25e,var(--card-yellow));color:#5a4200}
  .card.wild{background:linear-gradient(150deg,#8a63d2,#6b3fb5)}
  .card.wild4{background:linear-gradient(150deg,#3c3a44,#23212a)}
  .card .mini{font-size:22px;margin-top:8px}
  .card .back{background:linear-gradient(150deg,#f4a08a,var(--accent));top:0;left:0}
  .card .back::before{content:"★";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        font-size:56px;color:rgba(255,255,255,.55)}
  /* 牌堆 */
  .pile{position:absolute;width:120px;height:168px}
  #draw{left:1020px;top:450px}
  #discard{left:830px;top:470px}
  #deckPile{position:absolute;inset:0;background:linear-gradient(150deg,#f4a08a,var(--accent));
        border-radius:12px;border:2px solid rgba(0,0,0,.08);box-shadow:0 6px 18px rgba(0,0,0,.25)}
  #deckPile::after{content:"";position:absolute;inset:8px;border-radius:8px;border:2px solid rgba(255,255,255,.5)}
  /* 颜色指示 */
  #colorInd{position:absolute;top:86px;left:50%;transform:translateX(-50%);width:96px;height:96px;border-radius:50%;
        background:#fff;border:4px solid var(--ink);display:flex;align-items:center;justify-content:center;
        font-size:44px;box-shadow:0 4px 12px rgba(0,0,0,.12)}
  /* 字幕 / 叠加层 */
  #caption{position:absolute;left:50%;bottom:96px;transform:translateX(-50%);z-index:40;
        background:rgba(31,30,29,.86);color:#fff;font-size:34px;font-weight:700;padding:16px 34px;
        border-radius:14px;letter-spacing:.04em;opacity:0;white-space:nowrap}
  #title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
        gap:18px;z-index:30;opacity:0}
  #title h1{font-family:var(--serif);font-size:120px;font-weight:800;letter-spacing:.02em}
  #title p{font-size:34px;color:var(--ink-2)}
  #overlay{position:absolute;inset:0;background:var(--bg);z-index:50;opacity:0}
  #overlay h2{font-family:var(--serif);font-size:96px;margin-bottom:16px}
  #overlay p{font-size:40px;color:var(--ink-2)}
  #unoBadge{position:absolute;left:50%;bottom:300px;transform:translateX(-50%);z-index:36;
        background:var(--accent);color:#fff;font-family:var(--serif);font-size:90px;font-weight:800;
        padding:12px 46px;border-radius:20px;box-shadow:0 10px 30px rgba(217,119,87,.5);opacity:0}
  #winBanner{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:38;text-align:center;opacity:0}
  #winBanner .big{font-family:var(--serif);font-size:104px;font-weight:800;color:var(--accent)}
  #winBanner .sub{font-size:40px;color:var(--ink);margin-top:10px}
  #burst{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:32;font-size:200px;opacity:0}
  #dice{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);z-index:34;display:flex;gap:36px;opacity:0}
  .die{width:150px;height:150px;border-radius:26px;background:#fff;border:4px solid var(--ink);
        display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);place-items:center;padding:22px}
  .die i{width:24px;height:24px;border-radius:50%;background:var(--ink)}
  .die .pip{display:contents}
  #arrow{position:absolute;z-index:20;font-size:60px;color:var(--accent);opacity:0;font-weight:800}
</style>
</head>
<body>
<div id="scene">
  <div id="table"><div id="tableCenter">U N O</div></div>
  <div id="colorInd">●</div>

  <div class="seat" id="seat-top"><div class="ring"></div><div class="count" id="count-top">0</div></div>
  <div class="seat" id="seat-left"><div class="ring"></div><div class="count" id="count-left">0</div></div>
  <div class="seat" id="seat-right"><div class="ring"></div><div class="count" id="count-right">0</div></div>
  <div class="seat" id="seat-player"><div class="ring"></div><div class="count" id="count-player">0</div></div>

  <div class="pile" id="draw"><div id="deckPile"></div></div>
  <div class="pile" id="discard"></div>

  <div id="hand"></div>
  <div id="fly"></div>
  <div id="burst">⚡</div>
  <div id="arrow">⬇</div>
  <div id="dice">
    <div class="die" id="die1"></div>
    <div class="die" id="die2"></div>
  </div>
  <div id="unoBadge">UNO!</div>
  <div id="winBanner">
    <div class="big">你赢了！</div>
    <div class="sub">本局 +87 分 · 先到 500 分获胜</div>
  </div>
  <div id="caption"></div>
  <div id="title"><h1>UNO 大作战</h1><p>纯浏览器里的 UNO</p></div>
  <div id="overlay">
    <h2>打开就能玩</h2>
    <p>双击 index.html · 立即开始 UNO 冒险</p>
  </div>
</div>
<script src="trailer.js"></script>
</body>
</html>
```

- [ ] **Step 2: 写入 `trailer.js` 框架（工具 + 卡牌工厂 + 双模式引导）**

```js
/* ============ 工具 ============ */
const $ = id => document.getElementById(id);
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
const lerp = (a,b,p)=>a+(b-a)*p;
const easeOut = p=>1-Math.pow(1-p,3);
const easeInOut = p=>p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
/* 在 [t0,t1] 内归一化进度（钳制到 0..1），out 为缓动函数 */
function seg(t,t0,t1,fn=easeInOut){ if(t<t0)return 0; if(t>t1)return 1; return fn((t-t0)/(t1-t0)); }

/* ============ 卡牌工厂 ============ */
function makeCard(card){
  const el=document.createElement('div');
  el.className='card '+card.suit;
  el.innerHTML='<small>'+card.rank+'</small>'+card.rank;
  el.style.opacity=0; el.style.visibility='hidden';
  document.getElementById('fly').appendChild(el);
  el.__card=card; return el;
}
/* 背面卡牌（AI 手牌、飞行中） */
function makeBack(){
  const el=document.createElement('div');
  el.className='card';
  el.innerHTML='<div class="back"></div>';
  el.style.opacity=0; el.style.visibility='hidden';
  document.getElementById('fly').appendChild(el);
  return el;
}
/* 设置位置：x,y 为中心坐标 */
function place(el,x,y,op=1,rot=0){
  el.style.opacity=op;
  el.style.visibility=op<=0?'hidden':'visible';
  el.style.transform='translate('+(x-60)+'px,'+(y-84)+'px)'+(rot?' rotate('+rot+'deg)':'');
}

/* ============ 全局状态与元素引用 ============ */
const cardDefs=[
  {id:'p7',suit:'red',rank:'7'},
  {id:'g5',suit:'green',rank:'5'},
  {id:'skip',suit:'green',rank:'⊘'},
  {id:'wild',suit:'wild',rank:'★'},
  {id:'z0',suit:'red',rank:'0'},
  {id:'last',suit:'blue',rank:'3'},
];
const cards=Object.fromEntries(cardDefs.map(c=>[c.id,makeCard(c)]));
const drawPile={x:1080,y:534}, discard={x:890,y:554};
const AI={ left:{x:210,y:430}, top:{x:960,y:230}, right:{x:1710,y:430} };

/* 座位手牌渲染 */
function handCards(n,align){
  // align: 'bottom'|'top'|'left'|'right'
  return null; // Task 2 实现
}

/* ============ 渲染 ============ */
function render(t){
  /* 各 Task 按时间轴填充：intro → deal → plays → chance → uno → win → end */
}

/* ============ 引导：?t= 单帧 或 实时循环 ============ */
const tp=parseFloat(new URLSearchParams(location.search).get('t'));
if(!isNaN(tp)){ render(tp); }
else{
  let last=performance.now()/1000;
  (function loop(){
    const now=performance.now()/1000;
    const dt=now-last; last=now;
    render(now);
    requestAnimationFrame(loop);
  })();
}
```

- [ ] **Step 3: 骨架验证**

Run: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --screenshot=/tmp/t1.png --window-size=1920,1080 --force-device-scale-factor=1 "file:///Users/hello/Downloads/uno/index-trailer.html?t=1"`
Expected: 生成 1920×1080 PNG，画面为奶油底 + 桌台 + 四座位 + 中央 U N O 字样，无 JS 报错。

---

### Task 2: 开场 + 发牌（0–5.5s）

**Files:**
- Modify: `/Users/hello/Downloads/uno/trailer.js`

- [ ] **Step 1: 实现开场与发牌逻辑（替换 `render` 与 `handCards`）**

```js
/* 手牌渲染：n 张牌围绕座位中心扇形/堆叠摆放，from 参数供发牌动画起点复用 */
function handCards(n,align){
  const pts=[];
  if(align==='bottom'){
    for(let i=0;i<n;i++) pts.push({x:960-((n-1)*64/2)+i*64, y:840, rot:(i-(n-1)/2)*6});
  }else if(align==='top'){
    for(let i=0;i<n;i++) pts.push({x:960-((n-1)*56/2)+i*56, y:230, rot:(i-(n-1)/2)*4});
  }else if(align==='left'){
    for(let i=0;i<n;i++) pts.push({x:210, y:430-((n-1)*42/2)+i*42, rot:0});
  }else{
    for(let i=0;i<n;i++) pts.push({x:1710, y:430-((n-1)*42/2)+i*42, rot:0});
  }
  return pts;
}

const SEAT_CNT={top:7,left:7,right:7,player:7};

function render(t){
  /* ---------- 0–2.5s 开场 ---------- */
  const intro=seg(t,0,1.6);
  $('table').style.opacity=intro;
  $('colorInd').style.opacity=seg(t,0.4,1.4);
  ['top','left','right','player'].forEach(k=>{
    const s=$('seat-'+k); s.style.opacity=seg(t,k==='player'?0.4:0.2,1.2+k*0.06);
  });
  $('title').style.opacity=seg(t,0.4,1.2)* (1-seg(t,2.3,2.7));
  $('count-top').textContent=SEAT_CNT.top; $('count-left').textContent=SEAT_CNT.left;
  $('count-right').textContent=SEAT_CNT.right; $('count-player').textContent=SEAT_CNT.player;

  /* ---------- 2.5–5.5s 发牌 ---------- */
  const handPts={top:handCards(7,'top'),left:handCards(7,'left'),right:handCards(7,'right'),player:handCards(7,'bottom')};
  const dealOrder=[...Array(7).keys()].flatMap(i=>['top','left','right','player'].map(k=>[k,i]));
  const DC={x:1080,y:534};
  dealOrder.forEach((item,idx)=>{
    const [k,i]=item;
    const start=2.6+idx*0.10, dur=0.7;
    const p=easeOut(seg(t,start,start+dur));
    const fromX=DC.x, fromY=DC.y, to=handPts[k][i];
    const x=lerp(fromX,to.x,p), y=lerp(fromY,to.y,p);
    if(p>0&&p<1){ drawBackAt(x,y,0); }
    else if(p===1){ /* 已就位：使用常驻手牌渲染（下方 Step 2） */ }
  });
}
/* 飞行中的背面卡 */
function drawBackAt(x,y,rot){
  // 简化：直接使用一个共享背面元素
  const b=$('_back')||(function(){const e=makeBack();e.id='_back';return e;})();
  b.style.opacity=1; b.style.visibility='visible';
  b.style.transform='translate('+(x-60)+'px,'+(y-84)+'px) rotate('+rot+'deg)';
}
```

- [ ] **Step 2: 常驻手牌（发牌结束后展示各座位手牌堆叠）**

```js
/* 在 render(t) 发牌段之后追加：t>=5.2 时各座位按 handPts 摆牌 */
function render(t){
  /* ... 上述代码段 ... */

  /* ---------- 常驻手牌（t≥5.0 生效） ---------- */
  const settle=seg(t,5.0,5.4);
  if(settle>0){
    ['top','left','right'].forEach(k=>{
      handCards(SEAT_CNT[k],k).forEach((pt,i)=>{
        const el=cards['_hand_'+k+'_'+i]||(cards['_hand_'+k+'_'+i]=makeBack());
        place(el,pt.x,pt.y,settle,pt.rot);
      });
    });
    // 玩家手牌：7 张可见牌面
    const ppt=handCards(SEAT_CNT.player,'bottom');
    ppt.forEach((pt,i)=>{
      const el=cards['_player_'+i]||(cards['_player_'+i]=makeCard({suit:['red','green','blue','yellow'][i%4],rank:String((i+1)%10)}));
      place(el,pt.x,pt.y,settle,pt.rot);
    });
  }
}
```

- [ ] **Step 3: 开局顶牌 + 字幕（t≈5.4 弃牌堆翻开红7）**

```js
/* render(t) 追加 */
/* ---------- 翻开顶牌 ---------- */
const reveal=seg(t,5.4,6.2,easeOut);
place(cards.p7,discard.x,discard.y,reveal);

/* ---------- 字幕 ---------- */
const CAPS=[
  [2.6,5.4,'每人发 7 张，翻开开局牌'],
  [6.2,8.2,'出牌须同色或同数字'],
  [8.8,11.4,'动作牌：跳过 · 反转 · +2'],
  [12.2,13.6,'野牌：自由选择颜色'],
  [14.2,18.2,'打出 0：随机触发小游戏——闪电！'],
  [19.6,21.0,'剩一张：喊 UNO！'],
  [22.8,26.2,'先到 500 分获胜'],
  [26.8,30,'打开就能玩'],
];
(function(){ let on=0;
  CAPS.forEach(c=>{ const o=seg(t,c[0]-0.3,c[0])*(1-seg(t,c[1],c[1]+0.3)); if(o>on){on=o;$('caption').textContent=c[2];} });
  $('caption').style.opacity=on;
})();
```

- [ ] **Step 4: 验证中间帧**

Run: Chrome headless 截图 `?t=3`（发牌中）、`?t=6`（顶牌翻开）。
Expected: `t=3` 若干背面卡从中央飞向座位；`t=6` 四座位有手牌，弃牌堆显示红 7。

---

### Task 3: 对局回合（6–14s：红7 → 绿5 → Skip → 野牌）

**Files:**
- Modify: `/Users/hello/Downloads/uno/trailer.js`

- [ ] **Step 1: 增加「打牌」动作函数与行动高亮**

```js
/* 出牌：cardEl 从 from{x,y} 飞到弃牌堆，翻转(0.15s)后停驻 */
let playing=null;
function playCard(cardId,from,dur,ease=easeInOut){
  const el=cards[cardId];
  return {
    isPlaying(t,start){
      const p=seg(t,start,start+dur,ease);
      if(p<=0)return;
      if(p<1){
        // 前半段背面飞行，后半段翻成牌面
        const face=p>0.55;
        el.innerHTML='<div class="back"></div>'+((face)?'<small>'+el.__card.rank+'</small>'+el.__card.rank:'');
        const x=lerp(from.x,discard.x,p), y=lerp(from.y,discard.y,p);
        place(el,x,y,1,lerp(0,4,p));
      }else{
        el.innerHTML='<small>'+el.__card.rank+'</small>'+el.__card.rank;
        place(el,discard.x,discard.y,1);
      }
    }
  };
}
function act(k,active){ $('seat-'+k).classList.toggle('acting',active); }
```

- [ ] **Step 2: 编排 6–14s 回合动作**

```js
/* render(t) 追加（放在常驻手牌与字幕之间） */
/* ---------- 6–14s 对局 ---------- */
act('player', t>=5.6 && t<8.2);
act('left',   t>=8.2 && t<9.6);
act('player', t>=9.6 && t<11.4);
act('player', t>=11.6 && t<13.4);

// 玩家打红7：从手牌中央附近飞向弃牌堆
const P7=playCard('p7',{x:960,y:840},0.9);
P7.isPlaying(t,6.3);

// AI 左打绿5：从左手牌飞向弃牌堆（先显示背面）
const G5=p=>{const el=cards.g5;if(p<=0)return;
  if(p<1){el.innerHTML='<div class="back"></div>';place(el,lerp(AI.left.x,drawPile.x,p),lerp(AI.left.y,drawPile.y,p),1);}
  else{el.innerHTML='<small>5</small>5';el.classList.remove('green');el.classList.add('green');place(el,discard.x,discard.y,1);}
};
G5(seg(t,8.4,9.6,easeInOut));

// 玩家打 Skip（绿）：飞到弃牌堆，箭头闪动
const SK=playCard('skip',{x:920,y:840},0.8);
SK.isPlaying(t,9.9);
$('arrow').style.opacity=seg(t,10.8,11.0)*(1-seg(t,11.2,11.4));

// 玩家打野牌 ★：颜色指示切为蓝色
const WL=playCard('wild',{x:880,y:840},0.9);
WL.isPlaying(t,12.0);
$('colorInd').style.background=seg(t,12.9,13.3)>=0.5?'#2B6CB0':'#fff';
$('colorInd').textContent=seg(t,12.9,13.3)>=0.5?'●':'●';
```

- [ ] **Step 3: 验证**

Run: 截图 `?t=7`（红7飞行中/停驻）、`?t=10.4`（Skip 在弃牌堆）、`?t=13.2`（野牌 + 颜色指示蓝色）。
Expected: 弃牌堆依次显示 7(红)→5(绿)→⊘(绿)→★；最后颜色指示为蓝底。

---

### Task 4: 机会牌 0 + 闪电掷骰 + 罚抽（14–18s）

**Files:**
- Modify: `/Users/hello/Downloads/uno/trailer.js`

- [ ] **Step 1: 骰子渲染 helper**

```js
const DOTS=[[1],[2,3],[1,5,3],[1,2,4,3],[1,2,4,6,3],[1,2,3,4,5,6]];
function setDie(el,v){
  el.innerHTML='';
  for(let i=1;i<=6;i++){const d=document.createElement('i');if(DOTS[v-1].includes(i))d.style.background='var(--ink)';else d.style.opacity=0;el.appendChild(d);}
}
```

- [ ] **Step 2: 编排 14–18s（打0 → 闪电 → 掷骰 5&3 → AI 右罚抽 8）**

```js
/* render(t) 追加 */
/* ---------- 机会牌 0 + 闪电 ---------- */
const Z0=playCard('z0',{x:900,y:840},0.8);
Z0.isPlaying(t,14.0);
$('burst').style.opacity=seg(t,14.9,15.1)*(1-seg(t,15.8,16.0));
const diceOn=seg(t,15.2,15.5)*(1-seg(t,18.0,18.3));
$('dice').style.opacity=diceOn;
if(t>=15.4){
  // 骰子翻滚：15.4–16.2 随机抖动，16.2 后定格 5 与 3
  const settled=seg(t,16.2,16.6);
  const v1=settled>=1?5:Math.floor(1+6*Math.abs(Math.sin(t*17))%6);
  const v2=settled>=1?3:Math.floor(1+6*Math.abs(Math.sin(t*19))%6);
  setDie($('die1'),v1); setDie($('die2'),v2);
  const wob=settled<1?6*Math.sin(t*40):0;
  $('die1').style.transform='rotate('+wob+'deg)'; $('die2').style.transform='rotate('+(-wob)+'deg)';
}
/* AI 右罚抽 8 张 */
const DR=seg(t,17.0,18.8,easeOut);
if(DR>0){
  for(let i=0;i<8;i++){
    const el=cards['_draw_'+i]||(cards['_draw_'+i]=makeBack());
    const s=clamp((DR*8-i)/1,0,1);
    place(el,lerp(drawPile.x,AI.right.x,s),lerp(drawPile.y,AI.right.y,s),s);
  }
  $('count-right').textContent=7+Math.round(DR*8);
}
```

- [ ] **Step 3: 验证**

Run: 截图 `?t=16.5`（骰子定格 5 与 3）、`?t=18`（AI 右手牌增多、count=15）。
Expected: 中央⚡闪烁、两颗骰子显示 5/3、右侧 AI 手牌变多。

---

### Task 5: UNO → 获胜 → 结束（19–30s）

**Files:**
- Modify: `/Users/hello/Downloads/uno/trailer.js`

- [ ] **Step 1: 玩家手牌收缩到 1 张 + UNO! 徽标 + 获胜**

```js
/* render(t) 追加 */
/* ---------- 玩家手牌收缩到 1 张（视觉简化：隐藏大部分手牌） ---------- */
if(t>=18.8){
  for(let i=1;i<7;i++){ const el=cards['_player_'+i]; if(el) place(el,960,840,0); }
}
/* UNO! 徽标（19.6–21.0） */
$('unoBadge').style.opacity=seg(t,19.4,19.8)*(1-seg(t,21.2,21.6));
$('unoBadge').style.transform='translateX(-50%) scale('+(1+0.04*Math.sin(t*6))+' )';

/* ---------- 打最后一张（蓝3） → 获胜 ---------- */
const LAST=playCard('last',{x:960,y:840},0.7);
LAST.isPlaying(t,21.6);
$('winBanner').style.opacity=seg(t,22.6,23.4)*(1-seg(t,26.4,27.0));
if(t>=22.6&&t<27){ place(cards._player_0,960,840,0); $('count-player').textContent='0'; }

/* ---------- 结束覆盖层（26.8–30） ---------- */
$('overlay').style.opacity=seg(t,26.6,27.6);
if(t>=27.6){ place(cards.last,discard.x,discard.y,1); }
```

- [ ] **Step 2: 清理 `handCards` 中未使用分支与 `playing` 变量**

删除 Task 3 Step 1 中未使用的 `let playing=null;`，确认 `handCards` 四种 align 均被引用。

- [ ] **Step 3: 验证**

Run: 截图 `?t=20`（UNO! 徽标 + 手牌 1 张）、`?t=24`（你赢了 + 计分）、`?t=29`（结束页）。
Expected: 依次出现 UNO! → 你赢了！+87 分 → 「打开就能玩」。

---

### Task 6: 截帧渲染脚本 + ffmpeg 合成 + 最终校验

**Files:**
- Create: `/Users/hello/Downloads/uno/render-trailer.mjs`
- Output: `/Users/hello/Downloads/uno/uno-trailer.mp4`

- [ ] **Step 1: 写入 `render-trailer.mjs`**

```js
#!/usr/bin/env node
/* 截帧：headless Chrome 按 30fps 渲染 30s = 900 帧，并发 4 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS=30, TOTAL=30, W=1920, H=1080, CONC=4;
const URL='file:///Users/hello/Downloads/uno/index-trailer.html';
const DIR='/tmp/uno_frames';
fs.rmSync(DIR,{recursive:true,force:true});
fs.mkdirSync(DIR,{recursive:true});
const frames=TOTAL*FPS;

let next=0;
async function worker(){
  while(true){
    const i=next++;
    if(i>=frames)return;
    const t=(i/FPS).toFixed(4);
    const out=`${DIR}/f_${String(i).padStart(4,'0')}.png`;
    spawnSync(CHROME,[
      '--headless=new','--disable-gpu','--hide-scrollbars',
      `--window-size=${W},${H}`,'--force-device-scale-factor=1',
      `--screenshot=${out}`,`${URL}?t=${t}`
    ],{stdio:'ignore'});
    if(i%60===0)console.error(`captured ${i}/${frames}`);
  }
}
await Promise.all(Array.from({length:CONC},worker));
console.error('ALL_FRAMES_DONE');
```

- [ ] **Step 2: 合成 MP4**

Run:
```bash
cd /Users/hello/Downloads/uno
ffmpeg -y -framerate 30 -i /tmp/uno_frames/f_%04d.png -c:v libx264 -pix_fmt yuv420p -profile:v high -crf 18 -movflags +faststart uno-trailer.mp4
```
Expected: 输出 `uno-trailer.mp4`（约 1080p、30fps、约 30s）。

- [ ] **Step 3: 校验输出**

Run:
```bash
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of default=noprint_wrappers=1 /Users/hello/Downloads/uno/uno-trailer.mp4
```
Expected: `width=1920 height=1080 r_frame_rate=30/1 duration≈30.0`。

- [ ] **Step 4: 抽样肉眼检查**

Run: `open /Users/hello/Downloads/uno/uno-trailer.mp4` 播放；另用 Chrome 截图抽样帧 `?t=1 / 3 / 6 / 10.4 / 13.2 / 16.5 / 20 / 24 / 29` 逐张核对故事板。若有字幕/动画错位，回到对应 Task 修改 `trailer.js` 后重跑本 Task。

---

## Self-Review

- **Spec coverage:** 设计文档的 8 幕故事板对应 Task 2–5；渲染管线（截帧+ffmpeg）在 Task 6；字幕在 Task 2 Step 3 的 `CAPS` 表，时间轴与故事板一致（2.6/6.2/8.8/12.2/14.2/19.6/22.8/26.8）。✓
- **Placeholder scan:** 全部步骤含完整代码；唯一占位 `handCards` 的 `return null` 在 Task 2 Step 1 被实现替换。✓
- **Type consistency:** `place/seg/lerp/easeOut/easeInOut`、卡牌 id（`p7/g5/skip/wild/z0/last`）、座位 id、`drawPile/discard/AI` 坐标在各 Task 一致。✓
- **已知简化（设计内声明）**：玩家手牌收缩为「隐藏多余卡」而非逐张打出；AI 出牌飞行途中显示背面、落定翻面；骰子使用正弦抖动的确定性伪随机。均为视觉可接受。
