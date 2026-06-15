import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  Download, Trash2, CheckCircle2, XCircle, Terminal, Copy, RefreshCw, Square,
  Activity, Zap, Loader2, StopCircle, ScrollText, Wifi, WifiOff, Plug2,
  MonitorCheck, Search, Cpu, Bot, FolderOpen, Rocket, Brain,
  AlertTriangle, ChevronRight, Play,
} from "lucide-react";
import {
  useGetOllamaStatus, useListOllamaModels, useDeleteOllamaModel,
  useGetOllamaClientConfig, useTestOllamaConnection,
  useRestartOllama, useStopOllama, useGetOllamaLogs,
  getGetOllamaStatusQueryKey, getListOllamaModelsQueryKey,
} from "@workspace/api-client-react";
import { formatBytes, formatRelative } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Custom Tabs (no Radix — avoids React hook crash) ────────────────────────
function TabBar({ tabs, active, onChange }: { tabs: string[]; active: number; onChange: (i: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1 p-1 bg-background border border-border rounded-lg">
      {tabs.map((t, i) => (
        <button key={t} onClick={() => onChange(i)}
          className={cn("px-3 py-1.5 text-xs rounded-md transition-colors font-medium",
            i === active ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "text-muted-foreground hover:text-white hover:bg-muted/40")}>
          {t}
        </button>
      ))}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface TestResult { loading: boolean; success?: boolean; message?: string; latencyMs?: number | null; models?: string[]; }
interface AiService { type: string; name: string; port: number; baseUrl: string; openaiBaseUrl: string; models: string[]; status: string; }
interface LaunchCheck { label: string; ok: boolean; message: string; hint?: string; }
interface LaunchResult {
  ready: boolean;
  checks: LaunchCheck[];
  availableModels: string[];
  resolvedModel: string;
  baseUrl: string;
  openaiBaseUrl: string;
  commands: {
    codex: { configYaml: string; win: string; mac: string; linux: string };
    claude: { win: string; mac: string; linux: string };
  };
}
interface ModelPathInfo {
  success: boolean;
  modelName: string;
  baseDir: string;
  manifestPath: string;
  blobsDir: string;
  volumeMount: string;
  verified: boolean;
  hint: string;
}

// ─── Config generators ────────────────────────────────────────────────────────
const genContinueConfig = (baseUrl: string, model: string) =>
  JSON.stringify({ models: [{ title: `Ollama — ${model}`, provider: "ollama", model, apiBase: baseUrl }] }, null, 2);

// ─── Sub-components ───────────────────────────────────────────────────────────
function ServiceBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ollama: { label: "Ollama", cls: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
    lmstudio: { label: "LM Studio", cls: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
    jan: { label: "Jan", cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    "openai-compat": { label: "OpenAI 兼容", cls: "bg-green-500/15 text-green-400 border-green-500/30" },
  };
  const s = map[type] || { label: type, cls: "bg-muted text-muted-foreground" };
  return <Badge className={cn("text-xs border", s.cls)}>{s.label}</Badge>;
}

function ConnectBlock({ label, text, copyKey, copiedKey, onCopy, onTest, testResult, disabled }: {
  label: string; text: string; copyKey: string; copiedKey: string | null;
  onCopy: (text: string, key: string) => void; onTest: () => void;
  testResult?: TestResult; disabled?: boolean;
}) {
  return (
    <div className={cn("border rounded-lg p-4 space-y-2", disabled ? "border-border/40 opacity-60" : "border-border bg-background/30")}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={disabled} onClick={() => onCopy(text, copyKey)}>
            {copiedKey === copyKey ? <><CheckCircle2 className="w-3.5 h-3.5 mr-1 text-green-400" />已复制</> : <><Copy className="w-3.5 h-3.5 mr-1" />复制</>}
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={disabled || testResult?.loading} onClick={onTest}>
            {testResult?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><MonitorCheck className="w-3.5 h-3.5 mr-1" />测试</>}
          </Button>
        </div>
      </div>
      {testResult && !testResult.loading && (
        <div className={cn("text-xs flex items-start gap-2 rounded px-3 py-2 border",
          testResult.success ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400")}>
          {testResult.success ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
          <div>
            <span>{testResult.message}</span>
            {!testResult.success && (
              <p className="text-xs text-muted-foreground mt-0.5">排查：确认容器状态 → 检查端口映射 11434:11434 → 确认 OLLAMA_ORIGINS=* 已设置</p>
            )}
          </div>
        </div>
      )}
      <pre className="p-3 rounded-md bg-[#0d1117] overflow-x-auto text-xs font-mono text-gray-300 border border-[#30363d] leading-relaxed">{text}</pre>
    </div>
  );
}

// ─── Launch Modal ─────────────────────────────────────────────────────────────
function LaunchModal({ open, onClose, tool, selectedModel }: {
  open: boolean; onClose: () => void; tool: "codex" | "claude"; selectedModel: string;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LaunchResult | null>(null);
  const [platformTab, setPlatformTab] = useState(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const { toast } = useToast();

  const checkAndLoad = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const resp = await fetch("/api/ollama/launch-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: selectedModel, tool }),
      });
      const data = await resp.json() as LaunchResult;
      setResult(data);
    } catch {
      toast({ variant: "destructive", title: "检测失败" });
    } finally {
      setLoading(false);
    }
  }, [selectedModel, tool, toast]);

  useEffect(() => { if (open) checkAndLoad(); }, [open, checkAndLoad]);

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    toast({ title: "✅ 已复制到剪贴板" });
  };

  const platforms = ["Windows (PowerShell)", "macOS / Linux"];

  const getCommand = () => {
    if (!result) return "";
    if (tool === "codex") return platformTab === 0 ? result.commands.codex.win : result.commands.codex.mac;
    return platformTab === 0 ? result.commands.claude.win : result.commands.claude.mac;
  };

  const isCodex = tool === "codex";
  const accentColor = isCodex ? "cyan" : "purple";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-[#0d1117] border border-[#30363d] max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className={cn("flex items-center gap-2", isCodex ? "text-cyan-400" : "text-purple-400")}>
            {isCodex ? <Terminal className="w-5 h-5" /> : <Brain className="w-5 h-5" />}
            一键启动 {isCodex ? "Codex CLI" : "Claude Code"} — 本地模型模式
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs">
            {isCodex ? "使用 Ollama 本地模型运行 OpenAI Codex CLI，完全离线，不消耗 API 额度" : "配置 Claude Code 接入 Ollama 本地模型，替代 Anthropic 云端 API"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Pre-check */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">前置检测</span>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={checkAndLoad} disabled={loading}>
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <><RefreshCw className="w-3 h-3 mr-1" />重新检测</>}
              </Button>
            </div>
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 border border-border rounded-lg">
                <Loader2 className="w-4 h-4 animate-spin" /> 正在检测环境...
              </div>
            )}
            {result && (
              <div className="space-y-1.5">
                {result.checks.map((check, i) => (
                  <div key={i} className={cn("flex items-start gap-2.5 text-xs rounded-lg px-3 py-2.5 border",
                    check.ok ? "bg-green-500/10 border-green-500/20" : "bg-red-500/10 border-red-500/20")}>
                    {check.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />}
                    <div>
                      <span className={cn("font-medium", check.ok ? "text-green-300" : "text-red-300")}>{check.label}</span>
                      <span className="text-muted-foreground ml-1">—</span>
                      <span className={cn("ml-1", check.ok ? "text-green-400" : "text-red-400")}>{check.message}</span>
                      {check.hint && !check.ok && (
                        <p className="text-amber-400/80 mt-0.5 flex items-center gap-1">
                          <ChevronRight className="w-3 h-3" />{check.hint}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {result && (
            <>
              {!result.ready && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium mb-1">环境未就绪，无法启动</p>
                    <p>请解决上述红色项目后重新检测。确保 Ollama 已部署、端口可达、已拉取至少一个模型。</p>
                  </div>
                </div>
              )}

              {result.ready && (
                <div className="space-y-3">
                  {/* Install hint */}
                  {isCodex && (
                    <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-3 text-xs text-cyan-300 space-y-1">
                      <p className="font-medium">① 安装 Codex CLI（如未安装）</p>
                      <div className="relative group">
                        <pre className="bg-[#0d1117] rounded p-2 font-mono text-gray-300">npm install -g @openai/codex</pre>
                        <Button size="sm" variant="ghost" onClick={() => copy("npm install -g @openai/codex", "install-codex")}
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 h-6 text-xs px-2 text-muted-foreground">
                          {copiedKey === "install-codex" ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                  )}
                  {!isCodex && (
                    <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-3 text-xs text-purple-300 space-y-1">
                      <p className="font-medium">① 安装 Claude Code（如未安装）</p>
                      <div className="relative group">
                        <pre className="bg-[#0d1117] rounded p-2 font-mono text-gray-300">npm install -g @anthropic-ai/claude-code</pre>
                        <Button size="sm" variant="ghost" onClick={() => copy("npm install -g @anthropic-ai/claude-code", "install-claude")}
                          className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 h-6 text-xs px-2 text-muted-foreground">
                          {copiedKey === "install-claude" ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Platform commands */}
                  <div>
                    <p className="text-xs font-semibold text-white mb-2">② 选择平台，复制命令到终端执行</p>
                    <TabBar tabs={platforms} active={platformTab} onChange={setPlatformTab} />
                    <div className="mt-2 relative group">
                      <pre className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3 text-xs font-mono text-cyan-300 leading-relaxed overflow-x-auto whitespace-pre-wrap">
                        {getCommand()}
                      </pre>
                      <Button size="sm" variant="ghost" onClick={() => copy(getCommand(), `cmd-${platformTab}`)}
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 h-7 text-xs text-muted-foreground hover:text-white">
                        {copiedKey === `cmd-${platformTab}` ? <><CheckCircle2 className="w-3 h-3 mr-1 text-green-400" />已复制</> : <><Copy className="w-3 h-3 mr-1" />复制</>}
                      </Button>
                    </div>
                  </div>

                  {/* Config YAML for Codex */}
                  {isCodex && (
                    <div>
                      <p className="text-xs font-semibold text-white mb-1">或使用配置文件方式（推荐）</p>
                      <p className="text-xs text-muted-foreground mb-2">将以下内容保存为 <code className="text-cyan-300">~/.codex/config.yaml</code>，之后只需输入 <code className="text-cyan-300">codex</code> 即可启动</p>
                      <div className="relative group">
                        <pre className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3 text-xs font-mono text-gray-300 leading-relaxed overflow-x-auto">
                          {result.commands.codex.configYaml}
                        </pre>
                        <Button size="sm" variant="ghost" onClick={() => copy(result.commands.codex.configYaml, "config-yaml")}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 h-7 text-xs text-muted-foreground hover:text-white">
                          {copiedKey === "config-yaml" ? <><CheckCircle2 className="w-3 h-3 mr-1 text-green-400" />已复制</> : <><Copy className="w-3 h-3 mr-1" />复制</>}
                        </Button>
                      </div>
                      <div className="mt-2 bg-amber-500/5 border border-amber-500/20 rounded p-2.5 text-xs text-amber-300">
                        <span className="font-medium">💡 MCP 插件解锁：</span>在 config.yaml 末尾追加 <code className="font-mono">tools:</code> 段落，可接入文件系统、Git、网页搜索等扩展。详见「安装指南」→「Codex CLI 配置」。
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    使用模型: <span className="font-mono font-medium">{result.resolvedModel}</span>
                    <span className="mx-1 text-muted-foreground">|</span>
                    API: <span className="font-mono text-cyan-300">{result.openaiBaseUrl}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Model Path Modal ─────────────────────────────────────────────────────────
function ModelPathModal({ modelName, open, onClose }: { modelName: string; open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<ModelPathInfo | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!open || !modelName) return;
    setLoading(true);
    fetch(`/api/ollama/models/${encodeURIComponent(modelName)}/path`)
      .then((r) => r.json())
      .then((d) => setInfo(d as ModelPathInfo))
      .catch(() => toast({ variant: "destructive", title: "获取路径失败" }))
      .finally(() => setLoading(false));
  }, [open, modelName, toast]);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: "✅ 已复制" });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-[#0d1117] border border-[#30363d] max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-cyan-400 flex items-center gap-2">
            <FolderOpen className="w-5 h-5" /> 模型存储路径
          </DialogTitle>
          <DialogDescription className="text-muted-foreground text-xs font-mono">{modelName}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 获取路径信息...
          </div>
        ) : info ? (
          <div className="space-y-3">
            {[
              { label: "基础目录", value: info.baseDir, desc: "Ollama 数据根目录" },
              { label: "Manifest 文件", value: info.manifestPath, desc: "模型元数据（版本、层信息）", highlight: true },
              { label: "Blobs 目录", value: info.blobsDir, desc: "模型权重文件（sha256 命名）" },
              { label: "数据卷挂载", value: info.volumeMount, desc: "容器重启不丢失数据" },
            ].map(({ label, value, desc, highlight }) => (
              <div key={label} className={cn("rounded-lg border p-3 space-y-1", highlight ? "border-cyan-500/30 bg-cyan-500/5" : "border-border bg-background/30")}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{label}</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground px-2" onClick={() => copy(value)}>
                    <Copy className="w-3 h-3 mr-1" />复制
                  </Button>
                </div>
                <code className="text-xs font-mono text-cyan-300 break-all block">{value}</code>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
            <div className={cn("flex items-center gap-2 text-xs rounded px-3 py-2 border",
              info.verified ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-amber-500/10 border-amber-500/20 text-amber-400")}>
              {info.verified ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              {info.verified ? "路径已在容器内验证存在" : "路径基于 Ollama 命名规范推算（未实际验证）"}
            </div>
            <p className="text-xs text-muted-foreground bg-background/40 border border-border/50 rounded p-2.5">{info.hint}</p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm text-center py-4">无法获取路径信息</p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────
const QUICK_MODELS = ["codestral:latest", "deepseek-coder:6.7b", "qwen2.5-coder:7b", "llama3:8b", "mistral:latest"];
const CLIENT_TABS = ["Codex Desktop", "Codex CLI", "Claude Code", "Continue.dev", "Open WebUI"];
const CLAUDE_TABS = ["macOS / Linux", "Windows PS"];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Ollama() {
  const { data: status, refetch: refetchStatus } = useGetOllamaStatus();
  const { data: models, isLoading: isModelsLoading, refetch: refetchModels } = useListOllamaModels();
  const { data: config } = useGetOllamaClientConfig();
  const deleteModel = useDeleteOllamaModel();
  const testConnection = useTestOllamaConnection();
  const restartOllama = useRestartOllama();
  const stopOllama = useStopOllama();
  const { data: logsData, refetch: refetchLogs } = useGetOllamaLogs();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Polling
  useEffect(() => {
    const id = setInterval(() => refetchStatus(), 8000);
    return () => clearInterval(id);
  }, [refetchStatus]);
  useEffect(() => {
    if (!status?.apiReachable) return;
    const id = setInterval(() => refetchModels(), 15000);
    return () => clearInterval(id);
  }, [status?.apiReachable, refetchModels]);

  // Pull state
  const [pullModelName, setPullModelName] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const [pullStatusText, setPullStatusText] = useState("");
  const [pullDone, setPullDone] = useState(false);
  const [pullError, setPullError] = useState(false);
  const [pullingModelName, setPullingModelName] = useState("");

  // UI state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  // Tab state (custom — no Radix)
  const [clientTab, setClientTab] = useState(0);
  const [claudeTab, setClaudeTab] = useState(0);

  // Model selector for configs
  const [selectedModel, setSelectedModel] = useState("");

  // Local AI service detection
  const [detectedServices, setDetectedServices] = useState<AiService[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [detectedOnce, setDetectedOnce] = useState(false);

  // Launch modals
  const [launchTool, setLaunchTool] = useState<"codex" | "claude" | null>(null);

  // Model path modal
  const [pathModelName, setPathModelName] = useState<string | null>(null);

  const logsScrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (models && models.length > 0 && !selectedModel) setSelectedModel(models[0].name);
  }, [models]);

  useEffect(() => { if (logsOpen) refetchLogs(); }, [logsOpen]);
  useEffect(() => {
    if (logsScrollRef.current) logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
  }, [logsData]);

  const detectLocalServices = useCallback(async () => {
    setDetecting(true);
    try {
      const resp = await fetch("/api/detect-ai-services");
      const services = (await resp.json()) as AiService[];
      setDetectedServices(services);
      setDetectedOnce(true);
      if (services.length > 0) toast({ title: `✅ 检测到 ${services.length} 个本地 AI 服务` });
      else toast({ title: "未检测到本地 AI 服务", description: "确保 Ollama / LM Studio 已启动" });
    } catch {
      toast({ variant: "destructive", title: "检测失败" });
    } finally {
      setDetecting(false);
    }
  }, [toast]);

  const handlePullModel = async (modelName?: string) => {
    const name = (modelName || pullModelName).trim();
    if (!name) return;
    setPullingModelName(name);
    if (modelName) setPullModelName(modelName);
    setPulling(true); setPullProgress(0); setPullStatusText("正在连接 Ollama...");
    setPullDone(false); setPullError(false);
    try {
      const response = await fetch("/api/ollama/models/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "请求失败" })) as { error?: string };
        throw new Error(err.error || "请求失败");
      }
      if (!response.body) throw new Error("无响应流");
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n").filter(Boolean)) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as { status?: string; total?: number; completed?: number; error?: string };
              if (data.error) { setPullStatusText(`错误: ${data.error}`); setPullError(true); setPulling(false); return; }
              setPullStatusText(data.status || "拉取中...");
              if (data.total && data.completed) setPullProgress(Math.round((data.completed / data.total) * 100));
              if (data.status === "success") {
                setPullProgress(100); setPullStatusText("拉取成功！"); setPullDone(true);
                toast({ title: "✅ 拉取成功", description: `模型 ${name} 已下载完成` });
                queryClient.invalidateQueries({ queryKey: getListOllamaModelsQueryKey() });
                setPulling(false); setPullModelName(""); setPullingModelName(""); return;
              }
              if (data.status === "已停止拉取") { setPullStatusText("已手动停止"); setPulling(false); setPullingModelName(""); return; }
            } catch { /* ignore */ }
          }
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "连接中断";
      setPullStatusText(msg); setPullError(true);
    }
    setPulling(false); setPullingModelName("");
  };

  const handleStopPull = async () => {
    await fetch("/api/ollama/models/stop-pull", { method: "POST" });
    setPulling(false); setPullStatusText("已手动停止拉取"); setPullingModelName("");
  };

  const confirmDeleteModel = () => {
    if (!deleteTarget) return;
    const name = deleteTarget;
    setDeleteTarget(null);
    deleteModel.mutate({ name }, {
      onSuccess: () => {
        toast({ title: "已删除" });
        queryClient.invalidateQueries({ queryKey: getListOllamaModelsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetOllamaStatusQueryKey() });
      },
      onError: (err) => toast({ variant: "destructive", title: "删除失败", description: String(err) }),
    });
  };

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key); setTimeout(() => setCopiedKey(null), 2000);
      toast({ title: "✅ 已复制到剪贴板" });
    } catch { toast({ variant: "destructive", title: "复制失败" }); }
  };

  const handleTestConnection = (url: string, key: string) => {
    setTestResults((p) => ({ ...p, [key]: { loading: true } }));
    testConnection.mutate({ data: { url } }, {
      onSuccess: (res) => setTestResults((p) => ({ ...p, [key]: { loading: false, success: res.success, message: res.message, latencyMs: res.latencyMs, models: res.models } })),
      onError: (err) => setTestResults((p) => ({ ...p, [key]: { loading: false, success: false, message: String(err) } })),
    });
  };

  const handleRestart = () => restartOllama.mutate(undefined, {
    onSuccess: () => { toast({ title: "已重启" }); queryClient.invalidateQueries({ queryKey: getGetOllamaStatusQueryKey() }); },
  });
  const handleStop = () => stopOllama.mutate(undefined, {
    onSuccess: () => { toast({ title: "已停止" }); queryClient.invalidateQueries({ queryKey: getGetOllamaStatusQueryKey() }); },
  });

  const isRunning = status?.running && status?.apiReachable;
  const localUrl = config?.localUrl || "http://localhost:11434";
  const lanUrl = config?.lanUrl || "";
  const activeModel = selectedModel || models?.[0]?.name || "llama3";

  const allDetectedModels = [
    ...(models || []).map((m) => ({ name: m.name, source: "Ollama (容器)" })),
    ...detectedServices.flatMap((s) => s.models.map((m) => ({ name: m, source: s.name }))),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white mb-2">Ollama 管理</h2>
        <p className="text-muted-foreground">管理本地大语言模型及客户端连接配置。</p>
      </div>

      {/* ── Status Bar ─────────────────────────────────────────────────────── */}
      <Card className="bg-card border-card-border">
        <CardContent className="pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div className={cn("w-3 h-3 rounded-full flex-shrink-0 animate-pulse",
                isRunning ? "bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)] animate-none"
                  : status?.running ? "bg-yellow-400" : "bg-red-500")} />
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-white">
                    {isRunning ? "Ollama 运行中" : status?.running ? "Ollama 启动中..." : "Ollama 已停止"}
                  </span>
                  {isRunning ? <Badge className="bg-green-500/20 text-green-400 border-green-500/40 text-xs">API 可达</Badge>
                    : status?.running ? <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/40 text-xs">等待就绪</Badge>
                    : <Badge className="bg-red-500/20 text-red-400 border-red-500/40 text-xs">离线</Badge>}
                </div>
                <div className="text-sm text-muted-foreground mt-0.5 flex gap-4 flex-wrap">
                  {status?.port && <span>端口: <span className="font-mono">{status.port}</span></span>}
                  {status?.uptime && <span>运行: {status.uptime}</span>}
                  {isRunning && <span>模型: {models?.length ?? 0} 个</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleRestart} disabled={restartOllama.isPending || !status?.containerId} className="border-orange-500/40 text-orange-400 hover:bg-orange-500/10">
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> 重启服务
              </Button>
              <Button variant="outline" size="sm" onClick={handleStop} disabled={stopOllama.isPending || !status?.running} className="border-red-500/40 text-red-400 hover:bg-red-500/10">
                <Square className="w-3.5 h-3.5 mr-1.5" /> 停止容器
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLogsOpen(true)} className="border-border text-muted-foreground hover:text-white">
                <ScrollText className="w-3.5 h-3.5 mr-1.5" /> 查看日志
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { refetchStatus(); refetchModels(); }}>
                <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 一键启动工具专区 ─────────────────────────────────────────────────── */}
      <Card className="bg-card border-card-border border-t-2 border-t-cyan-500/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-white">
            <Rocket className="w-5 h-5 text-cyan-400" /> 一键启动工具
          </CardTitle>
          <CardDescription className="text-xs">
            自动检测 Ollama 状态与模型，生成 Codex / Claude Code 本地模型启动命令
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Codex */}
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-cyan-400" />
                <span className="font-semibold text-white">Codex CLI</span>
                <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/30 text-xs">OpenAI</Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                使用 Ollama 本地模型驱动 Codex CLI，完全离线，无需 OpenAI API Key。支持 MCP 插件扩展文件系统、Git 等能力。
              </p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-cyan-400" />完全本地运行</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-cyan-400" />MCP 插件支持</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-cyan-400" />无需联网</span>
              </div>
              <Button className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-medium"
                onClick={() => setLaunchTool("codex")}>
                <Play className="w-4 h-4 mr-2" /> 一键启动 Codex
              </Button>
            </div>

            {/* Claude Code */}
            <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-purple-400" />
                <span className="font-semibold text-white">Claude Code</span>
                <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/30 text-xs">Anthropic</Badge>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                配置 ANTHROPIC_BASE_URL 将 Claude Code 指向本地 Ollama，免费使用本地模型替代 Claude 云端 API。
              </p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" />替代云端 API</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" />Win/Mac/Linux</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-purple-400" />零成本</span>
              </div>
              <Button className="w-full bg-purple-700 hover:bg-purple-600 text-white font-medium"
                onClick={() => setLaunchTool("claude")}>
                <Play className="w-4 h-4 mr-2" /> 一键启动 Claude Code
              </Button>
            </div>
          </div>

          {!isRunning && (
            <div className="mt-3 flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" /> Ollama 未运行，启动前请先部署 Ollama 并拉取至少一个模型
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Local AI Service Detection ───────────────────────────────────────── */}
      <Card className="bg-card border-card-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2 text-cyan-400">
              <Search className="w-4 h-4" /> 本地 AI 服务检测
            </CardTitle>
            <Button variant="outline" size="sm" onClick={detectLocalServices} disabled={detecting}
              className="border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/10">
              {detecting ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />检测中...</> : <><Search className="w-3.5 h-3.5 mr-1.5" />检测本地服务</>}
            </Button>
          </div>
          <CardDescription className="text-xs">自动检测本机运行的 Ollama、LM Studio、Jan 等 AI 服务及已加载的模型</CardDescription>
        </CardHeader>
        <CardContent>
          {!detectedOnce ? (
            <div className="text-center py-4 text-muted-foreground text-sm flex flex-col items-center gap-2">
              <Cpu className="w-8 h-8 text-muted-foreground/40" />
              <span>点击「检测本地服务」扫描 Ollama (11434)、LM Studio (1234)、Jan (1337) 等常用端口</span>
            </div>
          ) : detectedServices.length === 0 ? (
            <p className="text-center py-4 text-muted-foreground text-sm">未检测到本地 AI 服务。确保 Ollama 或 LM Studio 已启动并开放 API。</p>
          ) : (
            <div className="space-y-3">
              {detectedServices.map((svc) => (
                <div key={`${svc.type}-${svc.port}`} className="border border-border rounded-lg p-4 bg-background/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-cyan-400" />
                      <span className="font-medium text-white text-sm">{svc.name}</span>
                      <ServiceBadge type={svc.type} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">:{svc.port}</span>
                      <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-xs">运行中</Badge>
                    </div>
                  </div>
                  {svc.models.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {svc.models.map((m) => (
                        <button key={m} onClick={() => setPullModelName(m)}
                          className="text-xs font-mono px-2.5 py-1 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-colors">
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 items-center">
                    <Button size="sm" variant="outline" className="h-7 text-xs border-border text-muted-foreground"
                      onClick={() => handleTestConnection(svc.baseUrl, `svc-${svc.port}`)}>
                      {testResults[`svc-${svc.port}`]?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Wifi className="w-3.5 h-3.5 mr-1" />测试连接</>}
                    </Button>
                    {testResults[`svc-${svc.port}`] && !testResults[`svc-${svc.port}`]?.loading && (
                      <span className={cn("text-xs flex items-center gap-1",
                        testResults[`svc-${svc.port}`]?.success ? "text-green-400" : "text-red-400")}>
                        {testResults[`svc-${svc.port}`]?.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        {testResults[`svc-${svc.port}`]?.message}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Pull + Connection Test ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-card-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-cyan-400">
              <Download className="w-5 h-5" /> 拉取模型
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isRunning && (
              <div className="flex items-center gap-2 text-sm text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2">
                <Activity className="w-4 h-4 flex-shrink-0" /> Ollama 未运行，请先部署或启动 Ollama
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-2">快速选择常用模型：</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_MODELS.map((m) => (
                  <button key={m} onClick={() => setPullModelName(m)} disabled={pulling}
                    className={cn("text-xs font-mono px-2.5 py-1 rounded border transition-colors",
                      pullModelName === m ? "bg-cyan-500/20 border-cyan-500/60 text-cyan-300"
                        : "bg-background border-border text-muted-foreground hover:border-cyan-500/40 hover:text-cyan-400")}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Input placeholder="例如: llama3:8b, mistral:latest" value={pullModelName}
                onChange={(e) => setPullModelName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !pulling) handlePullModel(); }}
                disabled={pulling} className="font-mono bg-background" />
              {pulling ? (
                <Button onClick={handleStopPull} variant="outline" className="border-red-500/40 text-red-400 hover:bg-red-500/10 flex-shrink-0">
                  <StopCircle className="w-4 h-4 mr-1.5" /> 停止
                </Button>
              ) : (
                <Button onClick={() => handlePullModel()} disabled={!pullModelName.trim() || !isRunning}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white flex-shrink-0">
                  <Download className="w-4 h-4 mr-1.5" /> 拉取
                </Button>
              )}
            </div>
            {(pulling || pullDone || pullError) && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className={cn("truncate max-w-[75%]",
                    pullError ? "text-red-400" : pullDone ? "text-green-400" : "text-muted-foreground")}>
                    {pulling && pullingModelName && <Badge className="mr-1.5 bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">拉取中</Badge>}
                    {pullError && <XCircle className="w-3.5 h-3.5 inline mr-1" />}
                    {pullDone && <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />}
                    {pullStatusText}
                  </span>
                  <span className="font-mono text-muted-foreground">{pullProgress}%</span>
                </div>
                <Progress value={pullProgress} className={cn("h-2",
                  pullError ? "[&>div]:bg-red-500" : pullDone ? "[&>div]:bg-green-500" : "[&>div]:bg-cyan-500")} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-cyan-400">
              <Terminal className="w-5 h-5" /> 连接测试
            </CardTitle>
          </CardHeader>
          <CardContent>
            {config ? (
              <div className="space-y-3">
                {[
                  { label: "本地连接 (localhost)", url: config.localUrl, key: "local" },
                  { label: "局域网连接 (LAN)", url: config.lanUrl, key: "lan" },
                ].map(({ label, url, key }) => {
                  const result = testResults[key];
                  return (
                    <div key={key} className="p-3 rounded bg-background/50 border border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs text-muted-foreground block">{label}</span>
                          <span className="font-mono text-sm">{url}</span>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => handleTestConnection(url, key)} disabled={result?.loading} className="flex-shrink-0">
                          {result?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Wifi className="w-3.5 h-3.5 mr-1" />测试</>}
                        </Button>
                      </div>
                      {result && !result.loading && (
                        <div className={cn("text-xs flex items-start gap-1.5 rounded px-2 py-2 border",
                          result.success ? "bg-green-500/10 border-green-500/20 text-green-400"
                            : "bg-red-500/10 border-red-500/20 text-red-400")}>
                          {result.success ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
                          <div>
                            <span>{result.message}</span>
                            {result.success && result.models && result.models.length > 0 && (
                              <span className="text-green-300 ml-2">{result.models.length} 个模型</span>
                            )}
                            {!result.success && (
                              <p className="text-muted-foreground mt-0.5 text-xs">检查：容器运行状态 → 端口 11434:11434 映射 → OLLAMA_ORIGINS=* 环境变量</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-muted-foreground text-sm">正在加载配置...</p>}
          </CardContent>
        </Card>
      </div>

      {/* ── Installed Models ─────────────────────────────────────────────────── */}
      <Card className="bg-card border-card-border">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Zap className="w-5 h-5 text-cyan-400" /> 已安装模型
            {pulling && pullingModelName && (
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs animate-pulse">
                <Loader2 className="w-3 h-3 mr-1 animate-spin inline" />拉取中: {pullingModelName}
              </Badge>
            )}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetchModels()} className="text-muted-foreground hover:text-white">
            <RefreshCw className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent>
          {!isRunning ? (
            <div className="text-center py-6 text-muted-foreground text-sm space-y-1">
              <WifiOff className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>Ollama 未运行，无法获取模型列表</p>
              <p className="text-xs">请先在上方部署 Ollama 或点击「重启服务」</p>
            </div>
          ) : (
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>名称</TableHead>
                    <TableHead>大小</TableHead>
                    <TableHead>参数量</TableHead>
                    <TableHead>量化级别</TableHead>
                    <TableHead>更新时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isModelsLoading ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin inline mr-2" />加载中...
                    </TableCell></TableRow>
                  ) : !models || models.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8">
                      <div className="space-y-1">
                        <p className="text-muted-foreground">没有安装任何模型</p>
                        <p className="text-xs text-muted-foreground">在上方「拉取模型」区域输入模型名称进行下载</p>
                        {pulling && <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs mt-2">
                          <Loader2 className="w-3 h-3 mr-1 animate-spin inline" />正在拉取 {pullingModelName}...
                        </Badge>}
                      </div>
                    </TableCell></TableRow>
                  ) : (
                    models.map((model) => (
                      <TableRow key={model.name} className="border-border hover:bg-muted/50">
                        <TableCell className="font-mono font-medium text-cyan-400">
                          {model.name}
                          <Badge className="ml-2 bg-green-500/15 text-green-400 border-green-500/30 text-xs">就绪</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{formatBytes(model.size)}</TableCell>
                        <TableCell className="font-mono text-xs">{model.parameterSize || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <Badge variant="outline" className="bg-background">{model.quantizationLevel || "—"}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatRelative(model.modifiedAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-cyan-400 hover:bg-cyan-400/10 h-8 px-2 text-xs"
                              onClick={() => setPathModelName(model.name)}>
                              <FolderOpen className="w-3.5 h-3.5 mr-1" />路径
                            </Button>
                            <Button variant="ghost" size="icon" className="text-red-400 hover:text-red-300 hover:bg-red-400/10 h-8 w-8"
                              onClick={() => setDeleteTarget(model.name)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Quick Connect ────────────────────────────────────────────────────── */}
      <Card className="bg-card border-card-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Plug2 className="w-5 h-5 text-cyan-400" /> 客户端连接配置
          </CardTitle>
          <CardDescription>选择模型，生成各工具的连接配置，一键复制使用。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isRunning && (
            <div className="flex items-center gap-2 text-sm text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2">
              <Activity className="w-4 h-4 flex-shrink-0" /> Ollama 未运行，配置已置灰。请先部署并拉取模型。
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">使用模型：</Label>
            {allDetectedModels.length > 0 ? (
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="bg-background font-mono text-sm h-9 w-72">
                  <SelectValue placeholder="选择模型..." />
                </SelectTrigger>
                <SelectContent className="bg-[#0d1117] border-[#30363d]">
                  {allDetectedModels.map((m) => (
                    <SelectItem key={`${m.name}-${m.source}`} value={m.name} className="font-mono text-sm">
                      {m.name} <span className="text-muted-foreground ml-1 text-xs">({m.source})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}
                placeholder="手动输入模型名 (如 llama3:8b)" className="font-mono text-sm h-9 w-64 bg-background" />
            )}
          </div>

          <TabBar tabs={CLIENT_TABS} active={clientTab} onChange={setClientTab} />

          {/* Codex Desktop */}
          {clientTab === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">在 Codex Desktop 设置中选择 <span className="text-cyan-300 font-mono">Custom / Ollama</span> 并填入以下配置：</p>
              <ConnectBlock label="本地配置 (localhost)" disabled={!isRunning}
                text={JSON.stringify({ baseURL: `${localUrl}/v1`, apiKey: "ollama", model: activeModel }, null, 2)}
                copyKey="codex-local" copiedKey={copiedKey} onCopy={copyToClipboard}
                onTest={() => handleTestConnection(localUrl, "codex-test")} testResult={testResults["codex-test"]} />
              {lanUrl && <ConnectBlock label="局域网配置 (LAN)" disabled={!isRunning}
                text={JSON.stringify({ baseURL: `${lanUrl}/v1`, apiKey: "ollama", model: activeModel }, null, 2)}
                copyKey="codex-lan" copiedKey={copiedKey} onCopy={copyToClipboard}
                onTest={() => handleTestConnection(lanUrl, "codex-lan-test")} testResult={testResults["codex-lan-test"]} />}
            </div>
          )}

          {/* Codex CLI */}
          {clientTab === 1 && (
            <div className="space-y-3">
              <ConnectBlock label="~/.codex/config.yaml（推荐方式）" disabled={!isRunning}
                text={`model: "${activeModel}"\nprovider: ollama\nbaseURL: "${localUrl}/v1"\napiKey: "ollama"\napprovalMode: suggest`}
                copyKey="codex-cli-yaml" copiedKey={copiedKey} onCopy={copyToClipboard}
                onTest={() => handleTestConnection(localUrl, "codex-cli-test")} testResult={testResults["codex-cli-test"]} />
              <div className="text-xs text-muted-foreground bg-background/40 border border-border/50 rounded p-3">
                <p className="text-white/70 font-medium mb-1">或直接环境变量方式：</p>
                <code className="text-cyan-300 block">{`OPENAI_BASE_URL=${localUrl}/v1 OPENAI_API_KEY=ollama npx @openai/codex "问题"`}</code>
              </div>
              <Button size="sm" className="bg-cyan-600 hover:bg-cyan-500 text-white" onClick={() => setLaunchTool("codex")}>
                <Rocket className="w-3.5 h-3.5 mr-1.5" /> 一键启动检测
              </Button>
            </div>
          )}

          {/* Claude Code */}
          {clientTab === 2 && (
            <div className="space-y-3">
              <TabBar tabs={CLAUDE_TABS} active={claudeTab} onChange={setClaudeTab} />
              {claudeTab === 0 && (
                <ConnectBlock label="macOS / Linux — 本地" disabled={!isRunning}
                  text={`export ANTHROPIC_BASE_URL="${localUrl}/v1"\nexport ANTHROPIC_API_KEY="ollama"\nexport ANTHROPIC_MODEL="${activeModel}"\nclaude`}
                  copyKey="claude-mac" copiedKey={copiedKey} onCopy={copyToClipboard}
                  onTest={() => handleTestConnection(localUrl, "claude-test")} testResult={testResults["claude-test"]} />
              )}
              {claudeTab === 1 && (
                <ConnectBlock label="Windows PowerShell — 本地" disabled={!isRunning}
                  text={`$env:ANTHROPIC_BASE_URL="${localUrl}/v1"\n$env:ANTHROPIC_API_KEY="ollama"\n$env:ANTHROPIC_MODEL="${activeModel}"\nclaude`}
                  copyKey="claude-win" copiedKey={copiedKey} onCopy={copyToClipboard}
                  onTest={() => handleTestConnection(localUrl, "claude-test")} testResult={testResults["claude-test"]} />
              )}
              <Button size="sm" className="bg-purple-700 hover:bg-purple-600 text-white" onClick={() => setLaunchTool("claude")}>
                <Rocket className="w-3.5 h-3.5 mr-1.5" /> 一键启动检测
              </Button>
            </div>
          )}

          {/* Continue.dev */}
          {clientTab === 3 && (
            <ConnectBlock label="Continue.dev 配置 (~/.continue/config.json)" disabled={!isRunning}
              text={genContinueConfig(localUrl, activeModel)}
              copyKey="continue-local" copiedKey={copiedKey} onCopy={copyToClipboard}
              onTest={() => handleTestConnection(localUrl, "continue-test")} testResult={testResults["continue-test"]} />
          )}

          {/* Open WebUI */}
          {clientTab === 4 && (
            <div className="space-y-3">
              <ConnectBlock label="Open WebUI 环境变量" disabled={!isRunning}
                text={`OLLAMA_BASE_URL=${localUrl}`}
                copyKey="webui-local" copiedKey={copiedKey} onCopy={copyToClipboard}
                onTest={() => handleTestConnection(localUrl, "webui-test")} testResult={testResults["webui-test"]} />
              <div className="text-xs text-muted-foreground bg-background/40 border border-border/50 rounded p-3">
                <p className="text-white/70 font-medium mb-1">一键启动 Open WebUI（Docker）：</p>
                <code className="text-cyan-300 break-all block leading-relaxed text-xs">
                  {`docker run -d -p 3000:8080 --add-host=host.docker.internal:host-gateway -e OLLAMA_BASE_URL=http://host.docker.internal:11434 --name open-webui --restart unless-stopped ghcr.io/open-webui/open-webui:main`}
                </code>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Modals ────────────────────────────────────────────────────────────── */}
      {launchTool && (
        <LaunchModal open={!!launchTool} onClose={() => setLaunchTool(null)} tool={launchTool} selectedModel={selectedModel} />
      )}

      <ModelPathModal modelName={pathModelName || ""} open={!!pathModelName} onClose={() => setPathModelName(null)} />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="bg-[#0d1117] border border-[#30363d] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" /> 确认删除模型
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-1">
              即将删除 <span className="font-mono text-red-400">{deleteTarget}</span>。不可撤销，但可重新拉取。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="border-border" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button className="bg-red-600 hover:bg-red-500 text-white" onClick={confirmDeleteModel}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="bg-[#0d1117] border border-[#30363d] max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-cyan-400 flex items-center gap-2">
              <ScrollText className="w-5 h-5" /> Ollama 容器日志
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            <pre ref={logsScrollRef} className="text-xs font-mono text-gray-300 leading-relaxed bg-background/50 border border-border rounded p-4 h-[50vh] overflow-y-auto whitespace-pre-wrap">
              {logsData?.logs || "暂无日志"}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => refetchLogs()} className="border-border">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> 刷新
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLogsOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
