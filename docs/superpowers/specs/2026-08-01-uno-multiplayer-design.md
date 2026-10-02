# UNO 多人联机设计

日期：2026-08-01
状态：已批准（用户确认方案 A，客户端瘦身 + 服务器重写回合驱动者的权衡均接受）

## 背景与目标

当前 UNO 游戏是单 HTML 文件（`index.html`），玩家对战 3 个 AI。全部纯游戏逻辑已封装在 `UNOCore` 闭包（index.html 第 468-960 行），通过 `globalThis.UNOCore` 暴露；渲染/UI 完全分离（第 1283 行之后）。特殊规则（机会牌-0 的 8 种活动、不幸13）已全部实现。

本次目标是增加**在线多人联机**能力：

- 同一局域网内，多台设备通过浏览器互联
- 房主运行一个 Node.js 小服务器，其他设备访问主机 IP 加入
- 服务器权威（server-authoritative），无法作弊、状态严格一致
- 房间未满时用 AI 补位（可在房主设置中配置）
- 支持 2-6 名玩家
- 保留单人模式全部现有功能

## 架构总览

```
单人模式（现有功能不变）：
  index.html ──直接调用──► UNOCore（本地闭包）──► 渲染器(本地 g)

多人模式（新增）：
  index.html(每个客户端) ──WebSocket指令──► server.js(Node, 权威)
     ▼渲染                              ▲   │ 用同一份 UNOCore
   收到快照+事件                    收到事件 ▼
                           广播快照+效果+提示 ──► 其他客户端
```

原则：

1. **规则零重复**：`UNOCore` 抽成共享模块，浏览器与 Node 共用同一份规则实现
2. **服务器是唯一权威**：持有唯一游戏状态 `g`，校验一切指令，AI 和特殊规则流转都由服务器驱动
3. **客户端是瘦客户端**：只做渲染、发指令、响应用户输入；不直接修改游戏状态
4. **座位重映射**：客户端收到广播后，把自己的座位重排为索引 0，现有渲染函数几乎不用改

## 交付物与文件

### 1. `uno-core.js`（新增，抽离 UNOCore）

从 `index.html` 第 468-960 行抽出的纯游戏逻辑。UMD 包装：

- 浏览器：`globalThis.UNOCore = {...}`
- Node：`module.exports = {...}`

导出内容与原 `UNOCore` 一致：`buildDeck, shuffle, newGame, deal, draw, playCard, nextIndex, oppositeOf, isWild, isChanceZero, valueOf, canPlay, legalPlayable, playableIndexes, hasPlayable, cardKey, countCardsOf, pickActivity, ACTIVITIES, applyShowdown, applyLightning, applyIron, applyDuelStart, duelDraw, pickLowestCards, discardCards, discardColorCards, scoreHand, roundEnd, isGameOver, chooseColorForAI, aiDecide`。

`index.html` 改为 `<script src="uno-core.js">` 加载，行为不变（回归验证单人模式）。

### 2. `server.js`（新增，Node 服务器）

依赖：`ws`（WebSocket 库）、Node 内置 `http` 用于静态文件托管。

职责：

- **静态托管**：serve `index.html`、`uno-core.js`，客户端访问 `http://<ip>:<port>` 即得游戏页面
- **房间管理**：创建房间（房间码）、加入房间、座位分配、就绪状态
- **权威状态**：持有每房间的 `g`，用 `UNOCore` 校验并应用所有指令
- **回合驱动者**：用 UNOCore 状态转移函数驱动回合流转，把渲染调用替换为广播事件
- **AI 运行**：AI 座位由服务器用 `UNOCore.aiDecide` 决策，带思考延时
- **提示下发**：需要玩家选择时（选色、选对手、亮牌、丢牌等）向对应客户端下发 prompt

### 3. `index.html`（改造，双模式）

- 单人模式：原样，走本地 UNOCore + 本地回合驱动
- 多人模式：作为瘦客户端
  - 接收 `{snapshot, yourSeat}`，座位重映射后交给现有渲染函数
  - 接收 `{effects:[...]}` 播放动画/消息
  - 接收 `{prompt}` 弹交互 UI，把用户选择作为 `choice` 发回服务器
  - 所有输入（出牌/抽牌/过牌/捉UNO/选色/选对手）改为发指令，不再直接调用 UNOCore

## 客户端座位重映射

服务器广播的状态含 `yourSeat`（玩家的权威座位号）。客户端收到后构造**视图状态**：

- 自己 → 索引 0（底部手牌，完整牌面）
- 其余玩家 → 按座位号顺序依次填充索引 1..N-1（顶部/两侧，牌数徽标）

现有 `renderHand()`（画索引 0）、`renderSeats()`（画索引 1..N-1）因此无需改动。座位布局沿用当前静态排布（顶部 AI / 左右 AI）。

## 消息协议（WebSocket JSON）

### 客户端 → 服务器

| 消息 | 说明 |
|---|---|
| `{type:'createRoom', name, maxPlayers}` | 创建房间 |
| `{type:'joinRoom', roomCode, name}` | 加入房间 |
| `{type:'setReady', ready}` | 就绪/取消就绪 |
| `{type:'startGame', settings}` | 房主开局（含 AI 补位设置） |
| `{type:'action', action:'play', cardIdx, color?}` | 出牌（color 用于野牌/＋4） |
| `{type:'action', action:'draw'}` | 抽牌 |
| `{type:'action', action:'pass'}` | 过牌（抽到可打出的牌后选择结束回合） |
| `{type:'action', action:'catchUno', seat}` | 捉他人漏喊 UNO |
| `{type:'choice', choice:{kind:'color', color}}` | 回应提示：选色 |
| `{type:'choice', choice:{kind:'target', seat}}` | 回应提示：选对手（德州/火攻/决斗） |
| `{type:'choice', choice:{kind:'reveal', cardIdx}}` | 回应提示：亮牌 |
| `{type:'choice', choice:{kind:'peach', indexes}}` | 回应提示：桃源结义丢牌 |
| `{type:'choice', choice:{kind:'duelColor', color}}` | 回应提示：决斗选色 |

