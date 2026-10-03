#!/usr/bin/env node
/* ================================================================
 * UNO 多人联机服务器（局域网 · 服务器权威）
 *
 * 用法：
 *   node server.js            # 默认 3000 端口
 *   PORT=8080 node server.js
 *
 * 职责：
 *   1. 静态托管 index.html / uno-core.js（浏览器直接访问本机 IP 即得页面）
 *   2. 房间管理（创建/加入/就绪/开局/断线/AI 补位）
 *   3. 持有权威游戏状态，用 UNOcore 校验并应用所有玩家指令
 *   4. 驱动回合流转（出牌/抽牌/过牌/选色/特殊规则），把渲染调用替换为广播
 *   5. AI 座位由服务器决策
 *
 * 通信协议见 docs/superpowers/specs/2026-08-01-uno-multiplayer-design.md
 * ================================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const UNOCore = require('./uno-core.js');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const ROOT = __dirname;

/* ---------------- 静态文件托管 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  // 只允许项目根目录下的常规文件，阻止敏感路径
  if (urlPath.includes('..') || urlPath.startsWith('/.')) { res.writeHead(403); res.end(); return; }
  const filePath = path.join(ROOT, urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocket.Server({ server });

/* ---------------- 房间模型 ---------------- */
const rooms = new Map(); // code -> room

function makeSeat(i) {
  return { seat: i, name: 'AI ' + (i + 1), ws: null, isAI: true, ready: false, connected: false };
}

function createRoom() {
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
  const room = {
    code,
    maxPlayers: 4,
    seats: null,       // 初始化时按 maxPlayers 生成
    hostSeat: 0,
    status: 'lobby',   // lobby | playing | over
    g: null,
    settings: { aiFill: true, aiSpeed: 1.2 },
    turnTimer: null,
    flowTimer: null,
    flowToken: 0,
    awaitingHuman: false,  // 当前是否为人类回合
    drewThisTurn: false,   // 当前玩家本回合是否已抽到可打出的牌
    flow: null,            // 交互式特殊流程 { name, forSeat, ... }
    unoMissing: new Set(), // 剩1张且未喊 UNO 的座位（真实座位号）
    roundOver: false,
  };
  room.seats = [];
  for (let i = 0; i < 4; i++) room.seats.push(makeSeat(i));
  rooms.set(code, room);
  return room;
}

function findRoomOf(ws) {
  for (const room of rooms.values()) {
    for (const s of room.seats) if (s && s.ws === ws) return { room, seat: s };
  }
  return null;
}

/* ---------------- 座位换算 ---------------- */
// 客户端视角：自己=索引0。view ⇄ real：view=(real-my)%n, real=(view+my)%n
function viewToReal(v, my, n) { return (v + my) % n; }
function realToView(r, my, n) { return ((r - my) % n + n) % n; }

/* ---------------- 发送助手 ---------------- */
function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function sendToSeat(room, seatIdx, obj) {
  const s = room.seats[seatIdx];
  if (s && s.ws) send(s.ws, obj);
}
function broadcast(room, obj) {
  for (const s of room.seats) if (s && s.ws) send(s.ws, obj);
}

/* 效果中的座位字段需按每客户端视角重映射 */
const SEAT_FIELDS = ['seat', 'partner', 'a', 'b', 'target', 'winner', 'drawIdx', 'aIdx', 'bIdx', 'idx'];
function remapEffect(effect, my, n) {
  const e = Object.assign({}, effect);
  for (const k of SEAT_FIELDS) if (typeof e[k] === 'number') e[k] = realToView(e[k], my, n);
  if (Array.isArray(e.perSeat)) e.perSeat = e.perSeat.map(x => Object.assign({}, x, { seat: realToView(x.seat, my, n) }));
  return e;
}
function emitEffects(room, effects) {
  const n = room.g.numPlayers;
  for (const s of room.seats) {
    if (!s || !s.ws) continue;
    const my = s.seat;
    send(s.ws, { type: 'effects', effects: effects.map(ef => remapEffect(ef, my, n)) });
  }
}
function emitMsg(room, text, kind) {
  broadcast(room, { type: 'message', text, kind: kind || null });
}

/* 交互流程的中文状态文案（供所有客户端展示"进行中"横幅） */
function flowStatusText(room) {
  const g = room.g, f = room.flow;
  if (!f || !g || !g.players[f.forSeat]) return null;
  const n = g.players[f.forSeat].name;
  switch (f.name) {
    case 'play-color': return '🎨 ' + n + ' 正在选颜色…';
    case 'showdown-target': return (f.type === 'poker' ? '🃏' : '🔥') + ' ' + n + ' 正在选对手…';
    case 'showdown-reveal-a': return (f.type === 'poker' ? '🃏' : '🔥') + ' ' + n + ' 正在亮牌…';
    case 'showdown-reveal-b': return (f.type === 'poker' ? '🃏' : '🔥') + ' 等待 ' + n + ' 亮牌…';
    case 'duel-color': return '⚔ ' + n + ' 正在选决斗颜色…';
    case 'duel-target': return '⚔ ' + n + ' 正在选决斗对手…';
    case 'peach': return '🍑 ' + n + ' 正在选丢弃的牌…';
    default: return '⏳ ' + n + ' 操作中…';
  }
}

