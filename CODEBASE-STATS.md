# 代码量与依赖统计对比（AgentDock vs 原 LobeHub）

> 统计日期：2026-08-19
> 口径：代码行数 = 源文件（`ts/tsx/js/jsx/mjs/cjs/css/scss/less`）行数，均排除 `node_modules`、`dist`、`.next`、`.git` 与锁文件。
> 对比基线：原 LobeHub 采用本项目迁移基线 `/private/tmp/lobehub-canary`（LobeHub v2.2.11 canary）。

## 1. 总览对比

| 指标 | 现在的 AgentDock | 原 LobeHub（canary 2.2.11） | 比例 |
|---|---|---|---|
| 代码文件数 | 108 | 11,047 | 约 1% |
| 代码总行数 | 约 1.12 万 | 约 182.3 万 | 约 0.6% |
| 前端代码行数（Web） | 约 1.10 万（`src/`） | 约 64.9 万（`src/`） | 约 1.7% |
| 前端代码行数（Electron 桌面端） | 无 | 约 6.3 万（`apps/desktop`） | — |
| 文档行数（md/mdx） | 5,752 | 15.8 万 | 约 3.6% |
| package.json 依赖声明 | 25（20 依赖 + 5 dev） | Web 前端根包 384（286 + 98） | 约 6.5% |
| 工作区去重后的直接依赖声明 | 25 | 471（101 个 package.json） | 约 5.3% |
| 实际安装的包实例（node_modules/.pnpm） | 1,133 | 3,801（完整 clone 全量安装） | 约 30% |

## 2. 当前 AgentDock 仓库明细

- 跟踪文件：140 个
- 全部文本行数（不含 pnpm-lock.yaml）：17,329
- `ts/tsx`：107 个文件，11,218 行（`src/` 共 11,023 行）
- 其余：css 1 个，md 5,752 行，json/html 若干
- 依赖声明：`dependencies` 20 + `devDependencies` 5 = 25
- 实际安装：`node_modules/.pnpm` 1,133 项

## 3. 原 LobeHub（canary 2.2.11）分目录明细

| 目录 | 文件数 | 行数 | 说明 |
|---|---:|---:|---|
| `src/` | 5,454 | 648,571 | Web 前端核心 |
| `apps/desktop` | 293 | 63,464 | Electron 桌面端 |
| `apps/cli` | 167 | 43,478 | CLI |
| `apps/server` | 1,397 | 367,367 | 后端服务 |
| `packages/` | 3,537 | 674,348 | 共享库（前后端混合） |
| `e2e` / `tests` | 45 | 8,881 | 测试 |
| 仓库根及其他 | 154 | 16,970 | 配置文件、scripts 等 |
| **合计** | **11,047** | **1,823,079** | 另有 md/mdx 158,381 行 |

依赖：

- Web 前端根包 `package.json`：286 依赖 + 98 dev = 384
- `apps/desktop/package.json`：7 依赖 + 67 dev = 74
- 全工作区 101 个 package.json 去重后：471 个唯一直接声明
- 完整 clone（v2.2.14-canary.60，`/Users/chenguo/lobehub`）全量安装后：`.pnpm` 3,801 项

## 4. package.json 依赖声明 vs node_modules/.pnpm 的区别

这是两种完全不同的数量，不能直接对比：

| | package.json | node_modules/.pnpm |
|---|---|---|
| 含义 | 直接依赖的**需求清单**（顶层声明） | 实际安装的**包实例清单**（依赖解析结果） |
| 写的是 | 包名 + 版本范围（如 `"react": "^19.0.0"`） | 每个解析出的包实例目录（如 `react@19.0.0`） |
| 包含什么 | 只有项目自己直接引用的包 | 直接依赖 + 所有传递依赖 + 多版本 + peer 变体 + 平台包 |
| 数量级 | 十几个 ~ 几百个 | 通常数十倍于声明数 |

pnpm 的 `node_modules` 结构是「符号链接 + 内容寻址存储」：

```text
node_modules/
├── react/          # 直接依赖的符号链接 → .pnpm/react@19.0.0/node_modules/react
└── .pnpm/          # 虚拟 store，每个包一个实例目录
    ├── react@19.0.0/node_modules/react
    ├── react-dom@19.0.0/node_modules/react-dom
    │   └── node_modules/react  → 指向 react@19.0.0
    ├── @tanstack/query-core@5.x/node_modules/@tanstack/query-core
    └── ...
```

## 5. 为什么 pnpm 的条目数这么多

以本项目为例：25 个直接声明 → `.pnpm` 1,133 项，约 45 倍。原因是 `.pnpm` 里每个目录代表依赖解析图中的一个**实例节点**，而不是一个「项目依赖」：

1. **传递依赖展开**：每个直接依赖自己还有依赖（如 React 全家桶、工具链），逐层展开后节点数指数级增长，这是数量大头。
2. **同一包名多版本共存**：不同依赖可能锁定不同版本（如 `lodash@3` 与 `lodash@4` 并存），每个版本单独一个实例目录。
3. **peer 依赖变体**：同一个包在 peer 依赖解析不同时（如分别配 React 18 / React 19）会被拆成多个实例，保证隔离。
4. **平台 optional 包**：如 esbuild、rollup、fsevents 等会安装当前平台（macOS arm64）对应的变体，一个包可能对应多个平台条目。
5. **devDependencies 也装**：开发环境安装包含 dev 依赖，它们各自的依赖树同样全部展开。
6. **pnpm 不做全局提升**：npm/yarn 会把共享依赖提升到顶层复用，pnpm 则让每个包在自己目录里持有完整（符号链接的）依赖，所以实例条目更贴近解析图的真实规模。

因此「25 个声明 → 1,133 个实例」「384 个声明（全工作区 471）→ 3,801 个实例」是 pnpm 的正常现象，不是重复安装或异常膨胀。

> 补充：`pnpm-lock.yaml`（当前 11,189 行）是安装后的「事实清单」，记录每个包@版本 + peer 组合的精确解析结果，条目规模与 `.pnpm` 目录数基本对应；package.json 只描述「要什么」，lockfile/.pnpm 描述「装了什么」。

## 6. 统计来源

- 当前仓库：`git ls-files` 文件清单 + `git cat-file` 逐文件行数；`package.json` 声明计数；`node_modules/.pnpm` 目录数。
- 原 LobeHub：`/private/tmp/lobehub-canary`（v2.2.11 canary）文件系统统计；依赖声明读取根包与全部工作区 package.json。
- 完整安装实例数：`/Users/chenguo/lobehub`（v2.2.14-canary.60 全量 clone）的 `node_modules/.pnpm` 目录数。