### 服务器 → 客户端

| 消息 | 说明 |
|---|---|
| `{type:'state', snapshot, yourSeat}` | 状态快照（只含自己完整手牌，他人仅牌数） |
| `{type:'effects', effects:[...]}` | 动画/消息事件列表 |
| `{type:'prompt', prompt:{kind:'color'/'target'/'reveal'/'peach'/'duelColor', ...}}` | 需要该客户端做出选择 |
| `{type:'message', text, kind?}` | 状态栏/弹窗文案（含事件标题、结算等） |
| `{type:'error', message}` | 错误（如非法操作） |

**效果事件（effects）类型**：`play`（谁出了什么牌）、`draw`（谁抽了几张）、`skip`、`reverse`、`chanceStart`、`lightning`（骰子+目标+数量）、`showdown`（双方亮牌结果）、`duelStart`、`chainShared`、`unlucky13`、`ponziEnded`、`headFx`（头顶动画）、`roundEnd`、`gameOver`、`unoCalled`、`catchUno`。

## 特殊规则逐一的服务器处理

| 规则 | 服务器流程 |
|---|---|
| 野牌/＋4 选色 | 提示当前玩家选色 → 收到 choice 后应用 |
| 德州扑克/火攻 | 提示触发者选对手 → 提示触发者亮牌 → 提示对手亮牌（手牌互不可见）→ 广播双方亮牌 + `applyShowdown` 结果 |
| 决斗 | 提示触发者选颜色+对手 → 决斗期间出牌走正常 action → 服务器用 `g.duel` 约束 → 无法出牌者 `duelDraw` |
| 桃源结义 | 服务器按序提示每个玩家选牌丢弃 → `discardCards` |
| 闪电 | 服务器 `applyLightning` 掷骰 → 广播骰子+目标+数量 |
| 铁索连环 | 服务器 `applyIron` → 广播结链双方 |
| 五谷丰登 | 服务器 `discardColorCards` 对所有玩家执行 → 广播结果 |
| 庞氏骗局 | 服务器维护 `g.ponzi` 计数，首个被迫抽牌者按累计数抽牌 |
| 不幸13 | 服务器 `draw` 内建逻辑，抽满 13 张时触发 |
| 捉 UNO | 玩家漏喊 → 服务器维护 `pendingCatch`，其他玩家可发 `catchUno` 指令 |
| AI 补位 | 空位 AI 由服务器 `aiDecide` 决策，带思考延时 |

## 房间流程

1. 房主运行 `node server.js`，控制台打印局域网地址 `http://192.168.x.x:3000`
2. 房主在浏览器打开 `index.html` → 「创建房间」→ 设定房间码（4 位）、玩家人数、AI 补位开关
3. 朋友浏览器打开同一地址 → 「加入房间」→ 输入房间码 → 选座 → 就绪
4. 房主点击「开始游戏」→ 服务器用 `UNOCore.newGame` + `deal` 发牌 → 广播开局
5. 游戏进行；掉线玩家座位暂时由 AI 接管（见"健壮性"）

## 健壮性

- **断线处理**：玩家断线 → 服务器标记掉线，座位由 AI 接管，AI 补位逻辑复用；玩家重连可回到原座位（用房间码+座位号+昵称）——v1 支持基本重连，如时间不足可降级为"断线即 AI 接管，不可重连"并在实现计划中注明
- **服务器非权威时刻**：客户端本地有 `S.humanCanAct` 等 UI 状态，但**不参与规则判断**；所有合法性由服务器校验
- **延迟**：局域网内延迟可忽略；抽牌/出牌动画由客户端在收到 effects 后本地播放，服务器不等待动画完成

## 测试策略

1. **UNOCore 单元测试**：`uno-core.js` 抽离后，现有 `test_logic.js` 改为 `require('./uno-core.js')` 直接跑
2. **服务器流程测试**：Node 测试脚本用多个假 WebSocket 客户端模拟一局对局，断言：
   - 出牌合法性（无效牌被拒）
   - 非当前回合操作被拒
   - 特殊规则流转（德州、决斗、桃源、闪电、庞氏、不幸13）
   - AI 补位决策正常
   - 状态广播只含对端应见信息（他人手牌不可见）
3. **双端一致性**：手动用两个真实浏览器对局验证快照+事件渲染正确

## 分阶段实施

- **阶段 1**：抽离 `uno-core.js`，`index.html` 改为外链加载，回归单人模式 + 跑通 test_logic.js
- **阶段 2**：`server.js` 骨架（http 静态托管 + ws 房间/大厅/就绪/开局）
- **阶段 3**：基础回合流转（出牌/抽牌/过牌/野牌选色）服务器驱动 + 客户端瘦身
- **阶段 4**：特殊规则流程服务器化（德州、火攻、决斗、桃源、闪电、铁索、五谷、庞氏、捉UNO）
- **阶段 5**：AI 补位、断线处理、重连、双浏览器联调与测试

## 明确不做（YAGNI）

- 互联网跨公网对战（仅局域网）
- 观战模式
- 聊天功能
- 服务端持久化/计分榜
- 移动端单独的触摸专优化（沿用现有响应式即可）
