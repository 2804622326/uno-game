/* ============ 工具 ============ */
const $ = id => document.getElementById(id);
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));
const lerp = (a,b,p)=>a+(b-a)*p;
const easeOut = p=>1-Math.pow(1-p,3);
const easeInOut = p=>p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
/* 在 [t0,t1] 内归一化进度（钳制 0..1），out 为缓动函数 */
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
function makeBack(){
  const el=document.createElement('div');
  el.className='card';
  el.innerHTML='<div class="back"></div>';
  el.style.opacity=0; el.style.visibility='hidden';
  document.getElementById('fly').appendChild(el);
  return el;
}
/* 设置位置：x,y 为卡片中心 */
function place(el,x,y,op=1,rot=0){
  el.style.opacity=op;
  el.style.visibility=op<=0?'hidden':'visible';
  el.style.transform='translate('+(x-60)+'px,'+(y-84)+'px)'+(rot?' rotate('+rot+'deg)':'');
}

/* ============ 常量与元素 ============ */
const cardDefs=[
  {id:'open',suit:'red',rank:'5'},
  {id:'p7',suit:'red',rank:'7'},
  {id:'g5',suit:'green',rank:'5'},
  {id:'skip',suit:'green',rank:'⊘'},
  {id:'wild',suit:'wild',rank:'★'},
  {id:'z0',suit:'blue',rank:'0'},
  {id:'last',suit:'blue',rank:'3'},
];
const cards=Object.fromEntries(cardDefs.map(c=>[c.id,makeCard(c)]));
const drawPile={x:1080,y:534}, discard={x:890,y:554};
const AI={ left:{x:210,y:430}, top:{x:960,y:230}, right:{x:1710,y:430} };

/* 骰子 pip 布局（3x3 网格，单元格编号 1..9） */
const DOTS=[[5],[3,7],[3,5,7],[1,3,7,9],[1,3,5,7,9],[1,3,4,6,7,9]];
function setDie(el,v){
  el.innerHTML='';
  const cells=DOTS[v-1];
  for(let i=1;i<=9;i++){
    const d=document.createElement('i');
    if(!cells.includes(i)) d.style.opacity=0;
    el.appendChild(d);
  }
}

/* 座位手牌坐标 */
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

/* ============ 出牌动画 ============ */
function playCard(cardId,from,dur,ease=easeInOut){
  const el=cards[cardId];
  const RANK=el.__card.rank;
  return { isPlaying(t,start){
    const p=seg(t,start,start+dur,ease);
    if(p<=0)return;
    if(p<1){
      const face=p>0.55;
      el.innerHTML='<div class="back"></div>'+((face)?'<small>'+RANK+'</small>'+RANK:'');
      const x=lerp(from.x,discard.x,p), y=lerp(from.y,discard.y,p);
      place(el,x,y,1,lerp(0,4,p));
    }else{
      el.innerHTML='<small>'+RANK+'</small>'+RANK;
      place(el,discard.x,discard.y,1);
    }
  }};
}

/* 行动高亮 */
function inWin(t,lo,hi){ return t>=lo && t<hi; }
function act(k,active){ $('seat-'+k).classList.toggle('acting', active); }