/* 快照：每个客户端只看到自己的完整手牌，他人仅牌数；自己重排为索引0 */
function buildSnapshot(room, mySeat) {
  const g = room.g;
  const n = g.numPlayers;
  const viewPlayers = [];
  for (let v = 0; v < n; v++) {
    const real = viewToReal(v, mySeat, n);
    const p = g.players[real];
    const base = {
      name: p.name, score: p.score, uno: p.uno, calledUno: p.calledUno,
      isAI: p.isAI, isYou: real === mySeat, handCount: p.hand.length,
    };
    if (real === mySeat) base.hand = p.hand;
    else base.hand = null;
    viewPlayers.push(base);
  }
  const duel = g.duel ? {
    a: realToView(g.duel.a, mySeat, n),
    b: realToView(g.duel.b, mySeat, n),
    color: g.duel.color, count: g.duel.count,
    turn: realToView(g.duel.turn, mySeat, n),
  } : null;
  const iron = g.ironChain ? {
    a: realToView(g.ironChain.a, mySeat, n),
    b: realToView(g.ironChain.b, mySeat, n),
  } : null;
  const drawStack = g.drawStack ? {
    count: g.drawStack.count,
    target: realToView(g.drawStack.target, mySeat, n),
  } : null;
  return {
    numPlayers: n,
    current: realToView(g.current, mySeat, n),
    dir: g.dir,
    activeColor: g.activeColor,
    activeValue: g.activeValue,
    round: g.round,
    mode: g.mode,
    ponzi: g.ponzi,
    duel,
    flow: room.flow ? { name: room.flow.name, text: flowStatusText(room) } : null,
    ironChain: iron,
    drawStack,
    chanceZeroPlaying: g.chanceZeroPlaying,
    discard: g.discard.length ? [g.discard[g.discard.length - 1]] : [],
    deckCount: g.deck.length,
    unoMissing: Array.from(room.unoMissing).map(r => realToView(r, mySeat, n)),
    players: viewPlayers,
  };
}

function broadcastState(room) {
  for (const s of room.seats) {
    if (!s || !s.ws) continue;
    const my = s.seat;
    const g = room.g;
    let canAct = false, mustDraw = false, playDrawn = false;
    if (room.awaitingHuman && g && g.current === my) {
      canAct = true;
      const inStack = g.drawStack && g.drawStack.target === my;
      if (inStack) {
        // 接龙中：可出 +2/+4 或抓累计张数（两者皆可选）
        mustDraw = false;
        playDrawn = false;
      } else {
        const hasPlay = g.duel
          ? UNOCore.duelPlayableIndexes(g.players[my].hand, g.activeColor, g.activeValue).length > 0
          : UNOCore.hasPlayable(g.players[my].hand, g.activeColor, g.activeValue);
        if (room.drewThisTurn) playDrawn = true;
        else mustDraw = !hasPlay;
      }
    }
    send(s.ws, { type: 'state', snapshot: buildSnapshot(room, my), yourSeat: my, canAct, mustDraw, playDrawn });
  }
}

/* ---------------- 大厅消息 ---------------- */
function lobbyMsg(room) {
  return {
    type: 'lobby',
    lobby: {
      roomCode: room.code,
      status: room.status,
      maxPlayers: room.maxPlayers,
      hostSeat: room.hostSeat,
      settings: room.settings,
      seats: room.seats.map((s, i) => s ? {
        seat: i, name: s.name, isAI: s.isAI, ready: s.ready, connected: !!s.ws, isYou: false,
      } : null),
    },
  };
}
function broadcastLobby(room) {
  const base = lobbyMsg(room);
  room.seats.forEach((s, i) => {
    if (s && s.ws) {
      base.lobby.seats[i].isYou = true;
      send(s.ws, base);
      base.lobby.seats[i].isYou = false;
    }
  });
}

/* ---------------- 回合驱动（服务器权威，替换浏览器端的 beginTurn/aiTurn/...） ---------------- */

function othersOf(room, idx) {
  const arr = [];
  for (let i = 0; i < room.g.numPlayers; i++) if (i !== idx) arr.push(i);
  return arr;
}

function beginTurn(room) {
  console.log('[S] beginTurn current=' + room.g.current + ' ' + room.g.players[room.g.current].name);
  clearTimeout(room.turnTimer);
  clearTimeout(room.flowTimer);
  room.turnTimer = null;
  room.flowTimer = null;
  room.flowToken++;
  room.awaitingHuman = false;
  room.drewThisTurn = false;
  room.flow = null;
  const g = room.g;
  const cur = g.current;
  const seat = room.seats[cur];
  const inStack = g.drawStack && g.drawStack.target === cur;
  if (seat.isAI) {
    const delay = (room.settings.aiSpeed || 1.2) * 1000;
    room.turnTimer = setTimeout(() => aiTurn(room), delay);
  } else {
    room.awaitingHuman = true;
  }
  broadcastState(room);
  if (room.awaitingHuman) {
    if (inStack) {
      sendToSeat(room, cur, { type: 'message', text: '接龙中！可出 +2/+4 接龙，或抓 ' + g.drawStack.count + ' 张' });
    } else {
      const hasPlay = g.duel
        ? UNOCore.duelPlayableIndexes(g.players[cur].hand, g.activeColor, g.activeValue).length > 0
        : UNOCore.hasPlayable(g.players[cur].hand, g.activeColor, g.activeValue);
      sendToSeat(room, cur, { type: 'message', text: hasPlay ? '轮到你' : (g.duel ? '决斗中无法出牌，点击牌堆结束决斗' : '没有可出的牌，点击牌堆抽一张') });
    }
  }
}

/* 特殊活动统一串行，避免即时技能覆盖上一段提示或重复推进回合。 */
function scheduleFlowNext(room, fn, delay) {
  clearTimeout(room.flowTimer);
  const token = ++room.flowToken;
  room.flowTimer = setTimeout(() => {
    if (token !== room.flowToken) return;
    room.flowTimer = null;
    fn();
  }, delay);
}

function advance(room) {
  console.log('[S] advance from ' + room.g.current + ' to ' + UNOCore.nextIndex(room.g, 1));
  room.g.current = UNOCore.nextIndex(room.g, 1);
  beginTurn(room);
}

