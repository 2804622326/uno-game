#!/usr/bin/env node
/* 核心逻辑单元测试：直接加载共享模块 uno-core.js */
const U = require('./uno-core.js');
if (!U) { console.error('FAIL: UNOCore 未导出'); process.exit(1); }

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✔ ' + name);
  } catch (err) {
    fail++;
    console.log('  ✘ ' + name + '\n     ' + err.message);
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || (a + ' !== ' + b));
}
function ok(v, msg) { if (!v) throw new Error(msg || 'falsy'); }
function seeded() {
  let x = 12345;
  return function () { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
}

console.log('核心逻辑测试：');

t('牌堆：160 张，0 牌 32 张，颜色/类型数量正确', () => {
  const d = U.buildDeck();
  eq(d.length, 160, '总数 ' + d.length);
  for (const c of ['red', 'green', 'blue', 'yellow']) {
    const col = d.filter(x => x.color === c);
    eq(col.length, 38, c + ' 应有38张, 实际' + col.length);
    eq(col.filter(x => x.type === 'number').length, 26, c + ' 数字牌26');
    eq(col.filter(x => x.type === 'action').length, 12, c + ' 动作牌12');
    eq(col.filter(x => x.value === 'draw2').length, 4, c + ' +2每色4张');
    eq(col.filter(x => x.value === 'draw2rev').length, 4, c + ' 转向+2每色4张');
    eq(col.filter(x => x.value === '0').length, 8, c + ' 0牌8');
  }
  eq(d.filter(x => x.type === 'wild').length, 4, 'wild 4');
  eq(d.filter(x => x.type === 'wild4').length, 4, 'wild4 4');
  eq(d.filter(x => x.type === 'number' && x.value === '0').length, 32, '0牌共32张');
});

t('洗牌：种子随机可复现且含全部牌', () => {
  const a = U.buildDeck(), b = U.buildDeck();
  U.shuffle(a, seeded());
  const c = U.buildDeck();
  U.shuffle(c, seeded());
  eq(a.map(x => U.cardKey(x)).join(','), c.map(x => U.cardKey(x)).join(','), '两次洗牌应一致');
  eq(a.length, b.length, '数量不变');
});

t('canPlay / 匹配规则', () => {
  ok(U.canPlay({ color: 'red', value: '5' }, 'red', '7'), '同色');
  ok(U.canPlay({ color: 'red', value: '5' }, 'blue', '5'), '同数字');
  ok(!U.canPlay({ color: 'red', value: '5' }, 'blue', '7'), '不同');
  ok(U.canPlay({ type: 'wild', color: null }, 'red', '7'), '野牌');
  ok(U.canPlay({ type: 'wild4', color: null }, 'red', '7'), '+4野牌');
});

t('wild4 规则：有同色牌不可打', () => {
  const hand = [{ color: 'red', value: '5', type: 'number' }, { color: 'blue', value: '9', type: 'number' }];
  ok(!U.legalPlayable({ type: 'wild4', value: 'wild4', color: null }, hand, 'red', '7'), '有红牌时不可打+4');
  ok(U.legalPlayable({ type: 'wild4', value: 'wild4', color: null }, hand, 'green', '7'), '无绿牌时可打+4');
});

t('newGame + deal：每人7张，中央有效', () => {
  const orig = Math.random;
  Math.random = (function () { let x = 1; return function () { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; })();
  try {
    const g = U.newGame(4);
    U.deal(g);
    for (const p of g.players) eq(p.hand.length, 7, p.name + ' 应7张');
    eq(g.discard.length, 1, '弃牌堆1张');
    ok(g.activeColor && g.activeValue != null, '激活颜色/值');
    ok(!U.isWild(g.discard[0]), '首张非野牌');
    eq(g.current, 0, '玩家先手');
  } finally {
    Math.random = orig;
  }
});

t('出牌：合法牌移除并推进回合', () => {
  const g = U.newGame(4);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'red', value: '7', type: 'number' }];
  g.activeColor = 'red'; g.activeValue = '7';
  g.players[0].hand = [{ color: 'red', value: '5', type: 'number' }, { color: 'blue', value: '3', type: 'number' }];
  const res = U.playCard(g, 0, 0, null);
  ok(res.ok, '应成功');
  eq(g.players[0].hand.length, 1, '手牌剩1张');
  eq(g.discard[g.discard.length - 1].value, '5', '弃牌更新');
  eq(g.activeValue, '5', '激活值更新');
  eq(g.current, 1, '下一位');
});

