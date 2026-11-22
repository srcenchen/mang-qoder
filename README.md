# 听见 · 盲道行 3D (`⠞⠊⠝⠛ ⠚⠊⠁⠝ · ⠍⠁⠝⠛ ⠙⠁⠕ ⠭⠊⠝⠛`)

轻量级第一人称盲人视角城市无障碍共情互动小游戏，采用 **Vite + TypeScript + Three.js + Web Audio API + Tailwind CSS** 纯前端构建，零外部模型与音频网络依赖。

## 核心特性

- **声波光晕与触碰显色 Shader**：基于 `MeshStandardMaterial.onBeforeCompile` 实时渲染青色/琥珀色双色声波环，扫过处以 75% 饱和度短暂浮现湿滑路面、凸起盲道砖、共享单车与街角早点摊的真实 PBR 材质。
- **第一人称盲杖贴地扫探**：支持桌面端鼠标/键盘扫杖与移动端独立 `pointerId` 触控摇杆 + 敲杖按钮，通过 `Raycaster` 实时识别地面与障碍物材质。
- **纯合成 3D 空间声景**：原生 Web Audio API 合成差异化盲杖敲击声、脚步声、碰壁受挫音与震动反馈、街角早点摊空间环境声、斑马线双耳多普勒车流呼啸声与极简钢琴配乐。
- **盲汉互译无障碍 UI 与共情分享卡**：内置高对比度模式、声波停留时长调节（`1.5s / 2.5s / 4.0s`）、原生语音朗读（`speechSynthesis`），通关后使用离屏 `<canvas>` 本地生成 9:16 竖版公益共情海报。

## 本地开发与构建

```bash
npm install
npm run dev
npm run build
```
