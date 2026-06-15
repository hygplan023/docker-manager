import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Download, Terminal, Box, CheckCircle2, Copy, ExternalLink, BookOpen,
  Monitor, Server, Zap, AlertCircle, Loader2, XCircle, PackageOpen, Wifi,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

function CopyBlock({ code, label }: { code: string; label?: string }) {
  const { toast } = useToast();
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    toast({ title: "✅ 已复制" });
  };
  return (
    <div className="relative group">
      {label && <p className="text-xs text-muted-foreground mb-1.5">{label}</p>}
      <pre className="bg-[#0d1117] border border-[#30363d] rounded-lg p-4 text-xs font-mono text-gray-300 overflow-x-auto leading-relaxed">
        {code}
      </pre>
      <Button size="sm" variant="ghost" onClick={copy}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-7 text-xs text-muted-foreground hover:text-white">
        <Copy className="w-3 h-3 mr-1" /> 复制
      </Button>
    </div>
  );
}

function Step({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-bold text-sm">
        {num}
      </div>
      <div className="flex-1 pb-6">
        <h4 className="font-semibold text-white mb-3">{title}</h4>
        <div className="space-y-3 text-sm">{children}</div>
      </div>
    </div>
  );
}

const TABS = ["Windows 安装", "macOS / Linux", "Codex CLI 配置", "常见问题"];

interface CodexCheckResult {
  ollamaOk: boolean;
  ollamaModels: string[];
  ollamaError: string;
  codexInstalled: boolean;
  codexVersion: string;
  openaiBaseUrl: string;
  readyToRun: boolean;
  configYaml: string | null;
  winCmd: string;
  macCmd: string;
}