t('出牌：非法牌被拒绝', () => {
  const g = U.newGame(4);
  g.discard = [{ color: 'red', value: '7', type: 'number' }];
  g.activeColor = 'red'; g.activeValue = '7';
  g.players[0].hand = [{ color: 'blue', value: '5', type: 'number' }];
  const res = U.playCard(g, 0, 0, null);
  ok(!res.ok, '应拒绝');
  eq(g.players[0].hand.length, 1, '牌未移除');
});

t('Skip：下家被跳过', () => {
  const g = U.newGame(3);
  g.discard = [{ color: 'red', value: 'skip', type: 'action' }];
  g.activeColor = 'red'; g.activeValue = 'skip';
  g.players[0].hand = [{ color: 'red', value: 'skip', type: 'action' }, { color: 'red', value: '2', type: 'number' }];
  const res = U.playCard(g, 0, 0, null);
  ok(res.ok);
  eq(res.effects.skipped, 1, '跳过1号');
  eq(g.current, 2, '轮到2号');
});

t('Reverse：方向反转', () => {
  const g = U.newGame(4);
  g.discard = [{ color: 'blue', value: 'reverse', type: 'action' }];
  g.activeColor = 'blue'; g.activeValue = 'reverse';
  g.players[0].hand = [{ color: 'blue', value: 'reverse', type: 'action' }, { color: 'blue', value: '2', type: 'number' }];
  const res = U.playCard(g, 0, 0, null);
  ok(res.ok);
  eq(g.dir, -1, '方向反转');
  eq(g.current, 3, '4人逆序回到3号');
});

t('Draw Two：打出开启接龙，不立即抽牌', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'green', value: 'draw2', type: 'action' }];
  g.activeColor = 'green'; g.activeValue = 'draw2';
  g.players[0].hand = [{ color: 'green', value: 'draw2', type: 'action' }, { color: 'green', value: '2', type: 'number' }];
  g.players[1].hand = [{ color: 'green', value: '8', type: 'number' }];
  const before = g.players[1].hand.length;
  const res = U.playCard(g, 0, 0, null);
  ok(res.ok);
  ok(res.stack, '应开启接龙');
  eq(res.stack.count, 2, '累计2张');
  eq(res.stack.target, 1, '目标是1号');
  eq(g.players[1].hand.length, before, '未立即抽牌');
  eq(g.current, 1, '轮到1号决定接龙或抓牌');
});

t('转向+2：先反转方向，再开启接龙（目标为原上家）', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'green', value: 'draw2rev', type: 'action' }];
  g.activeColor = 'green'; g.activeValue = 'draw2rev';
  g.players[0].hand = [{ color: 'green', value: 'draw2rev', type: 'action' }, { color: 'green', value: '2', type: 'number' }];
  const before = g.players[2].hand.length;
  const res = U.playCard(g, 0, 0, null);
  ok(res.ok);
  eq(g.dir, -1, '方向先反转');
  ok(res.stack, '应开启接龙');
  eq(res.stack.count, 2, '累计2张');
  eq(res.stack.target, 2, '目标是原上家2号');
  eq(g.current, 2, '轮到2号决定接龙或抓牌');
  eq(g.players[2].hand.length, before, '未立即抽牌');
});

