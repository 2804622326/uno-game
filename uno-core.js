(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.UNOCore = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = ['red', 'green', 'blue', 'yellow'];
  const COLOR_NAME = { red: '红', green: '绿', blue: '蓝', yellow: '黄' };
  const ACTION_TYPES = ['skip', 'reverse', 'draw2', 'draw2rev'];
  const HAND_LIMIT = 30;

  /* ---------- 牌堆构建 ---------- */
  function buildDeck() {
    const deck = [];
    for (const c of COLORS) {
      for (let i = 0; i < 8; i++) deck.push({ color: c, value: '0', type: 'number' }); // 机会0：每色8张，共32张
      for (let n = 1; n <= 9; n++) {
        deck.push({ color: c, value: String(n), type: 'number' });
        deck.push({ color: c, value: String(n), type: 'number' });
      }
      for (const a of ACTION_TYPES) {
        // +2 与转向+2 数量翻倍：每色各 4 张
        const n = (a === 'draw2' || a === 'draw2rev') ? 4 : 2;
        for (let k = 0; k < n; k++) deck.push({ color: c, value: a, type: 'action' });
      }
    }
    for (let i = 0; i < 4; i++) deck.push({ color: null, value: 'wild', type: 'wild' });
    for (let i = 0; i < 4; i++) deck.push({ color: null, value: 'wild4', type: 'wild4' });
    return deck; // 160
  }

  function shuffle(arr, rand) {
    const r = rand || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------- 卡牌判定 ---------- */
  function isWild(c) { return c.type === 'wild' || c.type === 'wild4'; }
  function isChanceZero(c) { return c.type === 'number' && c.value === '0'; }

  function valueOf(c) {
    if (c.type === 'number') return parseInt(c.value, 10) || 0;
    if (c.type === 'action') return 20;
    return 50;
  }

  // 比大小专用数值：数字牌按点数，功能牌（动作/万能）一律按 1
  function showdownValue(c) {
    if (c.type === 'number') return parseInt(c.value, 10) || 0;
    return 1;
  }

  function canPlay(card, activeColor, activeValue) {
    if (isWild(card)) return true;
    // 转向+2 与普通 +2 视为同值，可互相压
    if ((card.value === 'draw2' || card.value === 'draw2rev') &&
        (activeValue === 'draw2' || activeValue === 'draw2rev')) return true;
    return card.color === activeColor || card.value === activeValue;
  }

  // wild4 规则：手牌仍有当前颜色牌时不可打出
  function legalPlayable(card, hand, activeColor, activeValue) {
    if (card.type === 'wild4') {
      return !hand.some(c => !isWild(c) && c.color === activeColor);
    }
    return canPlay(card, activeColor, activeValue);
  }

  function playableIndexes(hand, activeColor, activeValue) {
    return hand.map((c, i) => legalPlayable(c, hand, activeColor, activeValue) ? i : -1)
      .filter(i => i >= 0);
  }

  /* ---------- 游戏状态 ---------- */
  function newGame(numPlayers) {
    const players = [];
    for (let i = 0; i < numPlayers; i++) {
      players.push({
        id: i,
        name: i === 0 ? '你' : 'AI ' + i,
        isAI: i !== 0,
        hand: [],
        score: 0,
        uno: false,          // 当前是否 1 张且未喊 UNO
        calledUno: false,    // 本回合是否已喊
      });
    }
    return {
      numPlayers,
      players,
      deck: [],
      discard: [],
      current: 0,
      dir: 1,
      activeColor: null,
      activeValue: null,
      round: 1,
      mode: 'idle',        // idle | play
      ponzi: null,         // { count }
      duel: null,          // { a, b, color, count, turn }
      ironChain: null,     // { a, b }
      chanceZeroPlaying: null,
      drawStack: null,     // { count, target } 接龙中的累计张数与被抓玩家
    };
  }

  function nextIndex(g, n) {
    n = n === undefined ? 1 : n;
    return (g.current + n * g.dir + g.numPlayers) % g.numPlayers;
  }

  function reshuffleDiscard(g) {
    if (g.deck.length > 0) return;
    if (g.discard.length <= 1) return;
    const top = g.discard.pop();
    g.deck = shuffle(g.discard.splice(0, g.discard.length));
    g.discard = [top];
  }

  /* 抽牌：处理洗牌、铁索连环保底共享、不幸13、庞氏 */
  function draw(g, idx, count, opts) {
    const o = opts || {};
    const drawn = [];
    const ponziWas = !!g.ponzi;
    for (let i = 0; i < count; i++) {
      reshuffleDiscard(g);
      if (g.deck.length === 0) break;
      const c = g.deck.pop();
      g.players[idx].hand.push(c);
      drawn.push(c);
    }
    // 铁索连环：链内任一人因惩罚抽牌，伙伴同抽，然后断链
    if (drawn.length > 0 && g.ironChain && !o.chainInProgress) {
      const ch = g.ironChain;
      if (idx === ch.a || idx === ch.b) {
        const partner = idx === ch.a ? ch.b : ch.a;
        const shared = draw(g, partner, drawn.length, { chainInProgress: true });
        for (const c of shared) drawn.push(c);
        g.ironChain = null;
        o._chainShared = { partner, count: drawn.length };
      }
    }
    // 庞氏骗局计数：惩罚抽牌也计入总抽牌数
    if (ponziWas && !o.ponziTrigger) {
      g.ponzi.count += drawn.length;
    }
    // 庞氏骗局结束：第一个被迫抽牌者抽累计 X 张
    if (ponziWas && o.ponziTrigger) {
      const X = g.ponzi.count + drawn.length;
      for (let i = 0; i < X; i++) {
        reshuffleDiscard(g);
        if (g.deck.length === 0) break;
        g.players[idx].hand.push(g.deck.pop());
      }
      o._ponziEnded = { X };
      g.ponzi = null;
    }
    // 不幸13：抽牌导致手牌恰为 13 张 → 再抽 13 张
    if (drawn.length > 0 && g.players[idx].hand.length === 13) {
      for (let i = 0; i < 13; i++) {
        reshuffleDiscard(g);
        if (g.deck.length === 0) break;
        g.players[idx].hand.push(g.deck.pop());
      }
      o._unlucky13 = true;
    }
    return drawn;
  }

  /* 庄家（触发 0 机会活动）时的对家 */
  function oppositeOf(g, idx) {
    const off = Math.round(g.numPlayers / 2);
    return (idx + off) % g.numPlayers;
  }

  /* ---------- 出牌主逻辑 ---------- */
  function playCard(g, idx, cardIdx, chosenColor) {
    const hand = g.players[idx].hand;
    const card = hand[cardIdx];
    if (!card) return { ok: false, error: '无效卡牌' };
    if (g.duel && idx !== g.duel.a && idx !== g.duel.b) {
      return { ok: false, error: '决斗进行中，其他玩家等待' };
    }
    // 决斗中禁止 +2（含转向+2），只能实打实出牌；+4 仍可打出
    if (g.duel && (card.value === 'draw2' || card.value === 'draw2rev')) {
      return { ok: false, error: '决斗中不能打出 +2' };
    }
    // 接龙中：目标玩家只能接 +2/+4（颜色任意，+4 不受限制）
    const inStackResponse = !g.duel && g.drawStack && g.drawStack.target === idx;
    if (inStackResponse) {
      if (!isDrawStackCard(card)) {
        return { ok: false, error: '接龙中只能打出 +2 或 +4' };
      }
    } else if (!legalPlayable(card, hand, g.activeColor, g.activeValue)) {
      return { ok: false, error: '这张牌不能打出' };
    }

    hand.splice(cardIdx, 1);
    const played = Object.assign({}, card);
    if (isWild(played) && chosenColor && COLORS.indexOf(chosenColor) >= 0) {
      played.color = chosenColor;
    }
    g.discard.push(played);
    g.activeColor = played.color;
    g.activeValue = played.value;

    const newLen = hand.length;
    g.players[idx].uno = newLen === 1 && !g.players[idx].calledUno;
    const isZero = isChanceZero(card);

    // 庞氏计数
    if (g.ponzi) g.ponzi.count++;
    // 决斗计数
    if (g.duel) g.duel.count++;

    const result = {
      ok: true,
      card: played,
      effects: { drew: [], skipped: null, reversed: false },
      win: newLen === 0,
      chanceZero: false,
      activity: null,
      next: null,
      message: '',
    };

    if (newLen === 0) {
      result.next = g.current; // 回合结束，结算在 UI
      return result;
    }

    if (g.duel) {
      const duel = g.duel;
      const other = idx === duel.a ? duel.b : duel.a;
      const eff = result.effects;
      if (card.value === 'reverse' && card.type === 'action') {
        g.dir *= -1;
        eff.reversed = true;
      } else if (card.value === 'skip') {
        eff.skipped = other;
      } else if (card.type === 'wild4') {
        const dopts = {};
        eff.drew = draw(g, other, 4, dopts);
        eff.skipped = other;
        eff.unlucky13 = dopts._unlucky13;
        eff.chainShared = dopts._chainShared || null;
      }
      g.current = other;
      result.next = other;
      result.message = '⚔ 决斗继续：' + g.players[other].name + ' 出牌';
      return result;
    }

    // 普通动作牌
    if (card.value === 'reverse' && card.type === 'action') {
      g.dir *= -1;
      result.effects.reversed = true;
      if (g.numPlayers === 2) {
        // 双人反转等同跳过
        const s = nextIndex(g, 1);
        result.effects.skipped = s;
        g.current = nextIndex(g, 2);
      } else {
        g.current = nextIndex(g, 1);
      }
    } else if (card.value === 'skip') {
      const s = nextIndex(g, 1);
      result.effects.skipped = s;
      g.current = nextIndex(g, 2);
    } else if (card.value === 'draw2rev') {
      // 转向+2：先反转方向，再进入/延续接龙（效果弹回出牌者）
      g.dir *= -1;
      result.effects.reversed = true;
      const N = stackValue(card);
      if (!g.drawStack) {
        g.drawStack = { count: N, target: nextIndex(g, 1) };
      } else {
        g.drawStack.count += N;
        g.drawStack.target = nextIndex(g, 1);
      }
      g.current = g.drawStack.target;
      result.stack = { count: g.drawStack.count, target: g.drawStack.target };
      result.message = '接龙：累计 ' + g.drawStack.count + ' 张，轮到 ' +
        g.players[g.current].name;
    } else if (inStackResponse || isDrawStackCard(card)) {
      // +2/+4：开启或延续接龙，暂不抽牌，等目标玩家决定
      const N = stackValue(card);
      if (!g.drawStack) {
        g.drawStack = { count: N, target: nextIndex(g, 1) };
      } else {
        g.drawStack.count += N;
        g.drawStack.target = nextIndex(g, 1);
      }
      g.current = g.drawStack.target;
      result.stack = { count: g.drawStack.count, target: g.drawStack.target };
      result.message = '接龙：累计 ' + g.drawStack.count + ' 张，轮到 ' +
        g.players[g.current].name;
    } else {
      g.current = nextIndex(g, 1);
    }

    if (isZero && !g.ponzi && !g.duel && !g.chanceZeroPlaying) {
      result.chanceZero = true;
      result.activity = pickActivity(g);
    }
    result.next = g.current;
    return result;
  }

  /* 随机挑选 8 种机会活动之一 */
  const ACTIVITIES = [
    'ponzi', 'poker', 'fire', 'lightning',
    'duel', 'iron', 'peach', 'harvest',
  ];
  function pickActivity(g, rand) {
    const r = rand || Math.random;
    return ACTIVITIES[Math.floor(r() * ACTIVITIES.length)];
  }

  /* ---------- 机会活动（纯结果计算，UI 负责编排） ---------- */

  // 德州扑克 / 火攻：双方亮牌比较
  // type: 'poker' 比数字（小者抽 max 张，平局无事）
  //       'fire'  比颜色（同色=拼点者抽4，异色=被拼点者抽4）
  function applyShowdown(g, type, aIdx, aCard, bIdx, bCard) {
    const out = { type, aIdx, bIdx, aCard, bCard, drawIdx: null, count: 0, detail: '' };
    const aVal = showdownValue(aCard), bVal = showdownValue(bCard);
    const aHas = g.players[aIdx].hand.length > 0;
    const bHas = g.players[bIdx].hand.length > 0;
    if (type === 'poker') {
      if (!aHas || !bHas) {
        const loser = !bHas ? bIdx : aIdx;
        out.drawIdx = loser; out.count = 4;
        out.detail = '对方无法亮牌，抽 4 张';
        draw(g, loser, 4);
        return out;
      }
      if (aVal === bVal) {
        out.detail = '平局，无事发生';
        return out;
      }
      const loser = aVal < bVal ? aIdx : bIdx;
      out.drawIdx = loser; out.count = Math.max(aVal, bVal);
      out.detail = (aVal < bVal ? g.players[aIdx].name : g.players[bIdx].name) +
        ' 点数较小，抽 ' + out.count + ' 张';
      draw(g, loser, out.count);
      return out;
    }
    // fire
    if (!aHas || !bHas) {
      const loser = !bHas ? bIdx : aIdx;
      out.drawIdx = loser; out.count = 3;
      out.detail = '对方无法亮牌，抽 3 张';
      draw(g, loser, 3);
      return out;
    }
    if (aCard.color === bCard.color) {
      out.drawIdx = aIdx; out.count = 4;
      out.detail = '颜色相同 → ' + g.players[aIdx].name + ' 抽 4 张';
      draw(g, aIdx, 4);
    } else {
      out.drawIdx = bIdx; out.count = 4;
      out.detail = '颜色不同 → ' + g.players[bIdx].name + ' 抽 4 张';
      draw(g, bIdx, 4);
    }
    return out;
  }

  // 闪电：掷两骰，点数决定目标与张数
  function applyLightning(g, idx, rand) {
    const r = rand || Math.random;
    const d1 = Math.floor(r() * 6) + 1;
    const d2 = Math.floor(r() * 6) + 1;
    let target = (idx + d1) % g.numPlayers;
    if (target === idx) target = (target + 1) % g.numPlayers;
    const count = d1 + d2;
    draw(g, target, count);
    return { d1, d2, target, count, idx };
  }

  // 铁索连环
  function applyIron(g, idx) {
    const partner = oppositeOf(g, idx);
    g.ironChain = { a: idx, b: partner };
    return { partner };
  }

  // 决斗开始
  function applyDuelStart(g, idx, color, target) {
    g.duel = { a: idx, b: target, color, count: 0, turn: target };
    g.current = target;
    return { target, color };
  }

  // 决斗中有人无法出牌 → 抽 count 张并结束决斗
  function duelDraw(g, idx) {
    const X = g.duel ? g.duel.count : 0;
    const drawn = draw(g, idx, X, { duelEnd: true });
    const d = g.duel;
    g.duel = null;
    g.current = nextIndex(g, 1);
    return { X, drawn, target: idx, was: d };
  }

  // 桃源结义：每人最多丢一半。AI 由 UI 选低价值牌。
  function pickLowestCards(hand, maxCount) {
    const idxs = hand.map((c, i) => i)
      .sort((a, b) => valueOf(hand[a]) - valueOf(hand[b]));
    return idxs.slice(0, maxCount);
  }

  // 丢弃指定牌（供桃源/五谷使用）
  function discardCards(g, idx, indexes) {
    const hand = g.players[idx].hand;
    const removed = [];
    const set = indexes.slice().sort((a, b) => b - a);
    for (const i of set) {
      if (i >= 0 && i < hand.length) removed.push(hand.splice(i, 1)[0]);
    }
    for (const c of removed) g.discard.push(c);
    return removed;
  }

  // 五谷丰登：丢弃指定颜色的所有牌
  function discardColorCards(g, idx, color) {
    const hand = g.players[idx].hand;
    const removed = [];
    for (let i = hand.length - 1; i >= 0; i--) {
      if (hand[i].color === color) removed.push(hand.splice(i, 1)[0]);
    }
    for (const c of removed) g.discard.push(c);
    return removed;
  }

  /* ---------- 计分与回合结算 ---------- */
  function scoreHand(hand) {
    return hand.reduce((s, c) => s + valueOf(c), 0);
  }

  // 任一玩家达到手牌上限后，按手牌数优先、手牌点数次优选出本轮赢家。
  function handLimitWinner(g) {
    if (!g.players.some(p => p.hand.length >= HAND_LIMIT)) return null;
    let winnerIdx = 0;
    for (let i = 1; i < g.players.length; i++) {
      const winner = g.players[winnerIdx];
      const candidate = g.players[i];
      const fewerCards = candidate.hand.length < winner.hand.length;
      const sameCards = candidate.hand.length === winner.hand.length;
      const lowerPoints = scoreHand(candidate.hand) < scoreHand(winner.hand);
      if (fewerCards || (sameCards && lowerPoints)) winnerIdx = i;
    }
    return winnerIdx;
  }

  function roundEnd(g, winnerIdx) {
    let pts = 0;
    const breakdown = [];
    g.players.forEach((p, i) => {
      if (i === winnerIdx) return;
      const v = scoreHand(p.hand);
      pts += v;
      breakdown.push({ name: p.name, v });
    });
    g.players[winnerIdx].score += pts;
    return { winner: winnerIdx, pts, breakdown };
  }

  function isGameOver(g) {
    return g.players.some(p => p.score >= 500);
  }

  /* ---------- AI 决策 ---------- */
  function chooseColorForAI(hand) {
    const counts = { red: 0, green: 0, blue: 0, yellow: 0 };
    for (const c of hand) if (c.color) counts[c.color]++;
    let best = 'red', bestN = -1;
    for (const k in counts) {
      if (counts[k] > bestN) { bestN = counts[k]; best = k; }
    }
    return best;
  }

  // 比大小（德州扑克/火攻）时挑手中数值最大的牌（功能牌按 1 计）
  function pickHighestCard(hand) {
    let best = 0, bestV = -1;
    hand.forEach(function (c, i) {
      const v = showdownValue(c);
      if (v > bestV) { bestV = v; best = i; }
    });
    return best;
  }

  // 返回 { index, color }，color 仅野牌需要
  // 策略：优先非野牌；高价值/动作牌优先；野牌留作最后手段；+4 尽量少用
  function aiDecide(hand, activeColor, activeValue) {
    const playable = playableIndexes(hand, activeColor, activeValue);
    if (playable.length === 0) return null;
    const normal = playable.filter(i => hand[i].type !== 'wild' && hand[i].type !== 'wild4');
    const pool = normal.length ? normal : playable;
    let best = pool[0], bestScore = -1;
    for (const i of pool) {
      const c = hand[i];
      let s = valueOf(c) * 100;
      if (c.type === 'action') s += 500;   // 动作牌优先
      if (c.type === 'wild4') s -= 500;    // +4 尽量保留
      s += (pool.length - i);              // 同分时靠前
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return { index: best, color: chooseColorForAI(hand) };
  }

  /* 可用工具 */
  function cardKey(c) {
    return (c.color || 'x') + ':' + c.value + ':' + c.type;
  }
  function countCardsOf(hand, color) {
    return hand.filter(c => c.color === color).length;
  }
  function hasPlayable(hand, activeColor, activeValue) {
    return playableIndexes(hand, activeColor, activeValue).length > 0;
  }

  // 决斗中可出的牌：排除 +2（含转向+2），+4 仍可出
  function duelPlayableIndexes(hand, activeColor, activeValue) {
    return playableIndexes(hand, activeColor, activeValue)
      .filter(i => hand[i].value !== 'draw2' && hand[i].value !== 'draw2rev');
  }

  /* ---------- 接龙（+2/+4 stacking） ---------- */
  function isDrawStackCard(c) {
    return (c.type === 'action' && (c.value === 'draw2' || c.value === 'draw2rev')) || c.type === 'wild4';
  }
  function stackValue(c) {
    return c.type === 'wild4' ? 4 : 2;
  }
  // 接龙中可打的牌：任意 +2/+4（不限颜色，+4 不受"有同色不能打"限制）
  function stackPlayableIndexes(hand) {
    return hand.map((c, i) => (isDrawStackCard(c) ? i : -1)).filter(i => i >= 0);
  }
  function hasStackPlayable(hand) {
    return hand.some(isDrawStackCard);
  }
  // 接龙决策：有 +2/+4 就接，优先出 +2 保留 +4；无牌可接返回 null
  function aiDecideStack(hand) {
    const idxs = stackPlayableIndexes(hand);
    if (idxs.length === 0) return null;
    let best = idxs[0];
    for (const i of idxs) {
      if (hand[i].type === 'wild4') continue; // 优先用 +2
      best = i;
      break;
    }
    return { index: best, color: chooseColorForAI(hand) };
  }
  // 接龙结算：目标玩家抓累计张数，被跳过，回合交给其下家
  function drawStack(g, idx) {
    if (!g.drawStack || idx !== g.drawStack.target) return { ok: false };
    const count = g.drawStack.count;
    // 接龙抓牌是强制抽牌：庞氏骗局进行时，第一个被迫抽牌者按累计数抽牌
    const dopts = { ponziTrigger: !!g.ponzi };
    const drew = draw(g, idx, count, dopts);
    const skipped = idx;
    g.drawStack = null;
    g.current = (idx + g.dir + g.numPlayers) % g.numPlayers;
    return {
      ok: true,
      count,
      drew,
      skipped,
      unlucky13: dopts._unlucky13,
      chainShared: dopts._chainShared || null,
      ponziEnded: dopts._ponziEnded || null,
      next: g.current,
    };
  }

  return {
    COLORS, COLOR_NAME, ACTION_TYPES, HAND_LIMIT,
    buildDeck, shuffle,
    newGame, deal, draw, playCard,
    nextIndex, oppositeOf,
    isWild, isChanceZero, valueOf, canPlay, legalPlayable,
    playableIndexes, hasPlayable, cardKey, countCardsOf,
    duelPlayableIndexes,
    isDrawStackCard, stackValue, stackPlayableIndexes, hasStackPlayable,
    aiDecideStack, drawStack,
    pickActivity, ACTIVITIES, showdownValue, pickHighestCard,
    applyShowdown, applyLightning, applyIron, applyDuelStart, duelDraw,
    pickLowestCards, discardCards, discardColorCards,
    scoreHand, handLimitWinner, roundEnd, isGameOver,
    chooseColorForAI, aiDecide,
  };

  /* ========== 发牌（放在 return 之前，因为 deal 需要在顶部定义） ========== */
  function deal(g) {
    g.deck = shuffle(buildDeck());
    g.discard = [];
    for (const p of g.players) { p.hand = []; p.uno = false; p.calledUno = false; }
    for (let i = 0; i < 7; i++) {
      for (const p of g.players) p.hand.push(g.deck.pop());
    }
    // 翻开首张非野牌（野牌放回牌堆重新翻）
    let top;
    do {
      if (g.deck.length === 0) break;
      top = g.deck.pop();
      if (isWild(top)) g.deck.unshift(top);
    } while (isWild(top));
    g.discard.push(top);
    g.activeColor = top.color;
    g.activeValue = top.value;
    g.current = 0;
    g.dir = 1;
    g.ponzi = null; g.duel = null; g.ironChain = null; g.chanceZeroPlaying = null;
    g.drawStack = null;
    // 首张为动作牌时应用效果
    if (top.type === 'action') {
      if (top.value === 'reverse') {
        g.dir = -1;
      } else if (top.value === 'skip') {
        g.current = nextIndex(g, 1);
      } else if (top.value === 'draw2') {
        // 开局 +2 也进入接龙
        g.drawStack = { count: 2, target: nextIndex(g, 1) };
        g.current = g.drawStack.target;
      } else if (top.value === 'draw2rev') {
        // 开局转向+2：先反转方向，再进入接龙
        g.dir = -1;
        g.drawStack = { count: 2, target: nextIndex(g, 1) };
        g.current = g.drawStack.target;
      }
    } else if (top.type === 'wild4') {
      // 开局 +4 也进入接龙
      g.drawStack = { count: 4, target: nextIndex(g, 1) };
      g.current = g.drawStack.target;
    }
    g.mode = 'play';
    return g;
  }
}));
