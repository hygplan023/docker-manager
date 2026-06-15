import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Server, Activity, HardDrive, Cpu, Box, Play, Square, RefreshCw,
  CheckCircle2, XCircle, Loader2, Settings2, ChevronRight,
} from "lucide-react";
import {
  useGetDockerInfo, useGetOllamaStatus, useListContainers,
  useStartOllama, useStopOllama, useRestartOllama, getGetOllamaStatusQueryKey,
} from "@workspace/api-client-react";
import { formatBytes, formatRelative } from "@/lib/format";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface DeployEvent { stage: string; message: string; success?: boolean; percent?: number; }

const DEFAULT_CONFIG = {
  image: "ollama/ollama:latest",
  containerName: "ollama",
  port: "11434",
  volumeName: "ollama_data",
};

export default function Overview() {
  const { data: dockerInfo, isLoading: isDockerLoading } = useGetDockerInfo();
  const { data: ollamaStatus, isLoading: isOllamaLoading } = useGetOllamaStatus({ refetchInterval: 5000 });
  const { data: containers, isLoading: isContainersLoading } = useListContainers({ all: true });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const startOllama = useStartOllama();
  const stopOllama = useStopOllama();
  const restartOllama = useRestartOllama();

  // Deploy modal state
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployPhase, setDeployPhase] = useState<"config" | "progress">("config");
  const [deployConfig, setDeployConfig] = useState({ ...DEFAULT_CONFIG });
  const [deployLogs, setDeployLogs] = useState<DeployEvent[]>([]);
  const [deployDone, setDeployDone] = useState(false);
  const [deploySuccess, setDeploySuccess] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [pollingStatus, setPollingStatus] = useState("");
  const logsEndRef = useRef<HTMLDivElement>(null);

  const openDeployModal = () => {
    setDeployModalOpen(true);
    setDeployPhase("config");
    setDeployConfig({ ...DEFAULT_CONFIG });
    setDeployLogs([]);
    setDeployDone(false);
    setDeploySuccess(false);
    setPollingStatus("");
  };

  const startDeploy = async () => {
    setDeployPhase("progress");
    setDeployLogs([]);
    setDeployDone(false);
    setDeploySuccess(false);
    setDeploying(true);
    setPollingStatus("");

    try {
      const response = await fetch("/api/ollama/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          port: parseInt(deployConfig.port) || 11434,
          image: deployConfig.image,
          containerName: deployConfig.containerName,
          volumeName: deployConfig.volumeName,
        }),
      });

      if (!response.body) throw new Error("无响应流");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        for (const line of chunk.split("\n").filter(Boolean)) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6)) as DeployEvent;
              setDeployLogs((prev) => [...prev, data]);
              setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
              if (data.stage === "done" || data.stage === "error") {
                setDeployDone(true);
                setDeploySuccess(!!data.success);
                setDeploying(false);
                queryClient.invalidateQueries({ queryKey: getGetOllamaStatusQueryKey() });
                if (data.success) pollUntilReady(deployConfig.port);
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDeployLogs((prev) => [...prev, { stage: "error", message: `连接错误: ${msg}`, success: false }]);
      setDeployDone(true);
      setDeploySuccess(false);
      setDeploying(false);
    }
  };

  const pollUntilReady = async (port: string) => {
    setPollingStatus("正在等待 Ollama API 就绪...");
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const resp = await fetch("/api/ollama/status");
        const data = (await resp.json()) as { apiReachable?: boolean };
        if (data.apiReachable) {
          setPollingStatus("✅ API 已就绪！正在跳转...");
          queryClient.invalidateQueries({ queryKey: getGetOllamaStatusQueryKey() });
          await new Promise((r) => setTimeout(r, 1000));
          setDeployModalOpen(false);
          navigate("/ollama");
          return;
        }
        setPollingStatus(`正在等待 Ollama API 就绪... (${i + 1}/30)`);
      } catch {}
    }
    setPollingStatus("等待超时，请手动检查 Ollama 状态");
  };

  const handleOllamaAction = (action: "start" | "stop" | "restart") => {
    const onSuccess = () => {
      queryClient.invalidateQueries({ queryKey: getGetOllamaStatusQueryKey() });
      toast({ title: "操作成功" });
    };
    if (action === "start") startOllama.mutate(undefined, { onSuccess });
    else if (action === "stop") stopOllama.mutate(undefined, { onSuccess });
    else if (action === "restart") restartOllama.mutate(undefined, { onSuccess });
  };

  const stageIcon = (stage: string, isLast: boolean) => {
    if (stage === "error") return <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />;
    if (stage === "done") return <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />;
    if (isLast) return <Loader2 className="w-4 h-4 text-cyan-400 animate-spin flex-shrink-0" />;
    return <CheckCircle2 className="w-4 h-4 text-green-500/50 flex-shrink-0" />;
  };

  const recentContainers = containers?.slice(0, 5) || [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white mb-2">系统概览</h2>
        <p className="text-muted-foreground">监控 Docker 引擎状态和资源使用情况。</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card border-card-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg text-cyan-400">
              <Server className="w-5 h-5" /> Docker 引擎状态
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isDockerLoading ? (
              <div className="space-y-2">
                <div className="h-4 bg-muted rounded w-1/2 animate-pulse" />
                <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
              </div>
            ) : dockerInfo ? (
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <span className="text-muted-foreground">版本</span>
                  <p className="font-mono">{dockerInfo.serverVersion}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">操作系统</span>
                  <p className="font-mono">{dockerInfo.osType} ({dockerInfo.architecture})</p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">容器总数</span>
                  <p className="font-mono text-xl">
                    <span className="text-green-400">{dockerInfo.containersRunning}</span>
                    <span className="text-muted-foreground"> / {dockerInfo.containers}</span>
                  </p>
                </div>
                <div className="space-y-1">
                  <span className="text-muted-foreground">镜像总数</span>
                  <p className="font-mono text-xl">{dockerInfo.images}</p>
                </div>
                <div className="space-y-1 col-span-2">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Cpu className="w-4 h-4" /> 内存
                  </span>
                  <p className="font-mono">{formatBytes(dockerInfo.memTotal)}</p>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="flex items-center gap-2 text-lg text-cyan-400">
              <Activity className="w-5 h-5" /> Ollama 运行状态
            </CardTitle>
            {ollamaStatus?.running ? (
              ollamaStatus.apiReachable ? (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/50">运行中 / API 可达</Badge>
              ) : (
                <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/50">启动中</Badge>
              )
            ) : (
              <Badge variant="destructive" className="bg-red-500/20 text-red-400 border-red-500/50">已停止</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {isOllamaLoading ? (
              <div className="h-20 bg-muted rounded animate-pulse" />
            ) : ollamaStatus ? (
              <>
                <div className="grid grid-cols-2 gap-4 text-sm mt-4">
                  <div className="space-y-1">
                    <span className="text-muted-foreground">API 状态</span>
                    <p className={cn("font-mono", ollamaStatus.apiReachable ? "text-green-400" : "text-red-400")}>
                      {ollamaStatus.apiReachable ? "✓ 可访问" : "✗ 不可达"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground">容器名称</span>
                    <p className="font-mono">{ollamaStatus.containerName || "N/A"}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground">端口</span>
                    <p className="font-mono">{ollamaStatus.port || "N/A"}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground">运行时长</span>
                    <p className="font-mono">{ollamaStatus.uptime || "N/A"}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {!ollamaStatus.containerId ? (
                    <Button onClick={openDeployModal} size="sm" className="bg-cyan-600 hover:bg-cyan-500 text-white">
                      <HardDrive className="w-4 h-4 mr-2" /> 一键部署
                    </Button>
                  ) : !ollamaStatus.running ? (
                    <Button onClick={() => handleOllamaAction("start")} disabled={startOllama.isPending} variant="outline" size="sm" className="border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/10">
                      <Play className="w-4 h-4 mr-2" /> 启动
                    </Button>
                  ) : (
                    <>
                      <Button onClick={() => handleOllamaAction("stop")} disabled={stopOllama.isPending} variant="outline" size="sm" className="border-red-500/50 text-red-400 hover:bg-red-500/10">
                        <Square className="w-4 h-4 mr-2" /> 停止
                      </Button>
                      <Button onClick={() => handleOllamaAction("restart")} disabled={restartOllama.isPending} variant="outline" size="sm" className="border-orange-500/50 text-orange-400 hover:bg-orange-500/10">
                        <RefreshCw className="w-4 h-4 mr-2" /> 重启
                      </Button>
                    </>
                  )}
                  <Link href="/ollama">
                    <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-white">
                      进入管理
                    </Button>
                  </Link>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-card-border">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Box className="w-5 h-5 text-cyan-400" /> 最近容器
          </CardTitle>
          <Link href="/containers">
            <Button variant="link" className="text-cyan-400 hover:text-cyan-300 px-0">查看全部 &rarr;</Button>
          </Link>
        </CardHeader>
        <CardContent>
          {isContainersLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-muted rounded animate-pulse" />)}
            </div>
          ) : recentContainers.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">没有找到容器</div>
          ) : (
            <div className="space-y-4">
              {recentContainers.map((container) => (
                <div key={container.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50">
                  <div className="flex items-center gap-4">
                    <div className={cn("w-2 h-2 rounded-full", container.state === "running" ? "bg-green-500" : "bg-red-500")} />
                    <div>
                      <div className="font-mono font-medium text-sm text-white">{container.names[0]?.replace(/^\//, "")}</div>
                      <div className="text-xs text-muted-foreground mt-1 truncate max-w-[200px] md:max-w-md" title={container.image}>{container.image}</div>
                    </div>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1">
                    <Badge variant="outline" className="font-mono text-xs">{container.state}</Badge>
                    <span className="text-xs text-muted-foreground">{formatRelative(container.created)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deploy Modal */}
      <Dialog open={deployModalOpen} onOpenChange={(open) => { if (!deploying) setDeployModalOpen(open); }}>
        <DialogContent className="bg-[#0d1117] border border-[#30363d] max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-cyan-400 flex items-center gap-2">
              <HardDrive className="w-5 h-5" />
              Ollama 一键部署
              {deployPhase === "progress" && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
              {deployPhase === "progress" && <span className="text-sm font-normal text-muted-foreground">部署进度</span>}
            </DialogTitle>
          </DialogHeader>

          {deployPhase === "config" && (
            <div className="space-y-4 mt-1">
              <p className="text-sm text-muted-foreground">配置部署参数后点击「开始部署」，所有字段均可自定义。</p>
              <Separator className="bg-border/50" />

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">镜像地址</Label>
                  <Input
                    value={deployConfig.image}
                    onChange={(e) => setDeployConfig((p) => ({ ...p, image: e.target.value }))}
                    placeholder="ollama/ollama:latest"
                    className="font-mono text-sm bg-background h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">容器名称</Label>
                  <Input
                    value={deployConfig.containerName}
                    onChange={(e) => setDeployConfig((p) => ({ ...p, containerName: e.target.value }))}
                    placeholder="ollama"
                    className="font-mono text-sm bg-background h-8"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">主机端口</Label>
                  <Input
                    type="number"
                    value={deployConfig.port}
                    onChange={(e) => setDeployConfig((p) => ({ ...p, port: e.target.value }))}
                    placeholder="11434"
                    className="font-mono text-sm bg-background h-8"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">数据卷名称（持久化模型数据，留空则不挂载）</Label>
                  <Input
                    value={deployConfig.volumeName}
                    onChange={(e) => setDeployConfig((p) => ({ ...p, volumeName: e.target.value }))}
                    placeholder="ollama_data"
                    className="font-mono text-sm bg-background h-8"
                  />
                </div>
              </div>

              <div className="bg-background/40 border border-border/50 rounded p-3 text-xs text-muted-foreground space-y-1">
                <p className="text-white/70 font-medium mb-1">将执行的等效命令：</p>
                <code className="text-cyan-300 block leading-relaxed break-all">
                  docker run -d --name {deployConfig.containerName || "ollama"}{" "}
                  -p {deployConfig.port || "11434"}:11434{" "}
                  {deployConfig.volumeName ? `-v ${deployConfig.volumeName}:/root/.ollama ` : ""}
                  -e OLLAMA_ORIGINS=* --restart unless-stopped {deployConfig.image || "ollama/ollama:latest"}
                </code>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDeployModalOpen(false)}>取消</Button>
                <Button
                  size="sm"
                  className="bg-cyan-600 hover:bg-cyan-500 text-white"
                  onClick={startDeploy}
                  disabled={!deployConfig.image.trim()}
                >
                  <Settings2 className="w-4 h-4 mr-1.5" /> 开始部署
                </Button>
              </div>
            </div>
          )}

          {deployPhase === "progress" && (
            <div className="space-y-3 mt-2">
              <div className="bg-background/50 rounded-lg border border-border p-3 max-h-56 overflow-y-auto space-y-2">
                {deployLogs.length === 0 ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> <span>正在初始化...</span>
                  </div>
                ) : (
                  deployLogs.map((log, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm">
                      {stageIcon(log.stage, idx === deployLogs.length - 1 && deploying)}
                      <span className={cn(
                        "leading-tight",
                        log.stage === "error" ? "text-red-400" : log.stage === "done" && log.success ? "text-green-400" : "text-gray-300"
                      )}>{log.message}</span>
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>

              {deploying && <Progress value={undefined} className="h-1 animate-pulse" />}

              {pollingStatus && (
                <div className="flex items-center gap-2 text-sm text-cyan-300 bg-cyan-500/10 rounded px-3 py-2 border border-cyan-500/20">
                  {pollingStatus.startsWith("✅") ? (
                    <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                  ) : (
                    <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                  )}
                  <span>{pollingStatus}</span>
                </div>
              )}

              {deployDone && !pollingStatus && (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDeployModalOpen(false)} className="border-border text-muted-foreground">关闭</Button>
                  {deploySuccess && (
                    <Button size="sm" className="bg-cyan-600 hover:bg-cyan-500" onClick={() => { setDeployModalOpen(false); navigate("/ollama"); }}>
                      进入 Ollama 管理
                    </Button>
                  )}
                  {!deploySuccess && (
                    <Button size="sm" variant="outline" onClick={() => { setDeployPhase("config"); setDeployDone(false); }} className="border-cyan-500/50 text-cyan-400">
                      修改配置重试
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