function aiTurn(room) {
  const g = room.g;
  const idx = g.current;
  // AI 捉漏喊 UNO 的人类玩家
  if (room.unoMissing.size > 0) {
    const humans = Array.from(room.unoMissing).filter(i => !g.players[i].isAI);
    if (humans.length && Math.random() < 0.4) {
      const target = humans[Math.floor(Math.random() * humans.length)];
      room.unoMissing.delete(target);
      g.players[target].calledUno = true; g.players[target].uno = false;
      UNOCore.draw(g, target, 2);
      emitEffects(room, [{ type: 'catchUno', seat: target, count: 2 }]);
      emitMsg(room, '🔔 AI 捉到 ' + g.players[target].name + ' 漏喊 UNO！罚抽 2 张');
      broadcastState(room);
      if (maybeHandLimitEnd(room)) return;
    }
  }
  const p = g.players[idx];
  // 接龙中：AI 有 +2/+4 就接，否则抓累计张数
  if (g.drawStack && g.drawStack.target === idx) {
    const dec = UNOCore.aiDecideStack(p.hand);
    if (dec) doPlay(room, idx, dec.index, dec.color);
    else doDrawStackFlow(room, idx);
    return;
  }
  if (g.duel) {
    const playable = UNOCore.duelPlayableIndexes(p.hand, g.activeColor, g.activeValue);
    if (playable.length === 0) { duelDrawFlow(room, idx); return; }
    const dec = UNOCore.aiDecideDuel(p.hand, g.activeColor, g.activeValue);
    doPlay(room, idx, dec.index, dec.color);
    return;
  }
  const dec = UNOCore.aiDecide(p.hand, g.activeColor, g.activeValue);
  if (dec) doPlay(room, idx, dec.index, dec.color);
  else doDraw(room, idx, false);
}

function handleUnoAfterPlay(room, idx, effects) {
  const g = room.g;
  const p = g.players[idx];
  if (p.hand.length === 1 && !p.calledUno) {
    if (p.isAI) {
      if (Math.random() < 0.85) {
        p.calledUno = true; p.uno = false;
        effects.push({ type: 'unoCalled', seat: idx });
      } else {
        room.unoMissing.add(idx);
      }
    } else {
      room.unoMissing.add(idx);
    }
  }
}

function maybeHandLimitEnd(room) {
  if (room.roundOver || room.status !== 'playing') return false;
  const winnerIdx = UNOCore.handLimitWinner(room.g);
  if (winnerIdx == null) return false;
  roundEndFlow(room, winnerIdx, 'hand-limit');
  return true;
}

function doPlay(room, idx, cardIdx, chosenColor) {
  console.log('[S] doPlay idx=' + idx + ' cardIdx=' + cardIdx + ' color=' + chosenColor);
  const g = room.g;
  const res = UNOCore.playCard(g, idx, cardIdx, chosenColor);
  if (!res.ok) {
    sendToSeat(room, idx, { type: 'error', message: res.error });
    return;
  }
  const eff = res.effects;
  const effects = [{ type: 'play', seat: idx, card: res.card }];
  if (eff.reversed) effects.push({ type: 'reverse' });
  if (eff.skipped != null) effects.push({ type: 'skip', seat: eff.skipped });
  if (eff.drew && eff.drew.length) effects.push({ type: 'draw', seat: eff.skipped, count: eff.drew.length });
  if (eff.chainShared) effects.push({ type: 'chainShared', partner: eff.chainShared.partner, count: eff.chainShared.count });
  if (eff.unlucky13) effects.push({ type: 'unlucky13', seat: eff.skipped });
  handleUnoAfterPlay(room, idx, effects);
  if (res.stack) emitMsg(room, '接龙！累计 ' + res.stack.count + ' 张，轮到 ' + g.players[g.current].name);

  emitEffects(room, effects);
  broadcastState(room);
  if (res.win) { roundEndFlow(room, idx, 'empty-hand'); return; }
  if (maybeHandLimitEnd(room)) return;
  if (res.chanceZero) {
    runChanceFlow(room, idx, res.activity);
    return;
  }
  beginTurn(room);
}

/* 接龙结算：目标玩家抓累计张数，被跳过，回合交给其下家 */
function doDrawStackFlow(room, idx) {
  const g = room.g;
  const res = UNOCore.drawStack(g, idx);
  emitEffects(room, [
    { type: 'draw', seat: idx, count: res.count },
    { type: 'skip', seat: idx },
  ]);
  if (res.ponziEnded) emitEffects(room, [{ type: 'ponziEnded', seat: idx, X: res.ponziEnded.X }]);
  if (res.unlucky13) emitEffects(room, [{ type: 'unlucky13', seat: idx, count: 13 }]);
  if (res.chainShared) emitEffects(room, [{ type: 'chainShared', partner: res.chainShared.partner, count: res.chainShared.count }]);
  emitMsg(room, g.players[idx].name + ' 抓了 ' + res.count + ' 张牌，被跳过');
  broadcastState(room);
  if (maybeHandLimitEnd(room)) return;
  beginTurn(room);
}

function doDraw(room, idx, isVoluntary) {
  console.log('[S] doDraw idx=' + idx);
  const g = room.g;
  // 接龙中：抓牌 = 抓累计张数
  if (g.drawStack && g.drawStack.target === idx) {
    doDrawStackFlow(room, idx);
    return;
  }
  const ponziTrigger = !!g.ponzi && !isVoluntary;
  const dopts = {};
  const drawn = UNOCore.draw(g, idx, 1, Object.assign({ ponziTrigger }, dopts));
  emitEffects(room, [{ type: 'draw', seat: idx, count: 1 }]);
  if (dopts._ponziEnded) emitEffects(room, [{ type: 'ponziEnded', seat: idx, X: dopts._ponziEnded.X }]);
  if (dopts._unlucky13) emitEffects(room, [{ type: 'unlucky13', seat: idx, count: 13 }]);
  if (dopts._chainShared) emitEffects(room, [{ type: 'chainShared', partner: dopts._chainShared.partner, count: dopts._chainShared.count }]);
  broadcastState(room);
  if (maybeHandLimitEnd(room)) return;

  if (dopts._ponziEnded) { advance(room); return; }
  if (g.duel) { duelDrawFlow(room, idx); return; }

  const p = g.players[idx];
  const playable = UNOCore.playableIndexes(p.hand, g.activeColor, g.activeValue);
  const canPlayDrawn = drawn.length === 1 && playable.includes(p.hand.length - 1);
  if (!g.players[idx].isAI) {
    if (canPlayDrawn) {
      room.awaitingHuman = true;
      room.drewThisTurn = true;
      broadcastState(room);
      emitMsg(room, '抽到的牌可以打出！点击它或结束回合');
      return;
    }
    advance(room);
    return;
  }
  // AI
  if (canPlayDrawn) {
    const dec = UNOCore.aiDecide(p.hand, g.activeColor, g.activeValue);
    room.turnTimer = setTimeout(() => doPlay(room, idx, dec.index, dec.color), 500);
  } else {
    advance(room);
  }
}

