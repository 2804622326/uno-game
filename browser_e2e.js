#!/usr/bin/env node
/* ================================================================
 * 浏览器端到端测试：真实 Chrome 无头 + 服务器，两个页面联机对战
 * 用法：node browser_e2e.js
 * ================================================================ */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = 34569;
const BASE = 'http://127.0.0.1:' + PORT;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* 注入页面：自动应答模态框 + 自动出牌 */
const AUTOPILOT = `
  (function () {
    if (window.__autopilot) return;
    window.__autopilot = true;
    function click(el) { try { el.click(); } catch (e) {} }
    setInterval(function () {
      try {
        var mc = document.getElementById('modalContent');
        if (mc && !mc.classList.contains('hidden') && mc.innerHTML) {
          var overlay = document.getElementById('modalOverlay');
          if (!overlay.classList.contains('hidden')) {
            // 颜色选择器
            var color = mc.querySelector('.color-opt');
            if (color) { click(color); return; }
            // 选对手（德州/决斗/火攻）
            var tile = mc.querySelector('.modal-tile');
            if (tile) { click(tile); return; }
            // 亮牌 / 桃源选牌
            var card = mc.querySelector('.modal-card');
            if (card) {
              var primary = mc.querySelector('.modal-actions .primary');
              if (primary) { click(card); click(primary); return; }
              click(card); return;
            }
          }
        }
        // 轮到我出牌
        if (window.S && S.humanCanAct) {
          var playable = document.querySelector('#hand .hand-card.playable');
          if (playable) { click(playable); return; }
          var draw = document.getElementById('drawArea');
          if (draw) { click(draw); }
        }
      } catch (e) {}
    }, 120);
  })();
`;

