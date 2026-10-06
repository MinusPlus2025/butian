# 补天 Mending the Sky

Tripothon S1 参赛作品（游戏赛道 · Tripo + World Labs 工具赛道）

- 在线试玩：https://minusplus2025.github.io/butian/
- 自动演示：https://minusplus2025.github.io/butian/?demo

天塌了，洪水不息。你是女娲：在洪水淹没山谷之前，按五行相生之序炼石补天。

- 世界：World Labs Marble 生成的 Gaussian splat 山谷（`assets/world.spz`）与碰撞网格（`assets/collider.glb`）
- 交互物件：Tripo 生成的五行石与铜鼎炉（`assets/stone_*.glb`, `assets/furnace.glb`）
- 渲染：three.js + Spark（splat 渲染），源码在 `source/`，用 esbuild 打包成单个 `index.html`

操作：WASD 移动 · 鼠标环顾 · Shift 冲刺 · 空格跳 · 左键抓石 / 扔进炉 · Esc 暂停