/* ---------- 机会活动 / 决斗 / 计分 / 捉 UNO（服务器版） ---------- */

function runChanceFlow(room, idx, activity) {
  const g = room.g;
  emitEffects(room, [{ type: 'chanceStart', seat: idx, activity }]);
  switch (activity) {
    case 'ponzi':
      g.ponzi = { count: 0 };
      emitMsg(room, '💸 庞氏骗局开始，继续出牌！');
      scheduleFlowNext(room, () => beginTurn(room), 1200);
      return;
    case 'lightning': {
      const r = UNOCore.applyLightning(g, idx);
      emitEffects(room, [{ type: 'lightning', d1: r.d1, d2: r.d2, target: r.target, count: r.count }]);
      emitMsg(room, '⚡ ' + g.players[r.target].name + ' 被雷劈中，抽 ' + r.count + ' 张牌！');
      if (maybeHandLimitEnd(room)) return;
      scheduleFlowNext(room, () => beginTurn(room), 2400);
      return;
    }
    case 'iron': {
      const r = UNOCore.applyIron(g, idx);
      emitEffects(room, [{ type: 'ironFormed', a: idx, b: r.partner }]);
      emitMsg(room, '⛓ 铁索连环：' + g.players[idx].name + ' 与 ' + g.players[r.partner].name + ' 形成风险共同体');
      scheduleFlowNext(room, () => beginTurn(room), 1200);
      return;
    }
    case 'peach':
      doPeach(room, idx);
      return;
    case 'harvest':
      doHarvest(room, idx);
      return;
    case 'duel':
      doDuelStart(room, idx);
      return;
    case 'poker':
    case 'fire':
      doShowdown(room, idx, activity);
      return;
    default:
      scheduleFlowNext(room, () => beginTurn(room), 1200);
  }
}

/* 闪电/铁索/庞氏/五谷 已经在上方内联处理 */

function doPeach(room, idx) {
  const order = [];
  for (let k = 0; k < room.g.numPlayers; k++) order.push((idx + k) % room.g.numPlayers);
  peachStep(room, order, 0);
}

function peachStep(room, order, step) {
  const g = room.g;
  if (step >= order.length) { scheduleFlowNext(room, () => beginTurn(room), 1200); return; }
  const pIdx = order[step];
  const p = g.players[pIdx];
  const maxC = Math.floor(p.hand.length / 2);
  if (maxC <= 0) {
    scheduleFlowNext(room, () => peachStep(room, order, step + 1), 400);
    return;
  }
  if (p.isAI) {
    const picks = UNOCore.pickLowestCards(p.hand, maxC);
    const removed = UNOCore.discardCards(g, pIdx, picks);
    emitEffects(room, [{ type: 'peachDiscard', seat: pIdx, count: removed.length }]);
    emitMsg(room, '🍑 ' + p.name + ' 丢弃 ' + removed.length + ' 张');
    broadcastState(room);
    scheduleFlowNext(room, () => peachStep(room, order, step + 1), 900);
    return;
  }
  room.flow = { name: 'peach', order, step, forSeat: pIdx, maxC };
  broadcastState(room);
  sendToSeat(room, pIdx, { type: 'prompt', prompt: { kind: 'peach', maxC, hand: p.hand } });
}

function doHarvest(room, idx) {
  const g = room.g;
  const color = g.activeColor;
  if (!color) { beginTurn(room); return; }
  const perSeat = [];
  let total = 0;
  for (let i = 0; i < g.numPlayers; i++) {
    const removed = UNOCore.discardColorCards(g, i, color);
    perSeat.push({ seat: i, count: removed.length });
    total += removed.length;
  }
  emitMsg(room, '🌾 五谷丰登：所有人丢出 ' + UNOCore.COLOR_NAME[color] + ' 色牌，共 ' + total + ' 张');
  emitEffects(room, [{ type: 'harvest', color, perSeat, total }]);
  broadcastState(room);
  scheduleFlowNext(room, () => beginTurn(room), 1600);
}

function doDuelStart(room, idx) {
  const g = room.g;
  if (g.players[idx].isAI) {
    const others = othersOf(room, idx);
    const target = others[Math.floor(Math.random() * others.length)];
    const color = UNOCore.chooseColorForAI(g.players[idx].hand);
    UNOCore.applyDuelStart(g, idx, color, target);
    emitEffects(room, [{ type: 'duelStart', a: idx, b: target, color }]);
    emitMsg(room, '⚔ ' + g.players[idx].name + ' 发起决斗！起手：' + UNOCore.COLOR_NAME[color] + '色');
    broadcastState(room);
    scheduleFlowNext(room, () => beginTurn(room), 1400);
    return;
  }
  room.flow = { name: 'duel-color', forSeat: idx };
  broadcastState(room);
  sendToSeat(room, idx, { type: 'prompt', prompt: { kind: 'duelColor' } });
}

