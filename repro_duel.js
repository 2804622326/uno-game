#!/usr/bin/env node
/* ================================================================
 * 复现脚本：单人模式，AI 在决斗中无牌可出时应抽牌并结束决斗。
 * 预期（修复后）：S.g.duel === null，AI 抽了 count 张，回合推进。
 * 现状（bug）：调用未定义的 duelDrawFlow → ReferenceError，卡死。
 * 用法：node repro_duel.js
 * ================================================================ */
'use strict';

const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'file://' + path.resolve(__dirname, 'index.html') + '?debug';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.goto(URL, { waitUntil: 'load' });

  const result = await page.evaluate(() => {
    const S = window.__S;   // ?debug 暴露的调试句柄
    // 关声音，静音跑
    S.settings.muted = true;
    // 2 人局
    __ui.startGame(2);

    const g = S.g;
    if (g.numPlayers !== 2) return { err: '期望2人局' };
    const ai = 1;                 // AI 对手
    const hum = 0;
    if (g.players[ai].isAI !== true) return { err: '玩家1应为AI' };

    // 强制决斗状态：AI(1) 轮到自己且无牌可出
    clearTimeout(S.aiTimer); clearTimeout(S.flowTimer);
    S.aiTimer = null; S.flowTimer = null;
    g.duel = { a: hum, b: ai, color: 'red', count: 5, turn: ai };
    g.current = ai;
    g.activeColor = 'red';
    g.activeValue = '3';
    // AI 手里只有无法打出的牌（非红、非3、非万能）
    g.players[ai].hand = [
      { color: 'blue', value: '5', type: 'number' },
      { color: 'green', value: '2', type: 'number' },
      { color: 'yellow', value: '9', type: 'number' },
    ];
    const before = g.players[ai].hand.length;

    // 触发 AI 回合（同 aiTurn 逻辑，直接调用顶层函数）
    let caughtError = null;
    try {
      aiTurn();
    } catch (e) {
      caughtError = String(e && e.message || e);
    }

    return {
      before,
      after: g.players[ai].hand.length,
      duel: !!g.duel,
      current: g.current,
      caughtError,
      status: document.querySelector('#seat-1 .status') ? document.querySelector('#seat-1 .status').textContent : null,
    };
  });

  console.log('=== 复现结果 ===');
  console.log(JSON.stringify(result, null, 2));
  console.log('=== 页面错误 ===');
  if (pageErrors.length === 0) console.log('（无）');
  else pageErrors.forEach(e => console.log('  ✘ ' + e));

  await browser.close();

  const stuck = (pageErrors.length > 0 && /duelDrawFlow/.test(pageErrors[0])) ||
                (result.caughtError && /duelDrawFlow/.test(result.caughtError));
  if (stuck) {
    console.log('\n结论：复现成功 —— AI 无牌可出时调用未定义的 duelDrawFlow，抛 ReferenceError，游戏卡死。');
    process.exit(2); // 复现出 bug
  } else if (result.duel === false && result.after === result.before + 5) {
    console.log('\n结论：决斗正常结束 —— AI 抽了 5 张，决斗已清除。');
    process.exit(0);
  } else {
    console.log('\n结论：状态不符合预期，需人工检查。');
    process.exit(1);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
