#!/usr/bin/env node
/* ================================================================
 * 验证：file:// 直接打开页面时，多人模式能连上本地服务器并建房。
 * 前置：node server.js 已在本机 3000 端口运行。
 * 用法：node verify_mp.js
 * ================================================================ */
'use strict';

const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'file://' + path.resolve(__dirname, 'index.html') + '?debug';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

  // 输入昵称并点「创建房间」
  await page.evaluate(() => {
    document.getElementById('mpName').value = '本地玩家';
    document.getElementById('btnCreateRoom').click();
  });

  // 等待连接与建房结果（最多 5s）
  let ok = false, status = '', title = '', seats = 0;
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    status = await page.evaluate(() => document.getElementById('mpStatus').textContent);
    const lobbyHidden = await page.evaluate(() => document.getElementById('mpLobby').classList.contains('hidden'));
    if (!lobbyHidden) {
      title = await page.evaluate(() => document.getElementById('mpRoomTitle').textContent.trim());
      seats = await page.evaluate(() => document.querySelectorAll('#mpSeats .mp-seat').length);
      ok = true;
      break;
    }
    if (/无法连接|未连接|连接已断开/.test(status)) break;
  }

  console.log('=== 验证结果 ===');
  console.log('mpStatus:', JSON.stringify(status));
  console.log('房间标题:', JSON.stringify(title));
  console.log('座位数:', seats);
  console.log('页面错误:', pageErrors.length ? pageErrors : '（无）');

  await browser.close();

  if (ok && seats >= 2) {
    console.log('\n结论：通过 —— file:// 下创建房间成功，已连接本地服务器。');
    process.exit(0);
  } else {
    console.log('\n结论：失败 —— 未能连上服务器。');
    process.exit(1);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