function doShowdown(room, idx, type) {
  const g = room.g;
  if (g.players[idx].isAI) {
    const others = othersOf(room, idx);
    const target = others[Math.floor(Math.random() * others.length)];
    const ci = UNOCore.pickHighestCard(g.players[idx].hand);
    showdownAskReveal(room, { type, a: idx, b: target, aCardIdx: ci });
    return;
  }
  room.flow = { name: 'showdown-target', forSeat: idx, type };
  broadcastState(room);
  sendToSeat(room, idx, {
    type: 'prompt',
    prompt: { kind: 'target', type, seats: othersOf(room, idx).map(s => realToView(s, idx, g.numPlayers)) },
  });
}

/* 双方亮牌：先亮触发者，再亮被拼点者 */
function showdownAskReveal(room, info) {
  const g = room.g;
  if (info.aCardIdx == null) {
    // 触发者亮牌
    room.flow = { name: 'showdown-reveal-a', forSeat: info.a, type: info.type, b: info.b };
    if (g.players[info.a].isAI) {
      const ci = UNOCore.pickHighestCard(g.players[info.a].hand);
      showdownAskReveal(room, Object.assign({}, info, { aCardIdx: ci }));
      return;
    }
    broadcastState(room);
    sendToSeat(room, info.a, { type: 'prompt', prompt: { kind: 'reveal', hand: g.players[info.a].hand } });
    return;
  }
  // 被拼点者亮牌
  room.flow = { name: 'showdown-reveal-b', forSeat: info.b, type: info.type, a: info.a, aCardIdx: info.aCardIdx };
  if (g.players[info.b].isAI) {
    const bi = UNOCore.pickHighestCard(g.players[info.b].hand);
    finishShowdown(room, Object.assign({}, info, { bCardIdx: bi }));
    return;
  }
  broadcastState(room);
  sendToSeat(room, info.b, { type: 'prompt', prompt: { kind: 'reveal', hand: g.players[info.b].hand } });
}

function finishShowdown(room, info) {
  const g = room.g;
  const { type, a, b, aCardIdx, bCardIdx } = info;
  const aCard = g.players[a].hand[aCardIdx];
  const bCard = g.players[b].hand[bCardIdx];
  const res = UNOCore.applyShowdown(g, type, a, aCard, b, bCard);
  emitEffects(room, [{
    type: 'showdown', a, b, aCard, bCard,
    detail: res.detail, drawIdx: res.drawIdx, count: res.count,
  }]);
  broadcastState(room);
  if (maybeHandLimitEnd(room)) return;
  scheduleFlowNext(room, () => beginTurn(room), 2600);
}

function duelDrawFlow(room, idx) {
  const g = room.g;
  const info = UNOCore.duelDraw(g, idx);
  emitEffects(room, [{ type: 'draw', seat: idx, count: info.X }, { type: 'duelEnd', seat: idx, X: info.X }]);
  emitMsg(room, '⚔ 决斗结束：' + g.players[idx].name + ' 无法出牌，抽 ' + info.X + ' 张');
  broadcastState(room);
  if (maybeHandLimitEnd(room)) return;
  scheduleFlowNext(room, () => beginTurn(room), 1400);
}

function roundEndFlow(room, winnerIdx, reason) {
  const g = room.g;
  const res = UNOCore.roundEnd(g, winnerIdx);
  emitEffects(room, [{
    type: 'roundEnd',
    winner: winnerIdx,
    pts: res.pts,
    breakdown: res.breakdown,
    scores: g.players.map(p => ({ name: p.name, score: p.score })),
    reason: reason || 'empty-hand',
    handLimit: reason === 'hand-limit' ? UNOCore.HAND_LIMIT : null,
    winnerHandCount: g.players[winnerIdx].hand.length,
    winnerHandPoints: UNOCore.scoreHand(g.players[winnerIdx].hand),
  }]);
  // 广播 canAct=false 的状态，防止玩家在结算窗口继续操作；
  // 客户端只在轮次推进时关闭结算弹窗
  room.awaitingHuman = false;
  room.drewThisTurn = false;
  broadcastState(room);
  if (UNOCore.isGameOver(g)) {
    room.status = 'over';
    const gw = g.players.find(p => p.score >= 500);
    emitEffects(room, [{ type: 'gameOver', winner: gw ? gw.id : winnerIdx }]);
    emitMsg(room, '🏆 游戏结束，8 秒后返回大厅');
    room.turnTimer = setTimeout(() => resetToLobby(room), 8000);
    return;
  }
  room.roundOver = true;
  room.turnTimer = setTimeout(() => nextRound(room), 6000);
}

function nextRound(room) {
  const g = room.g;
  room.roundOver = false;
  g.round++;
  UNOCore.deal(g);
  room.unoMissing = new Set();
  emitEffects(room, [{ type: 'deal' }]);
  beginTurn(room);
}

function resetToLobby(room) {
  room.status = 'lobby';
  room.g = null;
  room.flow = null;
  room.roundOver = false;
  room.unoMissing = new Set();
  clearTimeout(room.turnTimer);
  clearTimeout(room.flowTimer);
  room.turnTimer = null;
  room.flowTimer = null;
  room.flowToken++;
  for (const s of room.seats) if (s && s.ws) s.ready = false;
  broadcastLobby(room);
}

