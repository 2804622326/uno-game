#!/usr/bin/env node
/* 验证：庞氏/决斗/亮牌等交互流程期间，所有客户端都能收到进行中状态（snapshot.flow.text）
 * 用法：node test_flow_status.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const UNOCore = require('./uno-core.js');

const PORT = 34569;
const TIME = 45000;

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ ' + name); } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function mkClient() {
  const c = { ws: null, msgs: [], idx: 0, lastState: null, lastPrompt: null, _acting: false, _closed: false, flows: new Set(), nonCurrentFlows: new Set() };
  c.ws = new WebSocket('ws://127.0.0.1:' + PORT);
  c.ws.on('message', d => {
    let m;
    try { m = JSON.parse(d.toString()); } catch (e) { return; }
    c.msgs.push(m);
    if (m.type === 'state') {
      c.lastState = m;
      if (m.snapshot.flow && m.snapshot.flow.text) {
        c.flows.add(m.snapshot.flow.name + ':' + m.snapshot.flow.text);
        // 非当前玩家也收到
        if (m.yourSeat !== m.snapshot.current) c.nonCurrentFlows.add(m.snapshot.flow.name + ':' + m.snapshot.flow.text);
      }
    }
    if (m.type === 'prompt') c.lastPrompt = m;
  });
  c.ws.on('close', () => { c._closed = true; });
  return new Promise((resolve, reject) => {
    c.ws.on('open', () => resolve(c));
    c.ws.on('error', reject);
  });
}
function send(c, obj) { if (!c._closed) c.ws.send(JSON.stringify(obj)); }
function nextMsg(c, type, timeout) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      while (c.idx < c.msgs.length) {
        const m = c.msgs[c.idx++];
        if (!type || m.type === type) return resolve(m);
      }
      if (Date.now() - t0 > (timeout || 8000)) return reject(new Error('等待 ' + type + ' 超时'));
      setTimeout(poll, 25);
    })();
  });
}

/* 正确的自动应答：prompt 内容在 m.prompt 里 */
function autoPrompt(c) {
  const m = c.lastPrompt;
  if (!m || m._handled) return;
  m._handled = true;
  const p = m.prompt || {};
  let choice = null;
  switch (p.kind) {
    case 'color': choice = { kind: 'color', color: 'red' }; break;
    case 'duelColor': choice = { kind: 'duelColor', color: 'red' }; break;
    case 'target': choice = { kind: 'target', seat: p.seats[0] }; break;
    case 'duelTarget': choice = { kind: 'duelTarget', seat: p.seats[0] }; break;
    case 'reveal': choice = { kind: 'reveal', cardIdx: 0 }; break;
    case 'peach': choice = { kind: 'peach', indexes: [0] }; break;
  }
  if (choice) send(c, { type: 'choice', choice });
}
/* 自动出牌：优先打 0 值卡牌（触发机会活动），其次野牌 */
function autoPlay(c) {
  const s = c.lastState;
  if (c.lastPrompt && !c.lastPrompt._handled) return;
  if (!s || !s.canAct || c._acting || c._closed) return;
  c._acting = true;
  const g = s.snapshot;
  const hand = g.players[0].hand;
  try {
    if (s.playDrawn && hand && hand.length) {
      send(c, { type: 'action', action: 'play', cardIdx: hand.length - 1 });
    } else if (s.mustDraw) {
      send(c, { type: 'action', action: 'draw' });
    } else if (hand && hand.length) {
      // 接龙中：只能出 +2/+4 或抓累计张数
      const inStack = g.drawStack && g.drawStack.target === 0;
      const playable = [];
      hand.forEach((card, i) => {
        if (inStack ? UNOCore.isDrawStackCard(card) : UNOCore.legalPlayable(card, hand, g.activeColor, g.activeValue)) playable.push(i);
      });
      if (playable.length) {
        let pick = playable[0];
        // 优先 0 值机会卡 / 野牌，让流程更容易触发
        for (const i of playable) {
          const cd = hand[i];
          if (cd.value === 0 || cd.type === 'wild' || cd.type === 'wild4') { pick = i; break; }
        }
        send(c, { type: 'action', action: 'play', cardIdx: pick });
      } else send(c, { type: 'action', action: 'draw' });
    }
  } finally { c._acting = false; }
}
function startAutopilot(c) {
  const t = setInterval(() => { autoPrompt(c); autoPlay(c); }, 60);
  return t;
}

async function main() {
  const child = spawn('node', [path.join(__dirname, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await sleep(700);
  try {
    console.log('流程状态横幅测试：');
    const clients = [];
    const h = await mkClient(); clients.push(h);
    send(h, { type: 'createRoom', name: 'HOST', maxPlayers: 4 });
    const joinedH = await nextMsg(h, 'joined', 5000);
    for (let i = 2; i <= 4; i++) {
      const c = await mkClient(); clients.push(c);
      send(c, { type: 'joinRoom', roomCode: joinedH.roomCode, name: 'P' + i });
      await nextMsg(c, 'joined', 5000);
    }
    clients.forEach(c => send(c, { type: 'setReady', ready: true }));
    await sleep(200);
    send(h, { type: 'startGame', settings: { aiFill: true, aiSpeed: 0.3 } });
    await Promise.all(clients.map(c => nextMsg(c, 'state', 5000)));

    const autos = clients.map(startAutopilot);
    const t0 = Date.now();
    while (Date.now() - t0 < TIME) {
      await sleep(250);
      if (clients.some(c => c._closed)) break;
      // 四个玩家都见过非当前玩家视角的流程状态，且出现过决斗字段 → 提前结束
      const allNonCur = clients.every(c => c.nonCurrentFlows.size > 0);
      const anyDuelField = clients.some(c => c.msgs.some(m => m.type === 'state' && m.snapshot.duel));
      if (allNonCur && anyDuelField) break;
    }
    autos.forEach(t => clearInterval(t));

    ok(h.flows.size > 0 && clients[1].flows.size > 0, '双方都收到过流程状态（flow.text）');
    ok(clients.every(c => c.nonCurrentFlows.size > 0), '旁观玩家（非当前）也能看到进行中状态');

    const all = new Set();
    clients.forEach(c => c.flows.forEach(s => all.add(s)));
    const sample = [...all].slice(0, 6);
    console.log('  观察到的流程: ' + (sample.join(' | ') || '(无)'));

    // 检查有没有出现亮牌/决斗类流程
    let sawShowdown = false, sawDuel = false;
    all.forEach(s => {
      if (/亮牌|选对手/.test(s)) sawShowdown = true;
      if (/决斗/.test(s)) sawDuel = true;
    });
    ok(sawShowdown, '观察到亮牌/选对手类流程状态');
    ok(sawDuel, '观察到决斗类流程状态');

    // 决斗期间 snapshot.duel 应出现（客户端据此渲染"⚔ 决斗进行中"）
    let sawDuelField = false;
    for (const c of clients) for (const m of c.msgs) if (m.type === 'state' && m.snapshot.duel) sawDuelField = true;
    ok(sawDuelField, '决斗期间 snapshot.duel 存在（客户端渲染用）');
  } catch (e) {
    console.log('  ✘ 测试流程异常: ' + e.message);
    fail++;
  } finally {
    child.kill();
  }
  console.log('\n' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}
main();
