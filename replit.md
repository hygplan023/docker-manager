# Codex 管理中心

一个基于 Node.js + Express + Dockerode 的容器管理平台，提供暗黑中文主题界面，支持 Ollama 一键部署、模型管理、客户端连接配置及基础容器/镜像/数据卷管理。

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — 运行 API 服务器 (port 8080)
- `pnpm --filter @workspace/docker-manager run dev` — 运行前端 (port 18765)
- `pnpm run typecheck` — 全项目类型检查
- `pnpm run build` — 类型检查 + 构建所有包
- `pnpm --filter @workspace/api-spec run codegen` — 从 OpenAPI 规范重新生成 hooks 和 Zod 模式

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Dockerode (自动检测 Windows npipe / Linux socket)
- Frontend: React + Vite, Tailwind CSS, shadcn/ui, TanStack Query, Wouter
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API 合同（单一真实来源）
- `lib/api-client-react/src/generated/` — Orval 生成的 React Query hooks
- `lib/api-zod/src/generated/` — Orval 生成的 Zod 模式（服务器验证）
- `artifacts/api-server/src/routes/` — 后端路由
  - `docker.ts` — Docker 系统信息
  - `containers.ts` — 容器 CRUD
  - `images.ts` — 镜像管理
  - `volumes.ts` — 数据卷管理
  - `ollama.ts` — Ollama 部署、模型管理、客户端配置
- `artifacts/api-server/src/lib/docker.ts` — Dockerode 客户端 (Windows npipe / Linux socket)
- `artifacts/docker-manager/src/` — 前端 React 应用

## Architecture decisions

- **Docker 连接**: Windows 自动使用 `//./pipe/docker_engine` (npipe)，Linux/Mac 使用 `/var/run/docker.sock`
- **ssh2 / @grpc/grpc-js stubbing**: Dockerode 包含这些可选依赖，但在 esbuild 构建时用空模块 stub 替代（仅用于 socket/npipe 连接时不需要）
- **Ollama 模型拉取**: 使用 SSE (Server-Sent Events) 流式传输拉取进度，前端用 fetch + ReadableStream 实现实时进度条
- **无数据库**: 所有状态直接从 Docker daemon 读取，不需要持久化存储
- **OpenAPI-first**: 所有端点在 openapi.yaml 中定义后通过 Orval 生成类型安全的 hooks

## Product

- **系统概览**: Docker 引擎状态、Ollama 运行状态、最近容器列表
- **Ollama 管理**: 一键部署（端口检测/容器存在检测/数据卷持久化/OLLAMA_ORIGINS=*）、模型拉取（实时进度）、模型删除、客户端配置（Codex/Claude Code/Continue.dev）
- **容器管理**: 列表（运行中/全部切换）、启动/停止/重启/删除、日志查看
- **镜像管理**: 列表、删除
- **数据卷管理**: 列表、创建、删除

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Orval Params 命名冲突**: 如果操作同时有 path 参数 AND query 参数，Orval 会在 `generated/api.ts` 和 `generated/types/` 都生成相同名称的类型，导致 TS2308 错误。解决方案：把 query 参数移到后端固定值，或重命名 operationId。
- **ssh2 / @grpc/grpc-js**: Dockerode 会加载这些模块，但 Replit 环境中这些 native 模块没有构建。在 `build.mjs` 的 esbuild 插件中用空模块 stub 解决。
- **esbuild 重复 plugins 键**: JavaScript 对象中如果有重复的 `plugins` 键，后者会覆盖前者。确保 build.mjs 中只有一个 `plugins` 数组。
- **不要使用 DATABASE_URL**: 此项目不需要数据库，删除 lib/db 的 import 可避免启动错误。

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