/* 断线时把待决断的提示按 AI 补位逻辑自动处理 */
function resolvePromptAsAI(room, seat) {
  const g = room.g;
  const flow = room.flow;
  if (!flow) return;
  switch (flow.name) {
    case 'play-color':
      room.flow = null;
      doPlay(room, flow.seat, flow.cardIdx, UNOCore.chooseColorForAI(g.players[seat].hand));
      return;
    case 'showdown-target': {
      const others = othersOf(room, seat);
      const b = others[Math.floor(Math.random() * others.length)];
      room.flow = null;
      showdownAskReveal(room, { type: flow.type, a: seat, b, aCardIdx: null });
      return;
    }
    case 'showdown-reveal-a': {
      const ci = UNOCore.pickHighestCard(g.players[seat].hand);
      room.flow = null;
      showdownAskReveal(room, { type: flow.type, a: seat, b: flow.b, aCardIdx: ci });
      return;
    }
    case 'showdown-reveal-b': {
      const bi = UNOCore.pickHighestCard(g.players[seat].hand);
      room.flow = null;
      finishShowdown(room, { type: flow.type, a: flow.a, b: seat, aCardIdx: flow.aCardIdx, bCardIdx: bi });
      return;
    }
    case 'duel-color':
      room.flow = { name: 'duel-target', forSeat: seat, color: UNOCore.chooseColorForAI(g.players[seat].hand) };
      doDuelTargetChoice(room, seat, room.flow.color);
      return;
    case 'duel-target':
      doDuelTargetChoice(room, seat, flow.color);
      return;
    case 'peach': {
      const picks = UNOCore.pickLowestCards(g.players[seat].hand, flow.maxC);
      UNOCore.discardCards(g, seat, picks);
      emitEffects(room, [{ type: 'peachDiscard', seat, count: picks.length }]);
      emitMsg(room, '🍑 ' + g.players[seat].name + ' 丢弃 ' + picks.length + ' 张');
      room.flow = null;
      broadcastState(room);
      peachStep(room, flow.order, flow.step + 1);
      return;
    }
    default:
      room.flow = null;
      scheduleFlowNext(room, () => beginTurn(room), 1200);
  }
}

function doDuelTargetChoice(room, seat, color) {
  const g = room.g;
  const others = othersOf(room, seat);
  if (g.players[seat].isAI) {
    const target = others[Math.floor(Math.random() * others.length)];
    UNOCore.applyDuelStart(g, seat, color, target);
    emitEffects(room, [{ type: 'duelStart', a: seat, b: target, color }]);
    emitMsg(room, '⚔ ' + g.players[seat].name + ' 发起决斗！起手：' + UNOCore.COLOR_NAME[color] + '色');
    broadcastState(room);
    scheduleFlowNext(room, () => beginTurn(room), 1400);
    return;
  }
  room.flow = { name: 'duel-target', forSeat: seat, color };
  broadcastState(room);
  sendToSeat(room, seat, { type: 'prompt', prompt: { kind: 'duelTarget', color, seats: others.map(s => realToView(s, seat, room.g.numPlayers)) } });
}

/* ---------------- 消息处理 ---------------- */

function handleMessage(ws, msg) {
  if (!msg || typeof msg.type !== 'string') return;
  const conn = findRoomOf(ws);
  const room = conn ? conn.room : null;
  const seat = conn ? conn.seat : null;

  switch (msg.type) {
    case 'createRoom': {
      if (room) { send(ws, { type: 'error', message: '你已在一个房间中' }); return; }
      const maxPlayers = Math.max(2, Math.min(6, parseInt(msg.maxPlayers, 10) || 4));
      const r = createRoom();
      r.maxPlayers = maxPlayers;
      r.seats = [];
      for (let i = 0; i < maxPlayers; i++) r.seats.push(makeSeat(i));
      const s = r.seats[0];
      s.name = (msg.name || '玩家').slice(0, 12);
      s.ws = ws; s.isAI = false; s.connected = true; s.ready = true;
      r.hostSeat = 0;
      send(ws, { type: 'joined', roomCode: r.code, seat: 0, host: true });
      broadcastLobby(r);
      return;
    }
    case 'joinRoom': {
      if (room) { send(ws, { type: 'error', message: '你已在一个房间中' }); return; }
      const code = String(msg.roomCode || '').trim();
      const r = rooms.get(code);
      if (!r) { send(ws, { type: 'error', message: '房间不存在' }); return; }
      if (r.status !== 'lobby') { send(ws, { type: 'error', message: '游戏进行中，无法加入' }); return; }
      const name = (msg.name || '玩家').slice(0, 12);
      // 重连：名字匹配的空座
      let target = null;
      for (const s of r.seats) {
        if (s && s.ws === null && !s.isAI && s.name === name) { target = s; break; }
      }
      if (!target) {
        for (const s of r.seats) {
          if (s && s.ws === null && s.isAI) { target = s; break; }
        }
      }
      if (!target) { send(ws, { type: 'error', message: '房间已满' }); return; }
      target.name = name; target.ws = ws; target.isAI = false; target.connected = true; target.ready = false;
      send(ws, { type: 'joined', roomCode: r.code, seat: target.seat, host: false });
      broadcastLobby(r);
      return;
    }
    case 'setReady': {
      if (!room || !seat) return;
      if (room.status !== 'lobby') { send(ws, { type: 'error', message: '游戏已开始' }); return; }
      seat.ready = !!msg.ready;
      broadcastLobby(room);
      return;
    }
    case 'startGame': {
      if (!room || !seat) return;
      if (seat.seat !== room.hostSeat) { send(ws, { type: 'error', message: '只有房主可以开始游戏' }); return; }
      if (room.status !== 'lobby') { send(ws, { type: 'error', message: '游戏已开始' }); return; }
      const settings = msg.settings || {};
      if (typeof settings.aiSpeed === 'number' && settings.aiSpeed > 0) room.settings.aiSpeed = settings.aiSpeed;
      if (typeof settings.aiFill === 'boolean') room.settings.aiFill = settings.aiFill;
      const aiFill = room.settings.aiFill;
      let humans = 0;
      for (const s of room.seats) if (s && s.ws) humans++;
      if (humans < 2 && !aiFill) { send(ws, { type: 'error', message: '至少需要 2 名玩家，或开启 AI 补位' }); return; }
      if (humans < 2) { send(ws, { type: 'error', message: '至少需要 2 名玩家加入' }); return; }
      const allReady = room.seats.every(s => !s || !s.ws || s.ready);
      if (!allReady) { send(ws, { type: 'error', message: '还有玩家未就绪' }); return; }
      startGame(room);
      return;
    }
    case 'leaveRoom': {
      if (!room || !seat) return;
      leaveSeat(room, seat, ws);
      return;
    }
    case 'action': {
      if (!room || !seat) return;
      handleAction(room, seat, ws, msg);
      return;
    }
    case 'choice': {
      if (!room || !seat) return;
      handleChoice(room, seat, ws, msg);
      return;
    }
    default:
      send(ws, { type: 'error', message: '未知消息类型' });
  }
}