async function main() {
  const child = spawn('node', [path.join(__dirname, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await sleep(800);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu'],
  });
  try {
    console.log('浏览器端到端测试：');
    const pageErrors = [];
    const pages = { host: null, guest: null };

    /* ---------- 房主创建房间 ---------- */
    pages.host = await browser.newPage();
    pages.host.on('pageerror', e => pageErrors.push('host: ' + e.message));
    pages.host.on('console', m => { if (m.type() === 'error') pageErrors.push('host: ' + m.text()); });
    await pages.host.goto(BASE, { waitUntil: 'networkidle0' });
    await pages.host.type('#mpName', 'HOST');
    await pages.host.click('#btnCreateRoom');
    await sleep(800);
    const roomCode = await pages.host.$eval('#mpRoomTitle', el => (el.textContent.match(/房间 (\d+)/) || [])[1]);
    ok(/^\d{4}$/.test(roomCode || ''), '房主创建房间，房间码=' + roomCode);
    await pages.host.evaluate(AUTOPILOT);

    /* ---------- 客机加入 ---------- */
    pages.guest = await browser.newPage();
    pages.guest.on('pageerror', e => pageErrors.push('guest: ' + e.message));
    pages.guest.on('console', m => { if (m.type() === 'error') pageErrors.push('guest: ' + m.text()); });
    await pages.guest.goto(BASE, { waitUntil: 'networkidle0' });
    await pages.guest.type('#mpName', 'GUEST');
    await pages.guest.type('#mpRoomCode', roomCode);
    await pages.guest.click('#btnJoinRoom');
    await sleep(800);
    const guestJoined = await pages.guest.$eval('#mpSeats', el => el.textContent.includes('GUEST'));
    ok(guestJoined, '客机加入房间');

    // 大厅显示两名人类
    const seatCount = await pages.host.$eval('#mpSeats .mp-seat', el => (el ? 1 : 0)).catch(() => 0);
    ok(seatCount === 1, '大厅渲染座位');
    await pages.guest.evaluate(AUTOPILOT);

    /* ---------- 双方就绪并开局（房主创建时即就绪，客机点就绪） ---------- */
    console.log('  … 客机就绪');
    await pages.guest.$eval('#btnMpReady', el => el.click());
    await sleep(500);
    const guestReady = await pages.guest.$eval('#btnMpReady', el => el.textContent).catch(() => '');
    console.log('  … 客机就绪按钮: ' + guestReady);
    console.log('  … 房主开局');
    await pages.host.$eval('#btnMpStart', el => el.click());
    await sleep(2000);
    console.log('  … 注入自动驾驶');
    await pages.host.evaluate(AUTOPILOT);
    await pages.guest.evaluate(AUTOPILOT);
    await sleep(800);

    const hostInGame = await pages.host.$eval('#gameScreen', el => !el.classList.contains('hidden')).catch(() => false);
    const guestInGame = await pages.guest.$eval('#gameScreen', el => !el.classList.contains('hidden')).catch(() => false);
    ok(hostInGame && guestInGame, '双方进入游戏界面');

    const hostHand = await pages.host.evaluate(() => S.g.players[0].hand.length);
    ok(hostHand === 7, '房主手牌 7 张');
    const guestView = await pages.guest.evaluate(() => S.g.players[0].name);
    ok(guestView === 'GUEST', '客机视角自己=GUEST');

    /* ---------- 快照隐私 ---------- */
    const hostSeesGuestHand = await pages.host.evaluate(() => {
      const g = S.g;
      return g.players.some(p => p.name === 'GUEST' && p.hand !== null);
    });
    ok(!hostSeesGuestHand, '房主看不到客机手牌');
    const guestSeesHostHand = await pages.guest.evaluate(() => {
      const g = S.g;
      return g.players.some(p => p.name === 'HOST' && p.hand !== null);
    });
    ok(!guestSeesHostHand, '客机看不到房主手牌');

    /* ---------- 自动驾驶若干回合 ---------- */
    await sleep(4000);
    const hostDiscard = await pages.host.evaluate(() => S.g.discard.length);
    const guestDiscard = await pages.guest.evaluate(() => S.g.discard.length);
    ok(hostDiscard >= 1, '有牌打出（弃牌堆>1），host 看到 ' + hostDiscard + ' 张');
    ok(hostDiscard === guestDiscard, '双方弃牌堆同步（' + hostDiscard + '）');

    const hostActive = await pages.host.evaluate(() => S.g.activeColor + ':' + S.g.activeValue);
    const guestActive = await pages.guest.evaluate(() => S.g.activeColor + ':' + S.g.activeValue);
    ok(hostActive === guestActive, '双方活跃牌同步（' + hostActive + '）');

    // current 是各客户端自己的视图索引，改为比较“当前玩家名字”是否一致
    const hostCurrentName = await pages.host.evaluate(() => S.g.players[S.g.current].name);
    const guestCurrentName = await pages.guest.evaluate(() => S.g.players[S.g.current].name);
    ok(hostCurrentName === guestCurrentName, '双方当前玩家一致（' + hostCurrentName + '）');

    // 手牌数总和不增加（抽牌会导致增加，出牌减少；只校验双方牌数统计一致）
    const sum1 = await pages.host.evaluate(() => S.g.players.reduce((s, p) => s + (p.hand ? p.hand.length : p.handCount), 0));
    const sum2 = await pages.guest.evaluate(() => S.g.players.reduce((s, p) => s + (p.hand ? p.hand.length : p.handCount), 0));
    ok(sum1 === sum2, '双方总手牌数一致（' + sum1 + '）');

    // 无页面报错
    const realErrors = pageErrors.filter(e => !/favicon|net::|Download the React DevTools/i.test(e));
    ok(realErrors.length === 0, '浏览器无 JS 错误' + (realErrors.length ? ' → ' + realErrors.join(' | ') : ''));

  } catch (e) {
    console.log('  ✘ 测试流程异常: ' + e.message);
    fail++;
  } finally {
    await browser.close();
    child.kill();
  }

  console.log('\n' + pass + ' 通过, ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
}

main();
