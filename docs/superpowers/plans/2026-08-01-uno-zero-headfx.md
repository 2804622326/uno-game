# 机会牌 0 加权（4→24）+ 玩家头顶效果横幅 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 UNO 牌组中的 0 牌从 4 张加到 24 张（每色 6 张），并为玩家（含 AI）的被罚抽牌 / 被跳过 / 禁言（铁索）三种被动状态在头顶显示彩色横幅效果。

**Architecture:** 单文件 `index.html`。核心逻辑 `UNOCore`（纯逻辑，不依赖 DOM）中只改 `buildDeck()`；头顶效果全部位于 UI/渲染层——新增独立渲染层 `#headFxLayer`（与 `#seats` 平级，避免座位重绘时被清掉），`showHeadFx()` 追加瞬时横幅并自动淡出，`syncHeadFx()` 依据 `g.ironChain` 对账常驻「🔇 禁言」横幅，`renderAll()` 末尾调用它。测试改动仅限 `test_logic.js`（牌堆断言 108→128、0 牌 24 张）。

**Tech Stack:** 原生 HTML5 / CSS3 / JavaScript（无框架、无依赖）；`test_logic.js` 用 Node `vm` 沙箱提取 `UNOCore` 段运行单元测试（`node test_logic.js`）。

**注意：本项目不是 git 仓库**，本计划用「检查点」取代 git commit 步骤。若需要版本管理，实施前先 `cd /Users/hello/Downloads/uno && git init`，之后即可在每个检查点实际提交。

参考设计文档：`docs/superpowers/specs/2026-08-01-uno-zero-headfx-design.md`

---

## 文件结构

| 文件 | 改动 | 职责 |
| --- | --- | --- |
| `index.html` | 修改 | `buildDeck()`（0 牌 6 张/色）；新增 `#headFxLayer` 与横幅 CSS；新增 `showHeadFx()`/`syncHeadFx()`；`renderAll()` 末尾调用 `syncHeadFx()`；在 7 处触发点调用 `showHeadFx()`；调试钩子暴露新函数 |
| `test_logic.js` | 修改 | 更新牌堆用例断言；新增 0 牌数量断言 |

---

## Task 1: 更新牌堆测试（先写失败测试）

**Files:**
- Modify: `test_logic.js:45-56`

- [ ] **Step 1: 把「牌堆」用例改为断言 128 张 / 0 牌 24 张**

