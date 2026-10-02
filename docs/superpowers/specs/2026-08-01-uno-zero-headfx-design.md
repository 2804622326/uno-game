# 设计文档：机会牌 0 加权（4→24）+ 玩家头顶被动效果横幅

日期：2026-08-01
项目：`/Users/hello/Downloads/uno`（单文件浏览器 UNO，`index.html`）

## 背景与目标

1. **提高「机会牌 0」的出现概率**：把牌组中的 0 从 4 张增加到 24 张（每色 6 张），让机会活动（庞氏/德州扑克/火攻/闪电/决斗/铁索/桃源/五谷）更频繁出现。
2. **玩家被动状态头顶显示效果**：玩家（含 AI）被罚抽牌、被跳过、被禁言（铁索连环）时，头顶显示彩色横幅效果。
3. **禁言只做视觉**：铁索连环不引入任何新玩法规则，仅用图标提示玩家处于禁言状态。

## 范围

- 只修改 `index.html`（核心逻辑 `UNOCore` + UI/渲染层）与 `test_logic.js`。
- 不新增文件、不引入依赖、不改玩法规则。

---

## 第 1 部分：0 牌加权（4 → 24 张）

### 牌组构成变化

`UNOCore.buildDeck()`（[index.html:409-425](Downloads/uno/index.html#L409-L425)）每色当前推入 1 张 0；改为每色推入 **6 张 0**。

| 项目 | 现状 | 改动后 |
| --- | --- | --- |
| 牌组总数 | 108 | **128** |
| 每色张数 | 25 | **30** |
| 每色 0 牌 | 1 | **6** |
| 每色数字牌（1-9） | 18 | 18（不变） |
| 每色动作牌（skip/reverse/draw2） | 6 | 6（不变） |
| 野牌 wild / wild4 | 各 4 | 各 4（不变） |
| 0 牌总数 | 4 | **24** |

### 概率影响

- 单张抽到 0：约 3.7% → 约 **18.8%**。
- 开局 7 张手牌至少含 1 张 0：约 24% → 约 **76%**。
- 机会活动触发频率显著上升，属预期效果。

### 其他影响

- 0 牌面值仍为 0 分，计分不受影响。
- AI 策略 `aiDecide` 对 0 牌打分最低（面值低），会倾向于留 0 到被迫出或垫牌时打出——不修改。
- 首张翻开的非野牌更可能为 0：`deal()` 不触发机会活动（只有打出时才触发），无副作用。

### 明确不做

- 不加概率池/加权抽取机制，保持纯牌组构成变化（用户已选定）。
- 不做可配置项，0 牌数量写死为 24（YAGNI）。

---

## 第 2 部分：玩家头顶效果横幅

### 视觉风格（已选定：风格 C · 彩色横幅）

三类效果均为**渐变胶囊 + 白色描边 + 弹入动画**（scale bounce），弹入后：

| 效果 | 触发含义 | 样式 |
| --- | --- | --- |
| 被罚抽牌 | 玩家被罚抽 N 张 | 红渐变胶囊「🃏 抽 N」，N 为实际张数 |
| 被跳过 | 玩家被跳过回合 | 橙渐变胶囊「⛔ 跳过」 |
| 禁言（铁索） | 铁索形成期间常驻 | 紫渐变胶囊「🔇 禁言」，轻微上下浮动动画，铁索解除后消失 |

- 瞬时效果（被罚抽牌 / 被跳过）：显示约 1.6s 后淡出。
- 同一座位同时有多个瞬时效果时**纵向堆叠**（垂直偏移约 26px）。

### 架构与数据流

- 新增 DOM 层 `#headFxLayer`：放在 `#table` 内、与 `#seats` 平级；`position:absolute; inset:0; pointer-events:none; z-index` 高于座位。独立成层可避免 `renderSeats()` 每次 `innerHTML=''` 重绘把气泡冲掉。
- 新增 UI 状态 `S._fx`：`{ [seatIdx]: { kind, count?, until? } }`。
  - `kind`：`'draw' | 'skip' | 'mute'`。
  - `count`：被罚抽牌的张数（仅 `draw`）。
  - `until`：瞬时效果的过期时间戳（`Date.now() + dur`）。
- 新增 `showHeadFx(idx, kind, opts)`：写入 `S._fx[idx]` 后调用 `syncHeadFx()`。
- 新增 `syncHeadFx()`：重建 `#headFxLayer` 内容——
  1. 遍历 `S._fx`，丢弃已过期条目，未过期的按其 `kind/count` 在对应座位上方渲染横幅；
  2. 若 `g.ironChain` 存在，为 `a`、`b` 两座位叠加「🔇 禁言」常驻横幅。
- `renderAll()` 末尾调用 `syncHeadFx()`：保证铁索形成/断链时禁言横幅自动出现/消失，且座位重绘后瞬时气泡能存活。

横幅定位：以 `seatPos(i, total)` 的坐标为准，在座位头像上方（`translate(-50%,-100%)` 再上移若干像素），多效果堆叠时依次上移。

### 触发点（覆盖全部被动罚抽来源）

| 场景 | 位置 | 调用 |
| --- | --- | --- |
| skip / +2 / +4 打出 | `afterPlay` | `eff.skipped` → `showHeadFx(skipped,'skip')`；`eff.drew.length>0` → `showHeadFx(skipped,'draw',{count})` |
| 铁索伙伴同受 | `afterPlay` / `afterDraw` | `eff.chainShared` / `dopts._chainShared` → `showHeadFx(partner,'draw',{count})` |
| 不幸 13 | `afterDraw` | `dopts._unlucky13` → `showHeadFx(idx,'draw',{count:13})` |
| 庞氏爆发 | `afterDraw` | `dopts._ponziEnded` → `showHeadFx(idx,'draw',{count:X})` |
| 闪电 | `doLightning` | `showHeadFx(res.target,'draw',{count:res.count})` |
| 德州扑克 / 火攻 | `finishShowdown` | `res.drawIdx` 非空 → `showHeadFx(res.drawIdx,'draw',{count:res.count})` |
| 决斗结束 | `finishDuelDraw` | `showHeadFx(idx,'draw',{count:info.X})` |
| 捉 UNO 罚 2（按钮） | `catchUnoNow` | `showHeadFx(ai,'draw',{count:2})` |
| AI 捉玩家漏喊 UNO | `aiTurn` | `showHeadFx(0,'draw',{count:2})` |
| 禁言常驻 | `renderAll` | 依据 `g.ironChain` 自动叠加 |

### 明确不做

- 开局首张动作牌（draw2）触发的开局惩罚不显示横幅（开局弹窗已提示）。
- 禁言不改任何玩法规则（用户已确认「只做视觉」）。

---

## 健壮性

- 座位不存在时安全返回（`seatEl(idx)` 为 null 直接跳过）。
- 过期瞬时效果在 `syncHeadFx()` 中丢弃，不留残影。
- 铁索断链后 `renderAll()` 重新同步，禁言横幅自动移除。

---

## 测试

### test_logic.js（更新）

- 更新「牌堆：108 张」用例：
  - 总数 `108` → `128`；
  - 每色 `25` → `30`；
  - 每色数字牌 `19` → `24`。
- 新增断言：`buildDeck()` 中 0 牌数量为 24（每色 6）。

### 头顶效果

- 头顶效果属于 UI/DOM 逻辑，不在 `test_logic.js`（纯 UNOCore 提取）范围内。
- 通过浏览器手动验证：各触发点（+2/+4/闪电/扑克/决斗/捉 UNO/铁索）出横幅、堆叠、1.6s 淡出、铁索断链后禁言消失。