export default function Install() {
  const [activeTab, setActiveTab] = useState(0);
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CodexCheckResult | null>(null);
  const { toast } = useToast();

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: "✅ 已复制" });
  };

  const handleCodexCheck = async () => {
    setChecking(true);
    setCheckResult(null);
    try {
      const resp = await fetch("/api/codex/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ollamaUrl }),
      });
      const data = await resp.json() as CodexCheckResult;
      setCheckResult(data);
    } catch {
      toast({ variant: "destructive", title: "检测失败", description: "无法连接到 API 服务器" });
    } finally {
      setChecking(false);
    }
  };

  // GitHub 永久下载链接（永不过期）
  const PERMANENT_DOWNLOAD_URL = "https://github.com/hygplan023/docker-manager/raw/main/dist-package.zip";

  const handleDownload = () => {
    // 直接跳转让浏览器原生下载，避免 fetch+blob 将 100MB+ 加载进 JS 内存导致超时
    window.location.href = "/api/download/package";
    toast({ title: "⏳ 正在打包下载...", description: "浏览器将自动下载 docker-manager.zip，大文件请耐心等待" });
  };

  const handlePermanentDownload = () => {
    window.open(PERMANENT_DOWNLOAD_URL, "_blank");
    toast({ title: "⬇️ 正在下载...", description: "永久链接已打开，浏览器将下载 dist-package.zip" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white mb-2">本地安装指南</h2>
        <p className="text-muted-foreground">将 Docker 管理中心部署到本地 Windows / macOS 计算机，连接 Docker Desktop 进行可视化管理。</p>
      </div>

      {/* Top action bar: download + Codex check */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Download Card */}
        <Card className="bg-card border-card-border border-cyan-500/20">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <PackageOpen className="w-5 h-5 text-cyan-400" />
              <span className="font-semibold text-white">下载安装包</span>
            </div>
            <p className="text-xs text-muted-foreground">打包完整项目代码（含启动脚本），解压后一键运行</p>
            <div className="flex gap-2 flex-wrap">
              <Button onClick={handleDownload}
                className="bg-cyan-600 hover:bg-cyan-500 text-white text-sm h-9">
                <><Download className="w-4 h-4 mr-2" />下载 docker-manager.zip</>
              </Button>
              <Button onClick={handlePermanentDownload} variant="outline"
                className="border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 text-sm h-9">
                <><Download className="w-4 h-4 mr-2" />永久链接下载（永不过期）</>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">永久链接：<a href={PERMANENT_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline break-all">GitHub dist-package.zip</a></p>
            <p className="text-xs text-muted-foreground">解压后：Windows → 双击 <code className="text-cyan-300">start-windows.bat</code>，macOS/Linux → 运行 <code className="text-cyan-300">./start-mac.sh</code></p>
          </CardContent>
        </Card>

        {/* Codex Direct Connection Test */}
        <Card className="bg-card border-card-border border-purple-500/20">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-purple-400" />
              <span className="font-semibold text-white">Codex 直连测试</span>
            </div>
            <p className="text-xs text-muted-foreground">检测 Ollama API 是否可达，并生成可直接使用的 Codex 启动命令</p>
            <div className="flex gap-2">
              <Input value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder="http://localhost:11434" className="bg-background font-mono text-xs h-9 flex-1" />
              <Button onClick={handleCodexCheck} disabled={checking} variant="outline"
                className="border-purple-500/40 text-purple-400 hover:bg-purple-500/10 h-9 flex-shrink-0">
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Wifi className="w-4 h-4 mr-1.5" />检测</>}
              </Button>
            </div>
            {checkResult && (
              <div className="space-y-2">
                {[
                  { label: "Ollama API", ok: checkResult.ollamaOk, msg: checkResult.ollamaOk ? `可达 · ${checkResult.ollamaModels.length} 个模型` : checkResult.ollamaError },
                  { label: "Codex CLI", ok: checkResult.codexInstalled, msg: checkResult.codexInstalled ? checkResult.codexVersion : "未安装（运行 npm install -g @openai/codex）" },
                ].map(({ label, ok, msg }) => (
                  <div key={label} className={cn("flex items-center gap-2 text-xs rounded px-2.5 py-1.5 border",
                    ok ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400")}>
                    {ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                    <span className="font-medium">{label}:</span> {msg}
                  </div>
                ))}
                {checkResult.ollamaOk && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-xs text-muted-foreground">可直接在终端运行：</p>
                    <div className="relative group">
                      <pre className="bg-[#0d1117] border border-[#30363d] rounded p-2.5 text-xs font-mono text-cyan-300 overflow-x-auto leading-relaxed">
                        {checkResult.winCmd}
                      </pre>
                      <Button size="sm" variant="ghost" onClick={() => copy(checkResult.winCmd)}
                        className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 h-6 text-xs text-muted-foreground px-2">
                        <Copy className="w-3 h-3 mr-1" />复制
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { icon: Monitor, title: "支持平台", desc: "Windows 10/11 + Docker Desktop，macOS，Linux" },
          { icon: Server, title: "技术要求", desc: "Node.js 20+，pnpm，Docker Desktop，Git" },
          { icon: Zap, title: "启动时间", desc: "首次安装约 5 分钟，后续 < 10 秒" },
        ].map(({ icon: Icon, title, desc }) => (
          <Card key={title} className="bg-card border-card-border">
            <CardContent className="pt-4 flex gap-3">
              <Icon className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm text-white">{title}</p>
                <p className="text-xs text-muted-foreground mt-1">{desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-0">
          <div className="flex flex-wrap gap-1 border-b border-border pb-3">
            {TABS.map((tab, i) => (
              <button key={tab} onClick={() => setActiveTab(i)}
                className={cn("px-4 py-2 text-sm rounded-md transition-colors font-medium",
                  i === activeTab ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "text-muted-foreground hover:text-white hover:bg-muted/50")}>
                {tab}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {/* Windows 安装 */}
          {activeTab === 0 && (
            <div className="space-y-1">
              <Step num={1} title="安装前置条件">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[
                    { name: "Docker Desktop for Windows", url: "https://www.docker.com/products/docker-desktop/", badge: "必需" },
                    { name: "Node.js 20 LTS (Windows)", url: "https://nodejs.org/", badge: "必需" },
                    { name: "Git for Windows", url: "https://git-scm.com/download/win", badge: "必需" },
                    { name: "pnpm 包管理器", url: "https://pnpm.io/installation", badge: "必需" },
                  ].map((dep) => (
                    <a key={dep.name} href={dep.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-between p-3 rounded border border-border bg-background/40 hover:border-cyan-500/40 transition-colors group">
                      <span className="text-sm group-hover:text-cyan-400">{dep.name}</span>
                      <div className="flex items-center gap-2">
                        <Badge className="text-xs bg-cyan-500/10 text-cyan-400 border-cyan-500/30">{dep.badge}</Badge>
                        <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-cyan-400" />
                      </div>
                    </a>
                  ))}
                </div>
                <p className="text-muted-foreground">安装完成后，启动 Docker Desktop 并确保 Docker 守护进程已运行（任务栏图标变绿）。</p>
              </Step>

              <Step num={2} title="安装 pnpm（如未安装）">
                <CopyBlock code="npm install -g pnpm" label="在 PowerShell 或命令提示符中运行：" />
              </Step>

              <Step num={3} title="下载项目代码">
                <CopyBlock code={`# 克隆项目（替换为你的 Replit 项目 URL）
git clone https://github.com/your-username/docker-manager.git
cd docker-manager

# 或者从 Replit 下载 ZIP 文件后解压，进入目录`} />
                <div className="bg-cyan-500/5 border border-cyan-500/20 rounded p-3 text-xs text-cyan-300">
                  💡 也可在 Replit 项目页面点击右上角 ⋯ → 「Download as zip」下载压缩包
                </div>
              </Step>

              <Step num={4} title="安装依赖">
                <CopyBlock code="pnpm install" />
              </Step>

              <Step num={5} title="启动 API 服务器（后端）">
                <p className="text-muted-foreground">新开一个 PowerShell 窗口：</p>
                <CopyBlock code="pnpm --filter @workspace/api-server run dev" />
                <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded px-3 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 看到 "Server listening port: 8080" 表示后端启动成功
                </div>
              </Step>

              <Step num={6} title="启动前端界面">
                <p className="text-muted-foreground">再开一个 PowerShell 窗口：</p>
                <CopyBlock code="pnpm --filter @workspace/docker-manager run dev" />
                <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded px-3 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 看到 "Local: http://localhost:18765" 后，在浏览器打开此地址
                </div>
              </Step>

              <Step num={7} title="验证连接">
                <p className="text-muted-foreground">打开浏览器访问 <code className="text-cyan-400 font-mono">http://localhost:18765</code>，在系统概览页应能看到 Docker 引擎信息和容器列表。</p>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded p-3 text-xs text-amber-300 flex gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium mb-1">Windows 注意事项</p>
                    <p>本平台通过 Windows Named Pipe <code className="font-mono">//./pipe/docker_engine</code> 连接 Docker Desktop。确保 Docker Desktop 已启动且「在系统托盘运行」选项开启。</p>
                  </div>
                </div>
              </Step>
            </div>
          )}

          {/* macOS / Linux */}
          {activeTab === 1 && (
            <div className="space-y-1">
              <Step num={1} title="安装前置条件">
                <CopyBlock label="macOS (Homebrew)：" code={`# 安装 Homebrew（如未安装）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 安装 Node.js 和 pnpm
brew install node pnpm git

# 安装 Docker Desktop for Mac
# 从 https://www.docker.com/products/docker-desktop/ 下载`} />
                <CopyBlock label="Linux (Ubuntu/Debian)：" code={`# 安装 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 安装 pnpm
npm install -g pnpm

# 安装 Docker Engine
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER`} />
              </Step>

              <Step num={2} title="克隆并安装">
                <CopyBlock code={`git clone <项目地址>
cd docker-manager
pnpm install`} />
              </Step>

              <Step num={3} title="启动服务">
                <CopyBlock code={`# 终端 1 - 后端
pnpm --filter @workspace/api-server run dev

# 终端 2 - 前端
pnpm --filter @workspace/docker-manager run dev`} />
              </Step>

              <Step num={4} title="访问界面">
                <p className="text-muted-foreground">浏览器打开 <code className="text-cyan-400 font-mono">http://localhost:18765</code></p>
                <p className="text-muted-foreground mt-1">Linux 通过 <code className="font-mono text-cyan-400">/var/run/docker.sock</code> 连接 Docker，确保当前用户在 docker 组中。</p>
              </Step>
            </div>
          )}

          {/* Codex CLI 配置 */}
          {activeTab === 2 && (
            <div className="space-y-6">
              <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-4 text-sm text-cyan-300 space-y-2">
                <p className="font-semibold text-base">什么是 Codex CLI？</p>
                <p>OpenAI Codex CLI 是一个终端 AI 编程助手，支持接入 Ollama 等本地模型，完全离线运行，不消耗 OpenAI 额度。</p>
                <p>通过 MCP (Model Context Protocol) 插件，可以扩展 Codex 的能力：读写文件、执行命令、搜索网页等。</p>
              </div>

              <Step num={1} title="安装 Codex CLI">
                <CopyBlock code="npm install -g @openai/codex" />
              </Step>

              <Step num={2} title="配置使用 Ollama 本地模型">
                <p className="text-muted-foreground">创建配置文件 <code className="font-mono text-cyan-400">~/.codex/config.yaml</code>：</p>
                <CopyBlock code={`# ~/.codex/config.yaml
# 使用 Ollama 本地模型（无需 OpenAI API Key）

model: "codestral:latest"   # 替换为你拉取的模型名
provider: ollama
baseURL: "http://localhost:11434/v1"
apiKey: "ollama"            # 任意字符串（Ollama 不验证）
approvalMode: suggest       # suggest | auto-edit | full-auto`} />
                <p className="text-muted-foreground">或者用环境变量方式（无需配置文件）：</p>
                <CopyBlock label="Windows PowerShell：" code={`$env:OPENAI_BASE_URL = "http://localhost:11434/v1"
$env:OPENAI_API_KEY = "ollama"
npx @openai/codex "帮我写一个排序算法"`} />
                <CopyBlock label="macOS / Linux：" code={`export OPENAI_BASE_URL="http://localhost:11434/v1"
export OPENAI_API_KEY="ollama"
codex "帮我写一个排序算法"`} />
              </Step>

              <Step num={3} title="启用 MCP 插件（解锁 Codex 扩展能力）">
                <p className="text-muted-foreground">MCP 是 Model Context Protocol，让 Codex 能调用外部工具。常用插件：</p>
                <div className="space-y-3">
                  {[
                    { name: "文件系统访问", npm: "@modelcontextprotocol/server-filesystem", desc: "让 Codex 读写本地文件" },
                    { name: "Git 操作", npm: "@modelcontextprotocol/server-git", desc: "让 Codex 执行 Git 命令" },
                    { name: "网页搜索 (Brave)", npm: "@modelcontextprotocol/server-brave-search", desc: "让 Codex 搜索互联网" },
                    { name: "SQLite 数据库", npm: "@modelcontextprotocol/server-sqlite", desc: "让 Codex 查询 SQLite" },
                  ].map((plugin) => (
                    <div key={plugin.name} className="border border-border rounded p-3 bg-background/40 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-white text-sm">{plugin.name}</span>
                        <Button size="sm" variant="ghost" className="h-6 text-xs text-muted-foreground px-2"
                          onClick={() => copy(`npm install -g ${plugin.npm}`)}>
                          <Copy className="w-3 h-3 mr-1" /> 复制安装命令
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">{plugin.desc}</p>
                      <code className="text-xs font-mono text-cyan-300">npm install -g {plugin.npm}</code>
                    </div>
                  ))}
                </div>

                <p className="text-muted-foreground mt-2">在 <code className="font-mono text-cyan-400">~/.codex/config.yaml</code> 中添加插件：</p>
                <CopyBlock code={`model: "codestral:latest"
provider: ollama
baseURL: "http://localhost:11434/v1"
apiKey: "ollama"
approvalMode: suggest

tools:
  # 文件系统（允许访问当前目录）
  - type: mcp_server
    name: filesystem
    command: npx @modelcontextprotocol/server-filesystem .

  # Git 操作
  - type: mcp_server
    name: git
    command: npx @modelcontextprotocol/server-git

  # 网页搜索（需要 Brave API Key）
  # - type: mcp_server
  #   name: brave-search
  #   command: npx @modelcontextprotocol/server-brave-search
  #   env:
  #     BRAVE_API_KEY: "your-api-key"`} />
              </Step>

              <Step num={4} title="在 Docker 容器中运行 MCP 服务器">
                <p className="text-muted-foreground">如果想用容器来隔离 MCP 服务器环境：</p>
                <CopyBlock label="运行容器化 MCP 文件系统服务器：" code={`docker run -d \\
  --name mcp-filesystem \\
  -p 3001:3001 \\
  -v /path/to/workspace:/workspace \\
  --restart unless-stopped \\
  node:20-alpine sh -c "npx @modelcontextprotocol/server-filesystem /workspace --port 3001"`} />
                <CopyBlock label="在 config.yaml 中引用容器 MCP：" code={`tools:
  - type: mcp_server
    name: filesystem-docker
    command: node /workspace/mcp-client.js http://localhost:3001`} />
              </Step>

              <Step num={5} title="测试 Codex 是否正常工作">
                <CopyBlock code={`# 测试基本功能
codex "用 Python 写一个计算斐波那契数列的函数"

# 测试文件操作（需要 filesystem MCP）
codex "读取当前目录的文件列表并总结"

# 查看 Codex 版本
codex --version`} />
                <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded px-3 py-2 mt-2">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Codex 显示 AI 回复即表示配置成功，完全在本地运行，不需要 OpenAI 账号
                </div>
              </Step>
            </div>
          )}

          {/* 常见问题 */}
          {activeTab === 3 && (
            <div className="space-y-4">
              {[
                {
                  q: "Docker Desktop 已启动但显示「无法连接到 Docker」",
                  a: "Windows 上确认 Docker Desktop → Settings → General → 「Use the WSL 2 based engine」已关闭（使用 Hyper-V），或者确认 Named Pipe 访问权限。以管理员身份运行项目可解决权限问题。",
                },
                {
                  q: "端口 8080 或 18765 被占用",
                  a: "修改 API 服务器端口：编辑 artifacts/api-server/.replit-artifact/artifact.toml 中的 localPort。修改前端端口：在 artifacts/docker-manager/vite.config.ts 的 server.port 中更改。",
                },
                {
                  q: "Ollama 状态显示「API 不可达」",
                  a: "确认 Ollama 容器已部署且运行。如果是本地原生安装的 Ollama（非容器），平台也能检测到并配置，在「本地服务检测」中可以看到。",
                },
                {
                  q: "Codex 命令找不到 / not found",
                  a: "先运行 npm install -g @openai/codex。如果 npm 全局安装路径不在 PATH 中，用 npx @openai/codex 替代。",
                },
                {
                  q: "模型拉取卡在「0%」很长时间",
                  a: "这是正常的——Ollama 先下载元数据然后才显示进度。7B 模型约 4GB，40B 模型约 20GB+，取决于网络速度。可以点击「停止」重新尝试。",
                },
                {
                  q: "LM Studio 的模型检测不到",
                  a: "在 LM Studio 中：点击「Local Server」选项卡 → 点击「Start Server」→ 确认端口为 1234。然后在 Ollama 页面点击「检测本地服务」刷新。",
                },
              ].map(({ q, a }) => (
                <div key={q} className="border border-border rounded-lg overflow-hidden">
                  <div className="flex items-start gap-3 p-4 bg-background/30">
                    <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm font-medium text-white">{q}</p>
                  </div>
                  <div className="px-4 pb-4 pt-2 text-sm text-muted-foreground leading-relaxed pl-11">
                    {a}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