将 [test_logic.js:45-56](Downloads/uno/test_logic.js#L45-L56) 整个 `t('牌堆：108 张，颜色/类型数量正确', ...)` 块替换为：

```js
t('牌堆：128 张，0 牌 24 张，颜色/类型数量正确', () => {
  const d = U.buildDeck();
  eq(d.length, 128, '总数 ' + d.length);
  for (const c of ['red', 'green', 'blue', 'yellow']) {
    const col = d.filter(x => x.color === c);
    eq(col.length, 30, c + ' 应有30张, 实际' + col.length);
    eq(col.filter(x => x.type === 'number').length, 24, c + ' 数字牌24');
    eq(col.filter(x => x.type === 'action').length, 6, c + ' 动作牌6');
    eq(col.filter(x => x.value === '0').length, 6, c + ' 0牌6');
  }
  eq(d.filter(x => x.type === 'wild').length, 4, 'wild 4');
  eq(d.filter(x => x.type === 'wild4').length, 4, 'wild4 4');
  eq(d.filter(x => x.type === 'number' && x.value === '0').length, 24, '0牌共24张');
});
```

- [ ] **Step 2: 运行测试，确认它失败**

Run: `cd /Users/hello/Downloads/uno && node test_logic.js`
Expected: 第一个用例 FAIL——`总数 108` 断言抛出「108 !== 128」（`buildDeck()` 尚未改）。

## Task 2: buildDeck 每色生成 6 张 0

**Files:**
- Modify: `index.html:409-425`

- [ ] **Step 1: 修改 buildDeck**

将 [index.html:411-412](Downloads/uno/index.html#L411-L412) 的单张 0 牌推入改为 6 张循环，并把返回注释改为 128：

```js
    for (const c of COLORS) {
      for (let i = 0; i < 6; i++) deck.push({ color: c, value: '0', type: 'number' }); // 机会0：每色6张，共24张
      for (let n = 1; n <= 9; n++) {
        deck.push({ color: c, value: String(n), type: 'number' });
        deck.push({ color: c, value: String(n), type: 'number' });
      }
```

同时把第 424 行 `return deck; // 108` 改为 `return deck; // 128`。

- [ ] **Step 2: 运行测试，确认通过**

Run: `cd /Users/hello/Downloads/uno && node test_logic.js`
Expected: 全部用例 PASS（`30 通过, 0 失败`）。注意其余用例（deal 7 张、draw2、不幸13 等）不依赖牌堆总数，不受影响。

- [ ] **Step 3: 检查点**

`node test_logic.js` 通过 30/30。0 牌加权功能完成。

## Task 3: 新增头顶效果 DOM 层与 CSS（风格 C 彩色横幅）

**Files:**
- Modify: `index.html:88`（#table 内部）、`index.html:119-120`（座位样式之后）

- [ ] **Step 1: 在 #table 内、#seats 之后新增 #headFxLayer**

将 [index.html:371-379](Downloads/uno/index.html#L371-L379) 的 `<div id="table">` 块修改为（在 `<div id="seats"></div>` 后插入一层）：

```html
  <div id="table">
    <div id="seats"></div>
    <div id="headFxLayer"></div>
    <div id="centerPiles">
```

- [ ] **Step 2: 在座位样式块后追加横幅 CSS**

在 [index.html:119-120](Downloads/uno/index.html#L119-L120) 的 `.seat.active .name{...}` 与 `#centerPiles{...}` 之间插入：

```css
/* 头顶效果横幅（玩家被动状态提示） */
#headFxLayer{position:absolute;inset:0;pointer-events:none;z-index:6;}
.headfx{
  position:absolute;transform:translate(-50%,-100%);z-index:6;
  color:#fff;border-radius:12px;padding:3px 10px;font-size:12px;font-weight:900;white-space:nowrap;
  box-shadow:0 3px 10px rgba(0,0,0,.5);border:2px solid rgba(255,255,255,.9);
  letter-spacing:.3px;animation:headfxPop .45s ease;
}
.headfx.draw{background:linear-gradient(135deg,#ff6b6b,#e63946);}
.headfx.skip{background:linear-gradient(135deg,#f39c12,#e67e22);}
.headfx.mute{background:linear-gradient(135deg,#6c5ce7,#5a3fc0);animation:headfxPop .45s ease,headfxFloat 1.6s ease-in-out infinite;}
.headfx.leaving{opacity:0;transition:opacity .4s ease;}
@keyframes headfxPop{0%{transform:translate(-50%,-100%) scale(.3);opacity:0;}70%{transform:translate(-50%,-100%) scale(1.15);}100%{transform:translate(-50%,-100%) scale(1);opacity:1;}}
@keyframes headfxFloat{50%{transform:translate(-50%,-100%) translateY(-3px);}}
```

注意：`.headfx` 的 `animation` 故意**不带** `fill-mode: both`，这样动画结束后 `opacity` 回到基础值，`.leaving` 的淡出 transition 才能生效。

- [ ] **Step 3: 检查点**

在浏览器打开 `index.html` 开始一局游戏，肉眼确认台面无布局错位、座位/手牌显示正常（此时还没有横幅元素生成）。

## Task 4: 实现 showHeadFx / syncHeadFx 并接入 renderAll

**Files:**
- Modify: `index.html:1132`（`setStatusLine` 之后）、`index.html:1246-1261`（`renderAll`）

> 相对设计文档的小简化：横幅元素在独立层中自持生命周期（自带淡出定时器），无需 `S._fx` 注册表；`syncHeadFx()` 只负责常驻「禁言」横幅的增删对账。行为与 spec 一致。

- [ ] **Step 1: 在座位工具函数后新增两个函数**

在 [index.html:1132](Downloads/uno/index.html#L1132) 的 `function setStatusLine(idx, text) { setStatus(idx, text); }` 之后插入：

```js
/* ---------- 头顶效果横幅 ---------- */
function showHeadFx(idx, kind, opts) {
  const o = opts || {};
  const seat = seatEl(idx);
  const layer = byId('headFxLayer');
  if (!seat || !layer) return;
  const sRect = seat.getBoundingClientRect();
  const lRect = layer.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'headfx ' + (kind === 'skip' ? 'skip' : kind === 'mute' ? 'mute' : 'draw');
  el.textContent = kind === 'draw' ? '🃏 抽 ' + o.count : (kind === 'skip' ? '⛔ 跳过' : '🔇 禁言');
  el.dataset.seat = idx;
  // 同一座位已有横幅时依次上移堆叠
  const stack = layer.querySelectorAll('.headfx[data-seat="' + idx + '"]').length;
  el.style.left = (sRect.left - lRect.left + sRect.width / 2) + 'px';
  el.style.top = (sRect.top - lRect.top - stack * 28 - 6) + 'px';
  layer.appendChild(el);
  if (kind !== 'mute') {
    const dur = o.dur || 1600;
    setTimeout(function () { el.classList.add('leaving'); }, Math.max(0, dur - 420));
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, dur);
  }
}

/* 常驻禁言横幅对账：铁索形成时显示，断链时移除 */
function syncHeadFx() {
  const layer = byId('headFxLayer');
  if (!layer) return;
  const want = new Set();
  if (S.g && S.g.ironChain) { want.add(S.g.ironChain.a); want.add(S.g.ironChain.b); }
  Array.prototype.slice.call(layer.querySelectorAll('.headfx.mute')).forEach(function (el) {
    if (!want.has(parseInt(el.dataset.seat, 10))) el.remove();
  });
  want.forEach(function (idx) {
    if (!layer.querySelector('.headfx.mute[data-seat="' + idx + '"]')) showHeadFx(idx, 'mute');
  });
}
```

- [ ] **Step 2: renderAll 末尾调用 syncHeadFx**

将 [index.html:1256-1260](Downloads/uno/index.html#L1256-L1260) 的 `renderAll` 末尾（`if (g.ironChain) {...}` 块之后、函数结束前）追加：

```js
  syncHeadFx();
```

最终 `renderAll` 结尾形如：

```js
  renderCatchUno();
  if (g.ironChain) {
    const c = g.ironChain;
    setStatus(c.a, '⛓ 铁索');
    setStatus(c.b, '⛓ 铁索');
  }
  syncHeadFx();
}
```

- [ ] **Step 3: 检查点**

在浏览器打开 `index.html`，开局用调试控制台临时验证：`showHeadFx(1, 'draw', {count: 4})` 应让 1 号座位头顶出现红色「🃏 抽 4」横幅并在约 1.6s 后淡出；`showHeadFx(1, 'skip')` 出现橙色「⛔ 跳过」。

## Task 5: 接入出牌/抽牌驱动的横幅（afterPlay / afterDraw）

**Files:**
- Modify: `index.html:1354-1368`（`afterPlay`）、`index.html:1400-1409`（`afterDraw`）

- [ ] **Step 1: afterPlay 中为跳过与罚抽显示横幅**

在 [index.html:1368](Downloads/uno/index.html#L1368) 的 `if (eff.unlucky13) toast('☠ 不幸 13！额外抽 13 张');` 之后插入：

```js
  // 头顶效果：被跳过 / 被罚抽牌（+2/+4 的目标玩家两者同时）
  if (eff.skipped != null) showHeadFx(eff.skipped, 'skip');
  if (eff.drew && eff.drew.length > 0) showHeadFx(eff.skipped, 'draw', { count: eff.drew.length });
  if (eff.chainShared) showHeadFx(eff.chainShared.partner, 'draw', { count: eff.chainShared.count });
```

说明：纯 skip 牌 `eff.drew` 为空，只弹「⛔ 跳过」；+2/+4 目标玩家同时被跳过并被罚抽，两条横幅纵向堆叠。铁索伙伴同受（`eff.chainShared`）在伙伴头顶弹「🃏 抽 N」。

- [ ] **Step 2: afterDraw 中为庞氏/不幸13/铁索共享显示横幅**

将 [index.html:1402-1409](Downloads/uno/index.html#L1402-L1409) 的 toast 分支块修改为同时调用横幅（三处分别插入一行）：

```js
  if (dopts._ponziEnded) {
    toast('💸 庞氏骗局爆发！' + g.players[idx].name + ' 抽 ' + dopts._ponziEnded.X + ' 张');
    showHeadFx(idx, 'draw', { count: dopts._ponziEnded.X });
    sfx('draw');
  } else if (dopts._unlucky13) {
    toast('☠ 不幸 13！' + g.players[idx].name + ' 额外抽 13 张');
    showHeadFx(idx, 'draw', { count: 13 });
  } else if (dopts._chainShared) {
    toast('⛓ 铁索连环！' + g.players[dopts._chainShared.partner].name + ' 同受 ' + dopts._chainShared.count + ' 张');
    showHeadFx(dopts._chainShared.partner, 'draw', { count: dopts._chainShared.count });
  }
```

- [ ] **Step 3: 检查点**

浏览器手动验证（见 Task 8 清单 1-4）：打出 +2/+4、skip，对方头顶出现横幅并堆叠；用「不幸 13」（手牌堆到 12 再抽 1）验证「🃏 抽 13」。

## Task 6: 接入弹窗类活动横幅（闪电 / 扑克·火攻 / 决斗）

**Files:**
- Modify: `index.html:1507-1514`（`doLightning`）、`index.html:1582`（`finishShowdown` 的 setTimeout）、`index.html:1615-1622`（`finishDuelDraw`）

> 这三个活动先弹模态框遮挡台面，横幅必须在模态框关闭、`renderAll()` 之后才显示，否则被遮住且 1.6s 已过期。因此 `showHeadFx` 放在各自 setTimeout 内 `renderAll()` 之后。

- [ ] **Step 1: doLightning —— 弹幕关后在目标头顶显示张数**

将 [index.html:1513](Downloads/uno/index.html#L1513) 的：

```js
  setTimeout(function () { closeModal(); renderAll(); beginTurn(); }, 2500);
```

改为：

```js
  setTimeout(function () { closeModal(); renderAll(); showHeadFx(res.target, 'draw', { count: res.count }); beginTurn(); }, 2500);
```

- [ ] **Step 2: finishShowdown —— 输家头顶显示张数**

将 [index.html:1582](Downloads/uno/index.html#L1582) 的：

```js
  setTimeout(function () { closeModal(); renderAll(); beginTurn(); }, 2600);
```

改为：

```js
  setTimeout(function () {
    closeModal(); renderAll();
    if (res.drawIdx != null) showHeadFx(res.drawIdx, 'draw', { count: res.count });
    beginTurn();
  }, 2600);
```

- [ ] **Step 3: finishDuelDraw —— 决斗失败者头顶显示张数**

将 [index.html:1615-1622](Downloads/uno/index.html#L1615-L1622) 的 `finishDuelDraw` 整体替换为：

```js
function finishDuelDraw(idx) {
  const g = S.g;
  const info = UNOCore.duelDraw(g, idx);
  renderAll();
  if (info.X > 0) showHeadFx(idx, 'draw', { count: info.X });
  toast('⚔ 决斗结束：' + g.players[idx].name + ' 无法出牌，抽 ' + info.X + ' 张');
  sfx('draw');
  setTimeout(beginTurn, 900);
}
```

- [ ] **Step 4: 检查点**

浏览器手动验证（见 Task 8 清单 5-7）：闪电掷骰后目标头顶出「🃏 抽 N」；扑克/火攻结算后输家出横幅；决斗结束失败者出横幅。

## Task 7: 接入捉 UNO 罚抽横幅（按钮 / AI 自动）

**Files:**
- Modify: `index.html:1706-1717`（`catchUnoNow`）、`index.html:1291-1297`（`aiTurn` 捉玩家）

- [ ] **Step 1: catchUnoNow —— 被捉的 AI 头顶显示「🃏 抽 2」**

将 [index.html:1706-1717](Downloads/uno/index.html#L1706-L1717) 的 `catchUnoNow` 中，在 `renderAll();` 之后、`setMsg(...)` 之前插入：

```js
  UNOCore.draw(g, ai, 2);
  S.pendingCatch = null;
  renderAll();
  showHeadFx(ai, 'draw', { count: 2 });
  setMsg('🔔 捉到 ' + g.players[ai].name + ' 漏喊 UNO，罚抽 2 张');
  sfx('error');
```

- [ ] **Step 2: aiTurn —— AI 捉到玩家时玩家头顶显示「🃏 抽 2」**

将 [index.html:1291-1297](Downloads/uno/index.html#L1291-L1297) 的 `aiTurn` 捉玩家分支中，在 `renderAll();` 之后、`setMsg(...)` 之前插入：

```js
    S.missedUno = false;
    UNOCore.draw(g, 0, 2);
    renderAll();
    showHeadFx(0, 'draw', { count: 2 });
    setMsg('🔔 AI 捉到你漏喊 UNO！罚抽 2 张');
    sfx('error');
```

- [ ] **Step 3: 检查点**

浏览器手动验证（见 Task 8 清单 8-9）：玩家漏喊 UNO 被 AI 捉（约 40% 概率），自己头顶弹「🃏 抽 2」；点「捉 UNO」按钮捉 AI 时该 AI 头顶弹横幅。

## Task 8: 调试钩子 + 全量手动验证清单

**Files:**
- Modify: `index.html:1900-1904`（`?debug` 钩子）

- [ ] **Step 1: 调试钩子暴露新函数**

将 [index.html:1900-1904](Downloads/uno/index.html#L1900-L1904) 的：

```js
  window.__ui = { beginTurn, doPlay, doDraw, renderAll, runChanceFlow, startGame, catchUnoNow };
```

改为：

```js
  window.__ui = { beginTurn, doPlay, doDraw, renderAll, runChanceFlow, startGame, catchUnoNow, showHeadFx, syncHeadFx };
```

- [ ] **Step 2: 全量手动验证**

用浏览器打开 `index.html?debug`，开始一局 4 人游戏，逐项验证（每项都应在对应座位头顶出现横幅）：

1. 打出 **+2 / +4**：目标 AI 头顶出现「⛔ 跳过」与「🃏 抽 2/4」两条堆叠横幅，约 1.6s 淡出。
2. 打出 **skip**：下家头顶仅出现「⛔ 跳过」。
3. 触发 **铁索连环**：被链住的双方头顶出现常驻「🔇 禁言」紫色横幅并轻微浮动；此后任一方被罚抽牌，伙伴同受时伙伴头顶弹「🃏 抽 N」，且双方禁言横幅随断链消失。
4. 触发 **不幸 13**：该玩家头顶出现「🃏 抽 13」。
5. 触发 **闪电**：骰子结算后目标头顶出现「🃏 抽 N」。
6. 触发 **德州扑克 / 火攻**：结算后输家头顶出现「🃏 抽 N」。
7. 触发 **决斗**：结束抽牌者头顶出现「🃏 抽 N」。
8. 漏喊 **UNO 被 AI 捉**：玩家头顶出现「🃏 抽 2」。
9. 点 **捉 UNO** 按钮捉 AI：该 AI 头顶出现「🃏 抽 2」。
10. **0 牌加权**：多开几局，确认手里出现 0 牌的频率明显高于改前（约每 5 张牌 1 张）；开局首牌更常是 0。

- [ ] **Step 3: 回归运行测试**

Run: `cd /Users/hello/Downloads/uno && node test_logic.js`
Expected: 30 通过、0 失败（`buildDeck` 改动后 UI 手动验证不破坏核心逻辑测试）。

---

## 自审记录

- **Spec 覆盖**：0→24 张（Task 1-2）✓；头顶效果层/样式 C（Task 3）✓；showHeadFx/syncHeadFx/renderAll 接入（Task 4）✓；全部被动触发点（Task 5-7）✓；禁言常驻+断链（syncHeadFx 对账）✓；测试更新与手动清单（Task 1、8）✓；「明确不做」项（开局 draw2 不弹横幅、不改玩法）未引入。
- **占位符扫描**：无 TBD/TODO，所有步骤含完整代码。
- **类型/命名一致性**：`showHeadFx(idx, kind, opts)` / `syncHeadFx()` / `#headFxLayer` / `.headfx` 在 Task 4-8 中命名一致；`res.drawIdx`、`dopts._ponziEnded`、`eff.chainShared` 等字段与既有代码一致。