t('接龙：目标玩家接 +2 累加，回合移交再下家', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'green', value: 'draw2', type: 'action' }];
  g.activeColor = 'green'; g.activeValue = 'draw2';
  g.players[0].hand = [{ color: 'green', value: 'draw2', type: 'action' }, { color: 'green', value: '2', type: 'number' }];
  g.players[1].hand = [{ color: 'blue', value: 'draw2', type: 'action' }, { color: 'blue', value: '3', type: 'number' }];
  U.playCard(g, 0, 0, null);                    // 0 出 +2
  const res = U.playCard(g, 1, 0, null);        // 1 接 +2（异色也可）
  ok(res.ok);
  ok(res.stack, '接龙继续');
  eq(res.stack.count, 4, '累计4张');
  eq(res.stack.target, 2, '目标是2号');
  eq(g.current, 2);
});

t('接龙：转向+2 先反转再累加，弹回刚出牌者', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'green', value: 'draw2', type: 'action' }];
  g.activeColor = 'green'; g.activeValue = 'draw2';
  g.players[0].hand = [{ color: 'green', value: 'draw2', type: 'action' }, { color: 'green', value: '2', type: 'number' }];
  g.players[1].hand = [{ color: 'blue', value: 'draw2rev', type: 'action' }, { color: 'blue', value: '3', type: 'number' }];
  U.playCard(g, 0, 0, null);                    // 0 出 +2
  const res = U.playCard(g, 1, 0, null);        // 1 出转向+2
  ok(res.ok);
  eq(g.dir, -1, '方向先反转');
  ok(res.stack, '接龙继续');
  eq(res.stack.count, 4, '累计4张');
  eq(res.stack.target, 0, '弹回0号');
  eq(g.current, 0, '轮到0号决定接龙或抓牌');
});

t('接龙：目标玩家抓累计张数并被跳过', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'green', value: 'draw2', type: 'action' }];
  g.activeColor = 'green'; g.activeValue = 'draw2';
  g.players[0].hand = [{ color: 'green', value: 'draw2', type: 'action' }, { color: 'green', value: '2', type: 'number' }];
  g.players[1].hand = [{ color: 'blue', value: 'draw2', type: 'action' }, { color: 'blue', value: '3', type: 'number' }];
  g.players[2].hand = [{ color: 'red', value: '5', type: 'number' }];
  U.playCard(g, 0, 0, null);
  U.playCard(g, 1, 0, null);                    // 累计4张，目标是2号
  const before = g.players[2].hand.length;
  const res = U.drawStack(g, 2);
  ok(res.ok);
  eq(res.count, 4, '抓累计4张');
  eq(g.players[2].hand.length, before + 4, '手牌+4');
  eq(res.skipped, 2, '2号被跳过');
  eq(g.drawStack, null, '接龙结束');
  eq(g.current, 0, '轮到2号的下家0号');
});

t('Wild：选择颜色后生效', () => {
  const g = U.newGame(3);
  g.discard = [{ color: 'red', value: '7', type: 'number' }];
  g.activeColor = 'red'; g.activeValue = '7';
  g.players[0].hand = [{ type: 'wild', value: 'wild', color: null }];
  const res = U.playCard(g, 0, 0, 'blue');
  ok(res.ok);
  eq(g.activeColor, 'blue', '激活色变为蓝');
  eq(g.discard[g.discard.length - 1].color, 'blue', '弃牌记录蓝色');
});

t('Wild4：合法时开启接龙，不立即抽牌', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'red', value: '7', type: 'number' }];
  g.activeColor = 'red'; g.activeValue = '7';
  g.players[0].hand = [{ type: 'wild4', value: 'wild4', color: null }, { color: 'blue', value: '2', type: 'number' }];
  g.players[1].hand = [];
  const res = U.playCard(g, 0, 0, 'yellow');
  ok(res.ok);
  ok(res.stack, '应开启接龙');
  eq(res.stack.count, 4, '累计4张');
  eq(g.players[1].hand.length, 0, '未立即抽牌');
  eq(g.activeColor, 'yellow', '激活色黄色');
  eq(g.current, 1, '轮到1号');
});

