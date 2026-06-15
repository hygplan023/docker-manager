import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Box, Play, Square, RefreshCw, Trash2, Terminal, Filter, Plus, X, PlusCircle, Loader2 } from "lucide-react";
import {
  useListContainers, useStartContainer, useStopContainer,
  useRestartContainer, useDeleteContainer, useFetchContainerLogs,
  getListContainersQueryKey,
} from "@workspace/api-client-react";
import { formatRelative } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

function LogsModal({ containerId, isOpen, onClose, containerName }: {
  containerId: string | null; isOpen: boolean; onClose: () => void; containerName: string;
}) {
  const { data: logsData, isLoading } = useFetchContainerLogs(containerId || "");
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col bg-[#0d1117] border-gray-800 text-gray-300">
        <DialogHeader>
          <DialogTitle className="text-gray-100 font-mono flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-400" /> {containerName} 日志
          </DialogTitle>
          <DialogDescription className="text-gray-400">显示最后 100 行日志输出。</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 relative rounded-md border border-gray-800 bg-black">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center text-gray-500">加载中...</div>
          ) : (
            <ScrollArea className="h-[500px] w-full p-4 font-mono text-xs whitespace-pre">
              {logsData?.logs || "无日志输出"}
            </ScrollArea>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface PortBinding { hostPort: string; containerPort: string; protocol: string; }
interface EnvVar { key: string; value: string; }
interface VolumeMount { source: string; target: string; }

const QUICK_TEMPLATES = [
  {
    label: "Nginx",
    image: "nginx:latest",
    name: "nginx",
    ports: [{ hostPort: "80", containerPort: "80", protocol: "tcp" }],
    env: [],
    volumes: [],
    restart: "unless-stopped",
  },
  {
    label: "Redis",
    image: "redis:alpine",
    name: "redis",
    ports: [{ hostPort: "6379", containerPort: "6379", protocol: "tcp" }],
    env: [],
    volumes: [{ source: "redis_data", target: "/data" }],
    restart: "unless-stopped",
  },
  {
    label: "MySQL",
    image: "mysql:8.0",
    name: "mysql",
    ports: [{ hostPort: "3306", containerPort: "3306", protocol: "tcp" }],
    env: [{ key: "MYSQL_ROOT_PASSWORD", value: "rootpass" }, { key: "MYSQL_DATABASE", value: "mydb" }],
    volumes: [{ source: "mysql_data", target: "/var/lib/mysql" }],
    restart: "unless-stopped",
  },
  {
    label: "PostgreSQL",
    image: "postgres:16-alpine",
    name: "postgres",
    ports: [{ hostPort: "5432", containerPort: "5432", protocol: "tcp" }],
    env: [{ key: "POSTGRES_PASSWORD", value: "postgres" }, { key: "POSTGRES_DB", value: "mydb" }],
    volumes: [{ source: "pg_data", target: "/var/lib/postgresql/data" }],
    restart: "unless-stopped",
  },
];

export default function Containers() {
  const [showAll, setShowAll] = useState(true);
  const [search, setSearch] = useState("");
  const { data: containers, isLoading } = useListContainers({ all: showAll });

  const startContainer = useStartContainer();
  const stopContainer = useStopContainer();
  const restartContainer = useRestartContainer();
  const deleteContainer = useDeleteContainer();

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [logsContainerId, setLogsContainerId] = useState<string | null>(null);
  const [logsContainerName, setLogsContainerName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // Create container dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createImage, setCreateImage] = useState("");
  const [createName, setCreateName] = useState("");
  const [createRestart, setCreateRestart] = useState("no");
  const [createAutoStart, setCreateAutoStart] = useState(true);
  const [portBindings, setPortBindings] = useState<PortBinding[]>([{ hostPort: "", containerPort: "", protocol: "tcp" }]);
  const [envVars, setEnvVars] = useState<EnvVar[]>([{ key: "", value: "" }]);
  const [volumes, setVolumes] = useState<VolumeMount[]>([{ source: "", target: "" }]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListContainersQueryKey({ all: showAll }) });

  const openCreateModal = () => {
    setCreateImage(""); setCreateName(""); setCreateRestart("no"); setCreateAutoStart(true);
    setPortBindings([{ hostPort: "", containerPort: "", protocol: "tcp" }]);
    setEnvVars([{ key: "", value: "" }]);
    setVolumes([{ source: "", target: "" }]);
    setCreateOpen(true);
  };

  const applyTemplate = (tpl: typeof QUICK_TEMPLATES[0]) => {
    setCreateImage(tpl.image);
    setCreateName(tpl.name);
    setCreateRestart(tpl.restart);
    setPortBindings(tpl.ports.length ? tpl.ports : [{ hostPort: "", containerPort: "", protocol: "tcp" }]);
    setEnvVars(tpl.env.length ? tpl.env : [{ key: "", value: "" }]);
    setVolumes(tpl.volumes.length ? tpl.volumes : [{ source: "", target: "" }]);
  };

  const handleCreateContainer = async () => {
    if (!createImage.trim()) {
      toast({ variant: "destructive", title: "错误", description: "请填写镜像地址" });
      return;
    }
    setCreating(true);
    try {
      const resp = await fetch("/api/containers/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: createImage.trim(),
          name: createName.trim() || undefined,
          portBindings: portBindings.filter((p) => p.containerPort.trim()),
          env: envVars.filter((e) => e.key.trim()).map((e) => `${e.key}=${e.value}`),
          binds: volumes.filter((v) => v.source.trim() && v.target.trim()).map((v) => `${v.source}:${v.target}`),
          restartPolicy: createRestart,
          autoStart: createAutoStart,
        }),
      });
      const data = (await resp.json()) as { success: boolean; message: string };
      if (data.success) {
        toast({ title: "✅ " + data.message });
        setCreateOpen(false);
        refresh();
      } else {
        toast({ variant: "destructive", title: "创建失败", description: data.message });
      }
    } catch (err) {
      toast({ variant: "destructive", title: "请求错误", description: String(err) });
    } finally {
      setCreating(false);
    }
  };

  const handleAction = (action: "start" | "stop" | "restart", id: string, name: string) => {
    const onSuccess = () => { toast({ title: "操作成功" }); refresh(); };
    if (action === "start") startContainer.mutate({ id }, { onSuccess });
    if (action === "stop") stopContainer.mutate({ id }, { onSuccess });
    if (action === "restart") restartContainer.mutate({ id }, { onSuccess });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteContainer.mutate({ id: deleteTarget.id }, {
      onSuccess: () => { toast({ title: "已删除", description: `容器 ${deleteTarget.name} 已删除` }); refresh(); setDeleteTarget(null); },
      onError: (e) => { toast({ variant: "destructive", title: "删除失败", description: String(e) }); setDeleteTarget(null); },
    });
  };

  const filteredContainers = containers?.filter((c) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return c.names.some((n) => n.toLowerCase().includes(term)) || c.image.toLowerCase().includes(term) || c.id.toLowerCase().includes(term);
  });

  // Port binding helpers
  const updatePort = (i: number, field: keyof PortBinding, val: string) =>
    setPortBindings((prev) => prev.map((p, idx) => idx === i ? { ...p, [field]: val } : p));
  const addPort = () => setPortBindings((p) => [...p, { hostPort: "", containerPort: "", protocol: "tcp" }]);
  const removePort = (i: number) => setPortBindings((p) => p.filter((_, idx) => idx !== i));

  // Env helpers
  const updateEnv = (i: number, field: "key" | "value", val: string) =>
    setEnvVars((prev) => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  const addEnv = () => setEnvVars((p) => [...p, { key: "", value: "" }]);
  const removeEnv = (i: number) => setEnvVars((p) => p.filter((_, idx) => idx !== i));

  // Volume helpers
  const updateVol = (i: number, field: "source" | "target", val: string) =>
    setVolumes((prev) => prev.map((v, idx) => idx === i ? { ...v, [field]: val } : v));
  const addVol = () => setVolumes((p) => [...p, { source: "", target: "" }]);
  const removeVol = (i: number) => setVolumes((p) => p.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white mb-2">容器管理</h2>
        <p className="text-muted-foreground">查看并管理所有的 Docker 容器实例。</p>
      </div>

      <Card className="bg-card border-card-border">
        <CardContent className="p-0">
          <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 items-center justify-between bg-background/50">
            <div className="flex items-center space-x-4 w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Filter className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="搜索容器名称、镜像或 ID..."
                  className="pl-9 bg-card font-mono text-sm"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="show-all" checked={showAll} onCheckedChange={setShowAll} />
                <Label htmlFor="show-all" className="text-sm cursor-pointer whitespace-nowrap">显示停止的容器</Label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={refresh}>
                <RefreshCw className="w-4 h-4 mr-2" /> 刷新
              </Button>
              <Button size="sm" className="bg-cyan-600 hover:bg-cyan-500 text-white" onClick={openCreateModal}>
                <PlusCircle className="w-4 h-4 mr-2" /> 新建容器
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-[150px]">名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>镜像</TableHead>
                <TableHead>端口映射</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">加载中...</TableCell></TableRow>
              ) : !filteredContainers || filteredContainers.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">没有找到匹配的容器</TableCell></TableRow>
              ) : (
                filteredContainers.map((container) => {
                  const name = container.names[0]?.replace(/^\//, "") || container.id.substring(0, 12);
                  const isRunning = container.state === "running";
                  return (
                    <TableRow key={container.id} className="border-border hover:bg-muted/50">
                      <TableCell className="font-medium text-white">
                        <div className="flex items-center gap-2">
                          <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", isRunning ? "bg-green-400" : "bg-gray-500")} />
                          <div>
                            <div className="font-mono text-sm">{name}</div>
                            <div className="font-mono text-xs text-muted-foreground mt-0.5">{container.id.substring(0, 12)}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(
                          "font-mono text-xs capitalize",
                          isRunning ? "bg-green-500/10 text-green-400 border-green-500/50" : "bg-muted text-muted-foreground"
                        )}>
                          {container.state}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-[200px] truncate" title={container.image}>
                        {container.image}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-cyan-400/80">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {container.ports.map((p, i) => (
                            <span key={i} className="bg-cyan-950/50 px-1 py-0.5 rounded">
                              {p.publicPort ? `${p.publicPort}→` : ""}{p.privatePort}/{p.type}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(container.created)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="查看日志" onClick={() => { setLogsContainerId(container.id); setLogsContainerName(name); }}>
                            <Terminal className="w-4 h-4 text-gray-400" />
                          </Button>
                          {isRunning ? (
                            <>
                              <Button variant="ghost" size="icon" title="停止" onClick={() => handleAction("stop", container.id, name)}>
                                <Square className="w-4 h-4 text-orange-400" />
                              </Button>
                              <Button variant="ghost" size="icon" title="重启" onClick={() => handleAction("restart", container.id, name)}>
                                <RefreshCw className="w-4 h-4 text-cyan-400" />
                              </Button>
                            </>
                          ) : (
                            <Button variant="ghost" size="icon" title="启动" onClick={() => handleAction("start", container.id, name)}>
                              <Play className="w-4 h-4 text-green-400" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" title="删除" onClick={() => setDeleteTarget({ id: container.id, name })}>
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create Container Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!creating) setCreateOpen(o); }}>
        <DialogContent className="bg-[#0d1117] border border-[#30363d] max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-cyan-400 flex items-center gap-2">
              <PlusCircle className="w-5 h-5" /> 新建容器
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">配置镜像、端口、环境变量和数据卷后创建并启动容器。</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Quick templates */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">快速模板</Label>
              <div className="flex flex-wrap gap-2">
                {QUICK_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.label}
                    onClick={() => applyTemplate(tpl)}
                    className="text-xs px-3 py-1.5 rounded border border-border bg-background hover:border-cyan-500/40 hover:text-cyan-400 text-muted-foreground transition-colors font-mono"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Basic config */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">基本配置</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">镜像地址 <span className="text-red-400">*</span></Label>
                  <Input
                    value={createImage}
                    onChange={(e) => setCreateImage(e.target.value)}
                    placeholder="nginx:latest / mysql:8.0 / your-image:tag"
                    className="font-mono text-sm bg-background"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">容器名称（可选）</Label>
                  <Input
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="my-container"
                    className="font-mono text-sm bg-background"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">重启策略</Label>
                  <Select value={createRestart} onValueChange={setCreateRestart}>
                    <SelectTrigger className="bg-background font-mono text-sm h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0d1117] border-[#30363d]">
                      <SelectItem value="no">no（不自动重启）</SelectItem>
                      <SelectItem value="always">always（始终重启）</SelectItem>
                      <SelectItem value="unless-stopped">unless-stopped（推荐）</SelectItem>
                      <SelectItem value="on-failure">on-failure（失败时重启）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Port bindings */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">端口映射</Label>
                <Button variant="ghost" size="sm" onClick={addPort} className="h-6 text-xs text-cyan-400 hover:text-cyan-300 px-2">
                  <Plus className="w-3 h-3 mr-1" /> 添加
                </Button>
              </div>
              <div className="space-y-2">
                {portBindings.map((pb, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input value={pb.hostPort} onChange={(e) => updatePort(i, "hostPort", e.target.value)}
                      placeholder="主机端口 (如 8080)" className="font-mono text-xs bg-background h-8 flex-1" />
                    <span className="text-muted-foreground text-sm flex-shrink-0">→</span>
                    <Input value={pb.containerPort} onChange={(e) => updatePort(i, "containerPort", e.target.value)}
                      placeholder="容器端口 (如 80)" className="font-mono text-xs bg-background h-8 flex-1" />
                    <Select value={pb.protocol} onValueChange={(v) => updatePort(i, "protocol", v)}>
                      <SelectTrigger className="bg-background font-mono text-xs h-8 w-20 flex-shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#0d1117] border-[#30363d]">
                        <SelectItem value="tcp">tcp</SelectItem>
                        <SelectItem value="udp">udp</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="icon" onClick={() => removePort(i)} className="h-8 w-8 text-red-400/60 hover:text-red-400 flex-shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Env vars */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">环境变量</Label>
                <Button variant="ghost" size="sm" onClick={addEnv} className="h-6 text-xs text-cyan-400 hover:text-cyan-300 px-2">
                  <Plus className="w-3 h-3 mr-1" /> 添加
                </Button>
              </div>
              <div className="space-y-2">
                {envVars.map((ev, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input value={ev.key} onChange={(e) => updateEnv(i, "key", e.target.value)}
                      placeholder="KEY" className="font-mono text-xs bg-background h-8 flex-1" />
                    <span className="text-muted-foreground text-sm flex-shrink-0">=</span>
                    <Input value={ev.value} onChange={(e) => updateEnv(i, "value", e.target.value)}
                      placeholder="VALUE" className="font-mono text-xs bg-background h-8 flex-1" />
                    <Button variant="ghost" size="icon" onClick={() => removeEnv(i)} className="h-8 w-8 text-red-400/60 hover:text-red-400 flex-shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Volume mounts */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">数据卷挂载</Label>
                <Button variant="ghost" size="sm" onClick={addVol} className="h-6 text-xs text-cyan-400 hover:text-cyan-300 px-2">
                  <Plus className="w-3 h-3 mr-1" /> 添加
                </Button>
              </div>
              <div className="space-y-2">
                {volumes.map((vol, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input value={vol.source} onChange={(e) => updateVol(i, "source", e.target.value)}
                      placeholder="来源 (卷名或主机路径)" className="font-mono text-xs bg-background h-8 flex-1" />
                    <span className="text-muted-foreground text-sm flex-shrink-0">:</span>
                    <Input value={vol.target} onChange={(e) => updateVol(i, "target", e.target.value)}
                      placeholder="容器内路径 (如 /data)" className="font-mono text-xs bg-background h-8 flex-1" />
                    <Button variant="ghost" size="icon" onClick={() => removeVol(i)} className="h-8 w-8 text-red-400/60 hover:text-red-400 flex-shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Auto start toggle */}
            <div className="flex items-center gap-3 pt-1">
              <Switch id="auto-start" checked={createAutoStart} onCheckedChange={setCreateAutoStart} />
              <Label htmlFor="auto-start" className="text-sm cursor-pointer">创建后立即启动容器</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>取消</Button>
            <Button
              className="bg-cyan-600 hover:bg-cyan-500 text-white"
              onClick={handleCreateContainer}
              disabled={creating || !createImage.trim()}
            >
              {creating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />创建中...</> : <><Box className="w-4 h-4 mr-2" />创建容器</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="bg-[#0d1117] border border-[#30363d] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-400" /> 确认删除容器
            </DialogTitle>
            <DialogDescription className="text-muted-foreground pt-1">
              即将强制删除容器 <span className="font-mono text-red-400">{deleteTarget?.name}</span>。
              容器内未挂载的数据将丢失。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="border-border" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button className="bg-red-600 hover:bg-red-500 text-white" onClick={confirmDelete}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LogsModal containerId={logsContainerId} containerName={logsContainerName} isOpen={!!logsContainerId} onClose={() => setLogsContainerId(null)} />
    </div>
  );
}
