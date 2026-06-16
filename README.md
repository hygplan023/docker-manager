# Codex 管理中心

> 开发工作室：**南充远达文化广告策划工作室**

## 项目简介

本平台基于 Codex 可视化管理 Ollama 本地大模型，支持容器启停、模型拉取、安全检测、Codex / Claude Code 本地直连调试，Windows / macOS 一键部署，无需复杂命令行操作。

## 核心功能

- Ollama 容器可视化管控，自动检测 11434 端口运行状态
- 本地模型拉取、查看、参数配置、性能测试
- Codex CLI 一键配置，自动生成跨平台启动脚本
- 离线安装包一键解压启动，适配 Windows 批处理 / macOS 脚本
- 完整 API 连通检测工具，快速排查本地模型连接问题

## 本地部署教程

### 方式一：Docker 一键运行（推荐，最稳定）

整套应用在 Docker 容器内完成依赖安装与构建，**无需在本机安装 Node.js / pnpm**，
彻底避免 Windows 上的依赖安装问题。前提：已安装并启动 **Docker Desktop**。

1. 下载并解压离线安装包 `dist-package.zip`
2. Windows：双击 `start-docker.bat`
   macOS / Linux：终端执行 `./start-docker.sh`
   （或在解压目录直接运行 `docker compose up -d --build`）
3. 首次运行会拉取基础镜像并构建，耗时几分钟，请耐心等待
4. 浏览器访问 **http://localhost:18765** 进入管理面板
5. 停止服务：双击 `stop-docker.bat`（或运行 `docker compose down`）

> 容器通过挂载宿主机 Docker 套接字来管理 Docker Desktop 中的容器/镜像/数据卷，
> 与 Portainer 的做法一致。注意：该套接字等同于宿主机的最高权限，且本平台默认不带登录鉴权，
> 因此默认仅监听本机 `127.0.0.1:18765`，不会暴露到局域网。如确需局域网访问，
> 请自行修改 `docker-compose.yml` 的端口映射并自担安全风险。

### 方式二：本机 Node.js 运行（备用）

需要本机已安装 **Node.js 20+** 与 **pnpm**，并启动 Docker Desktop。

1. 下载并解压离线安装包 `dist-package.zip`
2. Windows：双击 `start-windows.bat`；macOS / Linux：执行 `./start-mac.sh`
3. 脚本会自动安装依赖并启动前后端
4. 浏览器访问 **http://localhost:18765**

## 适配环境

- Windows 10/11、macOS 12+
- Docker Desktop 4.70 及以上（方式一只需这一项）
- 方式二额外需要：Node.js 20 LTS、pnpm 包管理器

## 版权信息
©2026 南充远达文化广告策划工作室 版权所有
未经许可严禁盗用、商用本设计，一切违法违规使用行为后果由使用者自行承担，我方不承担相关连带责任。