t('接龙：目标玩家出 +4 不受同色限制', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'green', value: 'draw2', type: 'action' }];
  g.activeColor = 'green'; g.activeValue = 'draw2';
  g.players[0].hand = [{ color: 'green', value: 'draw2', type: 'action' }, { color: 'green', value: '2', type: 'number' }];
  g.players[1].hand = [{ color: 'green', value: '9', type: 'number' }, { type: 'wild4', value: 'wild4', color: null }];
  U.playCard(g, 0, 0, null);
  const res = U.playCard(g, 1, 1, 'red');       // 手上有绿色却可出 +4
  ok(res.ok, '接龙中 +4 不受同色限制');
  eq(res.stack.count, 6, '累计6张');
  eq(g.activeColor, 'red', '+4 选择红色生效');
});

t('接龙：非 +2/+4 牌在接龙中被拒绝', () => {
  const g = U.newGame(3);
  g.discard = [{ color: 'green', value: 'draw2', type: 'action' }];
  g.activeColor = 'green'; g.activeValue = 'draw2';
  g.players[0].hand = [{ color: 'green', value: 'draw2', type: 'action' }, { color: 'green', value: '2', type: 'number' }];
  g.players[1].hand = [{ color: 'green', value: '8', type: 'number' }];
  U.playCard(g, 0, 0, null);
  const res = U.playCard(g, 1, 0, null);
  ok(!res.ok, '接龙中不能出普通牌');
  eq(g.players[1].hand.length, 1, '牌未打出');
});

t('AI 接龙决策：有 +2/+4 就接，优先 +2', () => {
  const hand = [{ color: 'blue', value: 'draw2', type: 'action' }, { type: 'wild4', value: 'wild4', color: null }];
  const d = U.aiDecideStack(hand);
  ok(d, '应接龙');
  eq(hand[d.index].value, 'draw2', '优先出 +2');
  ok(U.aiDecideStack([{ type: 'wild4', value: 'wild4', color: null }]), '只有 +4 也接');
  eq(U.aiDecideStack([{ color: 'red', value: '5', type: 'number' }]), null, '无 +2/+4 返回 null');
});

t('接龙抓牌在庞氏骗局中按累计数结算', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'green', value: 'draw2', type: 'action' }];
  g.activeColor = 'green'; g.activeValue = 'draw2';
  g.players[0].hand = [{ color: 'green', value: 'draw2', type: 'action' }, { color: 'green', value: '2', type: 'number' }];
  g.players[1].hand = [{ color: 'blue', value: 'draw2', type: 'action' }, { color: 'blue', value: '3', type: 'number' }];
  g.players[2].hand = [{ color: 'red', value: '5', type: 'number' }];
  g.ponzi = { count: 0 };
  U.playCard(g, 0, 0, null);   // 庞氏计数 +1
  U.playCard(g, 1, 0, null);   // 庞氏计数 +1 → 2
  const before = g.players[2].hand.length;
  const res = U.drawStack(g, 2);
  ok(res.ok);
  ok(res.ponziEnded, '庞氏骗局爆发');
  eq(res.ponziEnded.X, 6, '庞氏累计 2 + 接龙 4 = X=6');
  eq(g.players[2].hand.length, before + 4 + 6, '先抓接龙4张，再加庞氏 X=6 张');
  eq(g.ponzi, null, '庞氏结束');
});

