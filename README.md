# GeoSentry 3D（空间哨兵 · 合规分析平台）

基于 **Vue3 + TypeScript + Cesium** 的空间智能前端应用，对实景三维模型（3D Tiles / 倾斜摄影）进行自动测量、自动标注、自动合规分析与报告输出。

**在线演示（GitHub Pages）**：https://ggopen.github.io/geosentry3d/

> 核心原则：**Never guess geometry. Always call measurement tools.**
> 系统内所有测量数值均由测量引擎基于真实采样几何计算得出，绝不允许臆造。

## 核心业务流程

```text
3D Tiles → Object Detection → Geometry Analysis → Measurement Engine
        → Rule Engine → Spatial Annotation → Compliance Report
```

## 功能特性

| 模块 | 说明 |
| --- | --- |
| Cesium Viewer | 加载互联网 3D Tiles 实景三维数据（默认示例：mars3d 寺庙倾斜摄影） |
| Measurement Engine | 距离 / 高度 / 面积 / 体积 / 角度 / 净空，按对象类型自动选择测量方法 |
| Object Recognition Agent | 基于 OBB 几何启发式识别 door / window / building / fence / pole / road / tree |
| Spatial Rule Engine | DSL 规则解析与求值：`door.width >= 0.9`、`count(window) > 4`、`IF building.height > 30 THEN fireLevel = Level1`，支持 AND/OR |
| Spatial Annotation | 定向包围盒 + 标签，Red=违规 / Yellow=警告 / Green=合规 |
| Report Engine | 一键导出 HTML / JSON / CSV 合规分析报告 |
| 交互测量 | 手动测距 / 测面 / 测高 |
| 自动扫描 | 全场景网格采样 + 连通域聚类，自动发现凸出对象并批量分析 |
| 点击分析 | 点击模型表面 → 局部采样 → 识别 → 测量 → 合规 → 标注 全流程 |

## 技术架构

```text
/src
  /core         领域类型（SpatialObject / Measurement / ComplianceResult ...）
  /measurement  MeasurementEngine（纯计算，与 Cesium 解耦）+ 交互测量工具
  /rules        Spatial Rule Engine（DSL 分词 / 递归下降解析 / 求值）
  /annotation   AnnotationLayer（Cesium 实体渲染）
  /agents       多 Agent：Recognition / Measurement / Compliance / Annotation / Orchestrator
  /components   Vue 组件（Viewer / ObjectList / RuleEditor）
  /services     SceneService（采样工具）/ ReportEngine / AppController
  /store        Pinia 状态管理
  /utils        纯几何计算（Haversine / 测地面积 / PCA-OBB / 网格聚类）
/tests          vitest 单元测试（37 例）
```

- 模块间通过接口与 Pinia 解耦，符合 Clean Architecture；
- 所有引擎核心（测量 / 规则 / 识别）不依赖 Cesium，可独立测试与替换；
- 每个函数均带 TypeScript 类型标注。

## 本地开发

```bash
pnpm install
pnpm dev        # 开发服务器
pnpm test       # 单元测试（vitest）
pnpm build      # 生产构建（输出 dist/）
pnpm preview    # 预览构建产物
```

## 部署

构建产物 `dist/` 使用相对路径（`base: './'`），可直接发布到 GitHub Pages 任意子路径：

```bash
pnpm build
# 将 dist/ 内容推送到 gh-pages 分支即可
```

## 测试覆盖

- `tests/geo.test.ts` —— 距离 / 面积 / 角度 / PCA-OBB / 聚类
- `tests/rules.test.ts` —— DSL 解析求值、文档示例（宽 0.83m 的门 → FAIL）、IF-THEN 推导
- `tests/measurement.test.ts` —— 自动测量选择与计算
- `tests/recognition.test.ts` —— 对象识别启发式 + 多 Agent 流水线输出 schema