/* ============ 主渲染 ============ */
function render(t){
  /* ---------- 0–2.5s 开场 ---------- */
  $('table').style.opacity=seg(t,0,1.6);
  $('colorInd').style.opacity=seg(t,0.4,1.4);
  ['top','left','right','player'].forEach(k=>{
    $('seat-'+k).style.opacity=seg(t,0.2,1.2+k*0.06);
  });
  $('title').style.opacity=seg(t,0.4,1.2)*(1-seg(t,2.2,2.6));
  $('arrow').style.left='960px'; $('arrow').style.top='120px';

  /* ---------- 2.5–5.5s 发牌 ---------- */
  const handPts={top:handCards(7,'top'),left:handCards(7,'left'),right:handCards(7,'right'),player:handCards(7,'bottom')};
  const dealOrder=[...Array(7).keys()].flatMap(i=>['top','left','right','player'].map(k=>[k,i]));
  dealOrder.forEach((item,idx)=>{
    const [k,i]=item;
    const start=2.5+idx*0.09, dur=0.55;
    const p=easeOut(seg(t,start,start+dur));
    if(p>0&&p<1){
      const el=cards['_deal_'+idx]||(cards['_deal_'+idx]=makeBack());
      place(el,lerp(drawPile.x,handPts[k][i].x,p),lerp(drawPile.y,handPts[k][i].y,p),1);
    }else if(p>=1){
      const el=cards['_deal_'+idx]; if(el) place(el,-200,-200,0);
    }
  });

  /* ---------- 常驻手牌（t≥5.6） ---------- */
  const settle=seg(t,5.6,6.0);
  if(settle>0){
    ['top','left','right'].forEach(k=>{
      handCards(7,k).forEach((pt,i)=>{
        const el=cards['_hand_'+k+'_'+i]||(cards['_hand_'+k+'_'+i]=makeBack());
        place(el,pt.x,pt.y,settle,pt.rot);
      });
    });
    handCards(7,'bottom').forEach((pt,i)=>{
      const el=cards['_player_'+i]||(cards['_player_'+i]=makeCard({suit:['red','green','blue','yellow'][i%4],rank:String((i+1)%10)}));
      place(el,pt.x,pt.y,settle,pt.rot);
    });
  }

  /* ---------- 翻开顶牌（红5） ---------- */
  const reveal=seg(t,6.1,6.9,easeOut);
  place(cards.open,discard.x,discard.y,reveal);

  /* ---------- 6.9–15s 对局 ---------- */
  act('player', inWin(t,6.6,8.0)||inWin(t,9.9,11.2)||inWin(t,12.0,13.4)||inWin(t,19.2,21.4));
  act('left',   inWin(t,8.6,9.8));
  act('top',    inWin(t,11.0,11.5));
  act('right',  false);

  /* 玩家打红7 */
  playCard('p7',{x:960,y:840},0.9).isPlaying(t,6.9);
  /* AI 左打绿5 */
  const g=seg(t,8.8,9.7,easeInOut);
  if(g>0&&g<1){ const el=cards.g5; el.innerHTML='<div class="back"></div>';
    place(el,lerp(AI.left.x,discard.x,g),lerp(AI.left.y,discard.y,g),1); }
  else if(g>=1){ const el=cards.g5; el.innerHTML='<small>5</small>5'; place(el,discard.x,discard.y,1); }
  /* 玩家打 Skip */
  playCard('skip',{x:920,y:840},0.8).isPlaying(t,10.1);
  $('arrow').style.opacity=seg(t,11.0,11.2)*(1-seg(t,11.3,11.5));
  /* 玩家打野牌 → 颜色切蓝 */
  playCard('wild',{x:880,y:840},0.9).isPlaying(t,12.2);
  const blueP=seg(t,12.9,13.3);
  $('colorInd').style.background=blueP>=0.5?'#2B6CB0':'#fff';
  $('colorInd').style.color=blueP>=0.5?'#fff':'#1F1E1D';

  /* ---------- 14.2–19s 机会牌 0 + 闪电 ---------- */
  playCard('z0',{x:900,y:840},0.8).isPlaying(t,14.2);
  $('burst').style.opacity=seg(t,15.1,15.3)*(1-seg(t,16.0,16.2));
  const diceOn=seg(t,15.4,15.7)*(1-seg(t,18.2,18.5));
  $('dice').style.opacity=diceOn;
  if(diceOn>0){
    const settled=seg(t,16.5,16.9);
    const v1=settled>=1?5:Math.floor(1+(6*Math.abs(Math.sin(t*17)))%6);
    const v2=settled>=1?3:Math.floor(1+(6*Math.abs(Math.sin(t*19)))%6);
    setDie($('die1'),v1); setDie($('die2'),v2);
    const wob=settled<1?8*Math.sin(t*40):0;
    $('die1').style.transform='rotate('+wob+'deg)';
    $('die2').style.transform='rotate('+(-wob)+'deg)';
  }
  /* AI 右罚抽 8 张 */
  const DR=seg(t,17.2,19.0,easeOut);
  if(DR>0){
    for(let i=0;i<8;i++){
      const el=cards['_draw_'+i]||(cards['_draw_'+i]=makeBack());
      const s=clamp(DR*8-i,0,1);
      place(el,lerp(drawPile.x,AI.right.x,s),lerp(drawPile.y,AI.right.y,s),s);
    }
    $('count-right').textContent=7+Math.round(DR*8);
  }

  /* ---------- 19–22.3s UNO + 获胜 ---------- */
  if(t>=18.9){ for(let i=1;i<7;i++){ const el=cards['_player_'+i]; if(el) place(el,960,840,0); } }
  $('count-player').textContent = t>=22.3 ? '0' : (t>=19.0 ? '1' : '7');
  $('unoBadge').style.opacity=seg(t,19.5,19.9)*(1-seg(t,21.4,21.8));
  $('unoBadge').style.transform='translateX(-50%) scale('+(1+0.04*Math.sin(t*6))+')';
  playCard('last',{x:960,y:840},0.7).isPlaying(t,21.6);
  if(t>=22.3){ const el=cards['_player_0']; if(el) place(el,960,840,0); }
  $('winBanner').style.opacity=seg(t,22.6,23.4)*(1-seg(t,26.6,27.2));

  /* ---------- 结束覆盖层 ---------- */
  $('overlay').style.opacity=seg(t,26.8,27.8);

  /* ---------- 字幕 ---------- */
  const CAPS=[
    [2.6,5.9,'每人发 7 张，翻开开局牌'],
    [6.8,8.6,'出牌须同色或同数字'],
    [9.6,11.6,'动作牌：跳过 · 反转 · +2'],
    [12.3,13.8,'野牌：自由选择颜色'],
    [14.4,18.4,'打出 0：随机触发小游戏——闪电！'],
    [19.8,21.2,'剩一张：喊 UNO！'],
    [22.8,26.4,'先到 500 分获胜'],
    [27.2,30,'打开就能玩'],
  ];
  let on=0;
  CAPS.forEach(c=>{ const o=seg(t,c[0]-0.3,c[0])*(1-seg(t,c[1],c[1]+0.3)); if(o>on){on=o;$('caption').textContent=c[2];} });
  $('caption').style.opacity=on;
}

/* ============ 引导：?t= 单帧 或 实时循环 ============ */
const tp=parseFloat(new URLSearchParams(location.search).get('t'));
if(!isNaN(tp)){ render(tp); }
else{
  (function loop(){
    render(performance.now()/1000);
    if(window.__stopLoop) return;
    requestAnimationFrame(loop);
  })();
}