t('开局：首张 +2 也进入接龙', () => {
  const orig = Math.random;
  Math.random = (function () { let x = 4; return function () { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; })();
  try {
    const g = U.newGame(3);
    U.deal(g);
    const top = g.discard[g.discard.length - 1];
    eq(top.value, 'draw2', '首张为 +2');
    ok(g.drawStack, '应开启接龙');
    eq(g.drawStack.count, 2, '累计2张');
    eq(g.current, 1, '轮到1号接龙');
  } finally {
    Math.random = orig;
  }
});

t('开局：首张转向+2 先反转方向再进入接龙', () => {
  const orig = Math.random;
  Math.random = (function () { let x = 3; return function () { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; })();
  try {
    const g = U.newGame(3);
    U.deal(g);
    const top = g.discard[g.discard.length - 1];
    eq(top.value, 'draw2rev', '首张为转向+2');
    eq(g.dir, -1, '方向反转');
    ok(g.drawStack, '应开启接龙');
    eq(g.drawStack.count, 2, '累计2张');
    eq(g.current, 2, '轮到2号接龙');
  } finally {
    Math.random = orig;
  }
});

t('计分：数字/动作/野牌分值', () => {
  eq(U.scoreHand([{ type: 'number', value: '5' }, { type: 'number', value: '0' }]), 5, '数字5+0');
  eq(U.scoreHand([{ type: 'action', value: 'skip' }]), 20, '动作20');
  eq(U.scoreHand([{ type: 'wild', value: 'wild' }, { type: 'wild4', value: 'wild4' }]), 100, '野牌50×2');
  eq(U.scoreHand([{ type: 'number', value: '9' }, { type: 'action', value: 'draw2' }, { type: 'wild', value: 'wild' }]), 79);
});

t('roundEnd：胜者获得其他玩家手牌分', () => {
  const g = U.newGame(3);
  g.players[0].hand = [];
  g.players[1].hand = [{ type: 'number', value: '5' }];
  g.players[2].hand = [{ type: 'action', value: 'reverse' }, { type: 'wild', value: 'wild' }];
  const res = U.roundEnd(g, 0);
  eq(res.pts, 5 + 20 + 50, '总分');
  eq(g.players[0].score, 75, '记入胜者');
});

t('手牌结算：达到30张触发，先比牌数再比点数', () => {
  const g = U.newGame(3);
  g.players[0].hand = Array.from({ length: 30 }, () => ({ type: 'number', value: '9' }));
  g.players[1].hand = Array.from({ length: 29 }, () => ({ type: 'number', value: '9' }));
  g.players[2].hand = Array.from({ length: 31 }, () => ({ type: 'number', value: '0' }));
  eq(U.HAND_LIMIT, 30, '手牌上限30');
  eq(U.handLimitWinner(g), 1, '29张优先于30/31张');
  g.players[1].hand = Array.from({ length: 30 }, () => ({ type: 'number', value: '9' }));
  g.players[2].hand = Array.from({ length: 30 }, () => ({ type: 'number', value: '0' }));
  eq(U.handLimitWinner(g), 2, '同为30张时点数更低者获胜');
});

t('手牌结算：未达到30张不触发', () => {
  const g = U.newGame(3);
  g.players.forEach(p => { p.hand = Array.from({ length: 29 }, () => ({ type: 'number', value: '0' })); });
  eq(U.handLimitWinner(g), null, '未达到上限');
});

t('不幸13：抽牌到13张再抽13张', () => {
  const g = U.newGame(2);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'red', value: '7', type: 'number' }];
  g.players[0].hand = [];
  for (let i = 0; i < 12; i++) g.players[0].hand.push({ color: 'red', value: String(i % 10), type: 'number' });
  const dopts = {};
  U.draw(g, 0, 1, dopts);
  eq(g.players[0].hand.length, 12 + 1 + 13, '应为26张, 实际' + g.players[0].hand.length);
  ok(dopts._unlucky13, '标记不幸13');
});