function startGame(room) {
  const g = UNOCore.newGame(room.maxPlayers);
  room.seats.forEach((s, i) => {
    if (!s) return;
    const isHuman = !!s.ws;
    s.isAI = !isHuman;
    s.connected = !!s.ws;
    s.ready = false;
    if (s.isAI) s.name = 'AI ' + (i + 1);
    g.players[i].name = s.name;
    g.players[i].isAI = s.isAI;
  });
  room.g = g;
  clearTimeout(room.turnTimer);
  clearTimeout(room.flowTimer);
  room.turnTimer = null;
  room.flowTimer = null;
  room.flowToken++;
  room.flow = null;
  room.unoMissing = new Set();
  room.roundOver = false;
  room.status = 'playing';
  UNOCore.deal(g);
  emitEffects(room, [{ type: 'deal' }]);
  beginTurn(room);
}

function handleAction(room, seat, ws, msg) {
  const g = room.g;
  if (room.status !== 'playing' || !g) { send(ws, { type: 'error', message: '游戏未开始' }); return; }
  if (room.roundOver) { send(ws, { type: 'error', message: '本轮已结束' }); return; }
  switch (msg.action) {
    case 'callUno': {
      const p = g.players[seat.seat];
      if (p.hand.length === 1 && !p.calledUno) {
        p.calledUno = true; p.uno = false;
        room.unoMissing.delete(seat.seat);
        emitEffects(room, [{ type: 'unoCalled', seat: seat.seat }]);
        emitMsg(room, 'UNO!');
        broadcastState(room);
      }
      return;
    }
    case 'catchUno': {
      const targetReal = (msg.seat == null) ? null : viewToReal(msg.seat, seat.seat, g.numPlayers);
      if (targetReal == null || !room.unoMissing.has(targetReal)) {
        send(ws, { type: 'error', message: '没有可捉的漏喊玩家' });
        return;
      }
      room.unoMissing.delete(targetReal);
      g.players[targetReal].calledUno = true; g.players[targetReal].uno = false;
      UNOCore.draw(g, targetReal, 2);
      emitEffects(room, [{ type: 'catchUno', seat: targetReal, count: 2 }]);
      emitMsg(room, '🔔 捉到 ' + g.players[targetReal].name + ' 漏喊 UNO，罚抽 2 张');
      broadcastState(room);
      maybeHandLimitEnd(room);
      return;
    }
    case 'play': {
      if (room.flow) { console.log('[DBG] action blocked by flow:', JSON.stringify(room.flow), 'seat=', seat.seat, 'action=', msg.action); send(ws, { type: 'error', message: '正在进行特殊流程，请稍候' }); return; }
      if (g.current !== seat.seat) { send(ws, { type: 'error', message: '还没轮到你' }); return; }
      if (g.duel && g.current !== g.duel.a && g.current !== g.duel.b) { send(ws, { type: 'error', message: '决斗进行中，其他玩家等待' }); return; }
      const card = g.players[seat.seat].hand[msg.cardIdx];
      if (!card) { send(ws, { type: 'error', message: '无效卡牌' }); return; }
      room.awaitingHuman = false;
      if ((card.type === 'wild' || card.type === 'wild4') && !msg.color) {
        room.flow = { name: 'play-color', forSeat: seat.seat, seat: seat.seat, cardIdx: msg.cardIdx };
        broadcastState(room);
        sendToSeat(room, seat.seat, { type: 'prompt', prompt: { kind: 'color' } });
        return;
      }
      doPlay(room, seat.seat, msg.cardIdx, msg.color || null);
      return;
    }
    case 'draw': {
      if (room.flow) { console.log('[DBG] action blocked by flow:', JSON.stringify(room.flow), 'seat=', seat.seat, 'action=', msg.action); send(ws, { type: 'error', message: '正在进行特殊流程，请稍候' }); return; }
      if (g.current !== seat.seat) { send(ws, { type: 'error', message: '还没轮到你' }); return; }
      if (room.drewThisTurn) { send(ws, { type: 'error', message: '本回合已抽过牌' }); return; }
      room.awaitingHuman = false;
      if (g.drawStack && g.drawStack.target === seat.seat) {
        doDrawStackFlow(room, seat.seat);
        return;
      }
      if (g.duel) { duelDrawFlow(room, seat.seat); return; }
      const hasPlay = UNOCore.hasPlayable(g.players[seat.seat].hand, g.activeColor, g.activeValue);
      doDraw(room, seat.seat, hasPlay);
      return;
    }
    case 'pass': {
      if (room.flow) { console.log('[DBG] action blocked by flow:', JSON.stringify(room.flow), 'seat=', seat.seat, 'action=', msg.action); send(ws, { type: 'error', message: '正在进行特殊流程，请稍候' }); return; }
      if (g.current !== seat.seat) { send(ws, { type: 'error', message: '还没轮到你' }); return; }
      if (!room.drewThisTurn) { send(ws, { type: 'error', message: '只有抽到可打出的牌后才能过牌' }); return; }
      advance(room);
      return;
    }
    default:
      send(ws, { type: 'error', message: '未知操作' });
  }
}

