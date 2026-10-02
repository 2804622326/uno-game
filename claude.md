# CLAUDE.md - UNO Game Project

## 项目概述 (Project Overview)

这是一个浏览器基础的单人 UNO 游戏项目，玩家将对战 3 个 AI 对手。游戏完全运行在浏览器中，单个 HTML 文件包含所有 CSS 和 JavaScript，无需任何外部依赖。

## 当前状态

- **位置**: `/Users/hello/Downloads/uno`
- **文件**: 
  - `UNO-GAME-PROMPT.md` - 游戏开发需求文档 (已翻译为中文,包含特殊规则)
  - `claude.md` - 本项目上下文文档
  - `/assets/references/card-design-reference.css` - CSS 卡牌样式参考
  - `/assets/references/card-design-reference.js` - JavaScript 卡牌生成参考

## 技术要求 (Technical Requirements)

- 单个 `.html` 文件，无外部依赖
- 纯 HTML5, CSS3, 原生 JavaScript (无框架)
- 响应式设计 (桌面和移动)
- 所有卡牌资产通过 CSS 编程生成
- 平滑动画效果
- 本地存储用于设置

## 代码结构建议 (Code Structure)

- `Game` 类 - 管理游戏状态
- `Renderer` 类 - 处理 DOM 更新
- 清晰的关注点分离

## 游戏规则摘要 (Key Rules)

- 108 张标准 UNO 牌
- 4 种颜色 (红, 绿, 蓝, 黄)
- 动作牌: Skip, Reverse, Draw Two, Wild, Wild Draw Four
- 胜利条件: 首先达到 500 分

## 开发优先级

1. 游戏核心逻辑 (洗牌, 发牌, 回合制)
2. 卡牌匹配系统
3. AI 行为实现
4. 用户界面和动画
5. 计分系统

## 成功标准

- [ ] 游戏加载并立即开始
- [ ] 玩家可以点击打出有效卡牌
- [ ] 玩家不能打出无效卡牌
- [ ] 抽牌堆正常工作
- [ ] UNO 规则执行
- [ ] AI 自动进行回合
- [ ] 野牌颜色选择
- [ ] 回合方向/跳过工作
- [ ] 多轮计分制
- [ ] 500 分获胜屏幕
- [ ] 移动端响应式