t('庞氏骗局：强制抽牌者抽累计 X 张', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'red', value: '7', type: 'number' }];
  g.activeColor = 'red'; g.activeValue = '7';
  g.ponzi = { count: 0 };
  g.players[0].hand = [{ color: 'red', value: '5', type: 'number' }];
  g.players[1].hand = [{ color: 'blue', value: '3', type: 'number' }];
  // 玩家0出牌1张 → 计数+1
  U.playCard(g, 0, 0, null);
  eq(g.ponzi.count, 1, '计数1');
  // 玩家1无法匹配被迫抽牌 → X = 1 + 1 = 2
  const before = g.players[1].hand.length;
  const dopts = { ponziTrigger: true };
  U.draw(g, 1, 1, dopts);
  eq(g.players[1].hand.length, before + 3, '抽1+2张, 实际+' + (g.players[1].hand.length - before));
  ok(dopts._ponziEnded, '庞氏结束');
  eq(g.ponzi, null, '庞氏清空');
});

t('德州扑克：点数小者抽较大数字', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.players[0].hand = [{ type: 'number', value: '9' }];
  g.players[1].hand = [{ type: 'number', value: '3' }];
  const before = g.players[1].hand.length;
  const res = U.applyShowdown(g, 'poker', 0, g.players[0].hand[0], 1, g.players[1].hand[0]);
  eq(res.drawIdx, 1, '点数小者');
  eq(res.count, 9, '抽较大数字9');
  eq(g.players[1].hand.length, before + 9, '已抽');
});

t('德州扑克：平局无事', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.players[0].hand = [{ type: 'number', value: '5' }];
  g.players[1].hand = [{ type: 'number', value: '5' }];
  const before = g.players[0].hand.length + g.players[1].hand.length;
  const res = U.applyShowdown(g, 'poker', 0, g.players[0].hand[0], 1, g.players[1].hand[0]);
  eq(res.drawIdx, null, '无输家');
  eq(g.players[0].hand.length + g.players[1].hand.length, before, '无人抽牌');
});

t('火攻：颜色不同被拼点者抽4', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.players[0].hand = [{ color: 'red', value: '9', type: 'number' }];
  g.players[1].hand = [{ color: 'blue', value: '3', type: 'number' }];
  const before = g.players[1].hand.length;
  const res = U.applyShowdown(g, 'fire', 0, g.players[0].hand[0], 1, g.players[1].hand[0]);
  eq(res.drawIdx, 1, '被拼点者抽');
  eq(res.count, 4, '抽4');
  eq(g.players[1].hand.length, before + 4, '已抽');
});

t('火攻：颜色相同拼点者抽4', () => {
  const g = U.newGame(3);
  g.deck = U.buildDeck();
  g.players[0].hand = [{ color: 'red', value: '9', type: 'number' }];
  g.players[1].hand = [{ color: 'red', value: '3', type: 'number' }];
  const before = g.players[0].hand.length;
  const res = U.applyShowdown(g, 'fire', 0, g.players[0].hand[0], 1, g.players[1].hand[0]);
  eq(res.drawIdx, 0, '拼点者抽');
  eq(res.count, 4, '抽4');
  eq(g.players[0].hand.length, before + 4, '已抽');
});

t('闪电：骰子决定目标与张数', () => {
  const g = U.newGame(4);
  g.deck = U.buildDeck();
  const rand = (() => { let k = 0; return () => k++ === 0 ? 0 : 0; })(); // d1=1, d2=1
  const res = U.applyLightning(g, 0, rand);
  eq(res.d1, 1); eq(res.d2, 1);
  eq(res.target, 1, '目标1号');
  eq(res.count, 2, '抽2张');
  eq(g.players[1].hand.length, 2, '已抽');
});

t('铁索连环：伙伴同受抽牌并断链', () => {
  const g = U.newGame(4);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'red', value: '7', type: 'number' }];
  g.ironChain = { a: 0, b: 2 };
  const before0 = g.players[0].hand.length;
  const before2 = g.players[2].hand.length;
  const dopts = {};
  U.draw(g, 0, 2, dopts);
  eq(g.players[0].hand.length, before0 + 2, '本人抽2');
  eq(g.players[2].hand.length, before2 + 2, '伙伴抽2');
  eq(g.ironChain, null, '断链');
  ok(dopts._chainShared, '标记共享');
});