function handleChoice(room, seat, ws, msg) {
  console.log('[S] choice from ' + seat.seat + ': ' + JSON.stringify(msg.choice) + ' flow=' + (room.flow && room.flow.name));
  const flow = room.flow;
  const c = msg.choice || {};
  if (!flow) { console.log('[DBG] choice rejected no flow: chooser=', seat.seat, 'choice=', JSON.stringify(c)); send(ws, { type: 'error', message: '当前没有需要你选择的事项' }); return; }
  if (flow.forSeat !== seat.seat) { console.log('[DBG] choice rejected forSeat mismatch: flow=', JSON.stringify(flow), 'chooser=', seat.seat); send(ws, { type: 'error', message: '不是你的选择' }); return; }
  const g = room.g;
  switch (flow.name) {
    case 'play-color': {
      if (c.kind !== 'color' || !c.color) { send(ws, { type: 'error', message: '请选择颜色' }); return; }
      room.flow = null;
      doPlay(room, flow.seat, flow.cardIdx, c.color);
      return;
    }
    case 'showdown-target': {
      if (c.kind !== 'target' || c.seat == null) { send(ws, { type: 'error', message: '请选择对手' }); return; }
      const b = viewToReal(c.seat, seat.seat, g.numPlayers);
      room.flow = null;
      showdownAskReveal(room, { type: flow.type, a: seat.seat, b, aCardIdx: null });
      return;
    }
    case 'showdown-reveal-a': {
      if (c.kind !== 'reveal' || c.cardIdx == null) { send(ws, { type: 'error', message: '请选择要亮的牌' }); return; }
      room.flow = null;
      showdownAskReveal(room, { type: flow.type, a: seat.seat, b: flow.b, aCardIdx: c.cardIdx });
      return;
    }
    case 'showdown-reveal-b': {
      if (c.kind !== 'reveal' || c.cardIdx == null) { send(ws, { type: 'error', message: '请选择要亮的牌' }); return; }
      room.flow = null;
      finishShowdown(room, { type: flow.type, a: flow.a, b: seat.seat, aCardIdx: flow.aCardIdx, bCardIdx: c.cardIdx });
      return;
    }
    case 'duel-color': {
      if (c.kind !== 'duelColor' || !c.color) { send(ws, { type: 'error', message: '请选择决斗颜色' }); return; }
      room.flow = { name: 'duel-target', forSeat: seat.seat, color: c.color };
      broadcastState(room);
      sendToSeat(room, seat.seat, { type: 'prompt', prompt: { kind: 'duelTarget', color: c.color, seats: othersOf(room, seat.seat) } });
      return;
    }
    case 'duel-target': {
      if (c.kind !== 'duelTarget' || c.seat == null) { send(ws, { type: 'error', message: '请选择对手' }); return; }
      const target = viewToReal(c.seat, seat.seat, g.numPlayers);
      room.flow = null;
      UNOCore.applyDuelStart(g, seat.seat, flow.color, target);
      emitEffects(room, [{ type: 'duelStart', a: seat.seat, b: target, color: flow.color }]);
      emitMsg(room, '⚔ ' + g.players[seat.seat].name + ' 发起决斗！起手：' + UNOCore.COLOR_NAME[flow.color] + '色');
      broadcastState(room);
      scheduleFlowNext(room, () => beginTurn(room), 1400);
      return;
    }
    case 'peach': {
      if (c.kind !== 'peach' || !Array.isArray(c.indexes)) { send(ws, { type: 'error', message: '请选择要丢弃的牌' }); return; }
      if (c.indexes.length > flow.maxC) { send(ws, { type: 'error', message: '最多丢弃 ' + flow.maxC + ' 张' }); return; }
      const removed = UNOCore.discardCards(g, seat.seat, c.indexes);
      emitEffects(room, [{ type: 'peachDiscard', seat: seat.seat, count: removed.length }]);
      emitMsg(room, '🍑 ' + g.players[seat.seat].name + ' 丢弃 ' + removed.length + ' 张');
      room.flow = null;
      broadcastState(room);
      peachStep(room, flow.order, flow.step + 1);
      return;
    }
    default:
      send(ws, { type: 'error', message: '未知选择' });
  }
}

function leaveSeat(room, seat, ws) {
  seat.ws = null;
  seat.connected = false;
  if (room.status === 'playing') {
    // 断线由 AI 接管（handleDisconnect 共用）
    seat.isAI = true;
    room.g.players[seat.seat].isAI = true;
    if (room.flow && room.flow.forSeat === seat.seat) resolvePromptAsAI(room, seat.seat);
    else if (room.awaitingHuman && room.g.current === seat.seat) {
      room.awaitingHuman = false;
      clearTimeout(room.turnTimer);
      beginTurn(room);
    }
    broadcastState(room);
  }
  // 房主离开 → 移交主机权限给第一个仍在线的座位
  if (room.hostSeat < 0 || !room.seats[room.hostSeat] || !room.seats[room.hostSeat].ws) {
    const nextHost = room.seats.find(s => s && s.ws);
    room.hostSeat = nextHost ? nextHost.seat : -1;
  }
  if (room.status === 'lobby') {
    seat.isAI = true;
    seat.name = 'AI ' + (seat.seat + 1);
    broadcastLobby(room);
  }
  // 无人在线则销毁房间
  const anyWs = room.seats.some(s => s && s.ws);
  if (!anyWs) {
    clearTimeout(room.turnTimer);
    clearTimeout(room.flowTimer);
    rooms.delete(room.code);
  }
}

/* ---------------- 连接 / 断线 ---------------- */
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    handleMessage(ws, msg);
  });
  ws.on('close', () => {
    const conn = findRoomOf(ws);
    if (conn) leaveSeat(conn.room, conn.seat, ws);
  });
  ws.on('error', () => {});
});

// 心跳：清理死连接
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

/* ---------------- 启动 ---------------- */
function lanIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const iface of ifs[name]) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

server.listen(PORT, () => {
  console.log('==============================================');
  console.log('  UNO 多人联机服务器已启动');
  console.log('  本机访问:   http://localhost:' + PORT);
  const ips = lanIPs();
  for (const ip of ips) console.log('  局域网访问: http://' + ip + ':' + PORT);
  console.log('  让同局域网的朋友打开上面的地址加入你');
  console.log('==============================================');
  console.log('  Ctrl+C 停止');
});

process.on('SIGINT', () => { clearInterval(heartbeat); process.exit(0); });
process.on('SIGTERM', () => { clearInterval(heartbeat); process.exit(0); });