t('铁索连环：随机选择一名其他玩家', () => {
  const g = U.newGame(4);
  const first = U.applyIron(g, 0, () => 0);
  eq(first.partner, 1, '随机索引0选中候选座位1');
  ok(first.partner !== 0, '不连接自己');
  const last = U.applyIron(g, 0, () => 0.99);
  eq(last.partner, 3, '随机索引末位选中座位3');
});

t('决斗：无法出牌者抽 count 张', () => {
  const g = U.newGame(4);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'red', value: '7', type: 'number' }];
  g.duel = { a: 0, b: 2, color: 'red', count: 3, turn: 2 };
  g.current = 2;
  const before = g.players[2].hand.length;
  const info = U.duelDraw(g, 2);
  eq(info.X, 3, '抽3张');
  eq(g.players[2].hand.length, before + 3, '已抽');
  eq(g.duel, null, '决斗结束');
});

t('决斗：不能打出 +2（含转向+2），+4 仍可出', () => {
  const g = U.newGame(4);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'red', value: '7', type: 'number' }];
  g.activeColor = 'red'; g.activeValue = '7';
  g.duel = { a: 0, b: 2, color: 'red', count: 0, turn: 2 };
  g.current = 2;
  g.players[2].hand = [
    { color: 'red', value: 'draw2', type: 'action' },
    { color: 'red', value: 'draw2rev', type: 'action' },
    { color: 'red', value: '9', type: 'number' },
  ];
  let res = U.playCard(g, 2, 0, null);
  ok(!res.ok, '决斗中 +2 被拒绝');
  eq(g.players[2].hand.length, 3, '+2 未打出');
  res = U.playCard(g, 2, 1, null);
  ok(!res.ok, '决斗中转向+2 被拒绝');
  eq(g.players[2].hand.length, 3, '转向+2 未打出');
  res = U.playCard(g, 2, 2, null);
  ok(res.ok, '普通数字牌可出');
  eq(g.players[2].hand.length, 2, '数字牌已打出');
  eq(g.duel.count, 1, '决斗计数+1');
});

t('决斗：AI 不会选择被禁用的 +2', () => {
  const hand = [
    { color: 'red', value: 'draw2', type: 'action' },
    { color: 'red', value: '9', type: 'number' },
  ];
  const dec = U.aiDecideDuel(hand, 'red', '7');
  eq(dec.index, 1, '应选择普通牌9');
});

t('决斗：+4 仍可打出，对手抽4张', () => {
  const g = U.newGame(4);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'red', value: '7', type: 'number' }];
  g.activeColor = 'red'; g.activeValue = '7';
  g.duel = { a: 0, b: 2, color: 'red', count: 0, turn: 2 };
  g.current = 2;
  g.players[2].hand = [
    { type: 'wild4', value: 'wild4', color: null },
    { color: 'blue', value: '5', type: 'number' },
  ];
  const before = g.players[0].hand.length;
  const res = U.playCard(g, 2, 0, 'red');
  ok(res.ok, '决斗中 +4 可出');
  eq(res.effects.drew.length, 4, '对手抽4张');
  eq(g.players[0].hand.length, before + 4, '对手手牌+4');
  eq(g.duel.count, 1, '决斗计数+1');
  eq(g.current, 0, '轮到对手');
});

t('决斗可出牌列表：排除 +2 保留数字与 +4', () => {
  const hand = [
    { color: 'red', value: 'draw2', type: 'action' },
    { color: 'red', value: '9', type: 'number' },
    { color: 'blue', value: '3', type: 'number' },
  ];
  const idxs = U.duelPlayableIndexes(hand, 'red', '7');
  eq(idxs.length, 1, '只剩数字牌');
  eq(hand[idxs[0]].value, '9', '可出9');
  const hand2 = [{ color: 'red', value: 'draw2rev', type: 'action' }, { type: 'wild4', value: 'wild4', color: null }];
  const idxs2 = U.duelPlayableIndexes(hand2, 'green', '7');
  eq(idxs2.length, 1, '只剩+4');
  eq(hand2[idxs2[0]].value, 'wild4', '可出+4');
});

t('AI 决策：选择可出牌，无可出返回 null', () => {
  const hand = [{ color: 'red', value: '9', type: 'number' }, { color: 'blue', value: '3', type: 'number' }, { type: 'wild', value: 'wild', color: null }];
  const dec = U.aiDecide(hand, 'red', '7');
  ok(dec && hand[dec.index].color === 'red', '应选红牌');
  const hand2 = [{ color: 'blue', value: '3', type: 'number' }];
  eq(U.aiDecide(hand2, 'red', '7'), null, '无可出');
  // wild4 规则限制
  const hand3 = [{ color: 'red', value: '5', type: 'number' }, { type: 'wild4', value: 'wild4', color: null }];
  const dec3 = U.aiDecide(hand3, 'red', '7');
  ok(dec3.index === 0, '不应打+4');
});

t('playableIndexes 正确', () => {
  const hand = [{ color: 'red', value: '5', type: 'number' }, { color: 'blue', value: '3', type: 'number' }, { type: 'wild', value: 'wild', color: null }];
  const idxs = U.playableIndexes(hand, 'red', '7');
  eq(idxs.join(','), '0,2', '红5与野牌可出');
});

t('对家计算', () => {
  eq(U.oppositeOf(U.newGame(4), 0), 2, '4人对家');
  eq(U.oppositeOf(U.newGame(3), 0), 2, '3人对家');
});

t('桃源：丢弃不超过一半', () => {
  const g = U.newGame(3);
  g.players[0].hand = [1, 2, 3, 4, 5].map((v, i) => ({ color: 'red', value: String(i + 1), type: 'number' }));
  const picks = U.pickLowestCards(g.players[0].hand, Math.floor(5 / 2));
  eq(picks.length, 2, '最多2张');
  const removed = U.discardCards(g, 0, picks);
  eq(removed.length, 2, '已丢弃');
  eq(g.players[0].hand.length, 3, '剩3张');
});

t('五谷：丢弃同色牌', () => {
  const g = U.newGame(3);
  g.players[0].hand = [{ color: 'red', value: '1', type: 'number' }, { color: 'red', value: '2', type: 'number' }, { color: 'blue', value: '3', type: 'number' }];
  const removed = U.discardColorCards(g, 0, 'red');
  eq(removed.length, 2, '丢2张红');
  eq(g.players[0].hand.length, 1, '剩蓝');
});

t('出0牌触发机会活动（随机）', () => {
  const g = U.newGame(4);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'red', value: '7', type: 'number' }];
  g.activeColor = 'red'; g.activeValue = '7';
  g.players[0].hand = [{ color: 'red', value: '0', type: 'number' }, { color: 'red', value: '2', type: 'number' }];
  const origRandom = Math.random; Math.random = () => 0.99; // 选最后一种活动
  let res;
  try { res = U.playCard(g, 0, 0, null); } finally { Math.random = origRandom; }
  ok(res.ok);
  ok(res.chanceZero, '应触发机会');
  ok(U.ACTIVITIES.indexOf(res.activity) >= 0, '活动合法: ' + res.activity);
});

t('打0牌清空手牌=直接获胜，不触发机会', () => {
  const g = U.newGame(4);
  g.deck = U.buildDeck();
  g.discard = [{ color: 'red', value: '7', type: 'number' }];
  g.activeColor = 'red'; g.activeValue = '7';
  g.players[0].hand = [{ color: 'red', value: '0', type: 'number' }];
  const res = U.playCard(g, 0, 0, null);
  ok(res.ok);
  ok(res.win, '直接获胜');
  eq(res.chanceZero, false, '不触发机会');
});

console.log('\n' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
