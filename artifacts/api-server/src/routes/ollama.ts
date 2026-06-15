import { Router } from "express";
import { docker } from "../lib/docker";
import os from "os";

const router = Router();

const DEFAULT_CONTAINER_NAME = "ollama";
const DEFAULT_IMAGE = "ollama/ollama:latest";
const DEFAULT_VOLUME = "ollama_data";
const DEFAULT_PORT = 11434;

let activePullController: AbortController | null = null;

async function findOllamaContainer(containerName = DEFAULT_CONTAINER_NAME) {
  const containers = await docker.listContainers({ all: true });
  return containers.find(
    (c) =>
      c.Names.some((n) => n === `/${containerName}`) ||
      c.Image === DEFAULT_IMAGE ||
      c.Image.startsWith("ollama/ollama")
  );
}

async function getOllamaBaseUrl(port = DEFAULT_PORT) {
  return `http://localhost:${port}`;
}

function getNetworkInterfaces() {
  const ifaces = os.networkInterfaces();
  const result: { name: string; address: string }[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        result.push({ name, address: addr.address });
      }
    }
  }
  return result;
}

router.get("/ollama/status", async (req, res) => {
  try {
    const container = await findOllamaContainer();
    if (!container) {
      return res.json({
        running: false, containerId: null, containerName: null,
        port: null, uptime: null, apiReachable: false, modelCount: 0,
      });
    }

    const running = container.State === "running";
    const portBinding = container.Ports.find((p) => p.PrivatePort === DEFAULT_PORT);
    const port = portBinding?.PublicPort ?? DEFAULT_PORT;

    let apiReachable = false;
    let modelCount = 0;
    if (running) {
      try {
        const resp = await fetch(`http://localhost:${port}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) {
          apiReachable = true;
          const data = (await resp.json()) as { models?: unknown[] };
          modelCount = (data.models || []).length;
        }
      } catch {
        apiReachable = false;
      }
    }

    const inspected = docker.getContainer(container.Id);
    const info = await inspected.inspect();
    const startedAt = info.State?.StartedAt;
    let uptime: string | null = null;
    if (running && startedAt) {
      const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      if (seconds < 60) uptime = `${seconds}秒`;
      else if (seconds < 3600) uptime = `${Math.floor(seconds / 60)}分钟`;
      else if (seconds < 86400) uptime = `${Math.floor(seconds / 3600)}小时`;
      else uptime = `${Math.floor(seconds / 86400)}天`;
    }

    return res.json({
      running, containerId: container.Id,
      containerName: container.Names[0]?.replace(/^\//, "") || DEFAULT_CONTAINER_NAME,
      port, uptime, apiReachable, modelCount,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get Ollama status");
    return res.status(500).json({ error: "Failed to get Ollama status" });
  }
});

// Deploy endpoint - SSE streaming, supports custom image/name/port/volume
router.post("/ollama/deploy", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const {
      port = DEFAULT_PORT,
      image = DEFAULT_IMAGE,
      containerName = DEFAULT_CONTAINER_NAME,
      volumeName = DEFAULT_VOLUME,
      extraEnv = [],
    } = (req.body || {}) as {
      port?: number;
      image?: string;
      containerName?: string;
      volumeName?: string;
      extraEnv?: string[];
    };

    sendEvent({ stage: "checking", message: `正在检测容器 "${containerName}"...` });

    // Check if container with same name exists
    const allContainers = await docker.listContainers({ all: true });
    const existing = allContainers.find((c) =>
      c.Names.some((n) => n === `/${containerName}`) ||
      c.Image.startsWith("ollama/ollama")
    );

    if (existing) {
      if (existing.State === "running") {
        sendEvent({ stage: "done", success: true, message: `容器 "${containerName}" 已在运行中，无需重新部署` });
        return res.end();
      }
      sendEvent({ stage: "starting", message: `发现已停止的容器，正在重新启动...` });
      await docker.getContainer(existing.Id).start();
      sendEvent({ stage: "done", success: true, message: `容器已重新启动！` });
      return res.end();
    }

    sendEvent({ stage: "checking", message: `正在检测端口 ${port} 占用情况...` });
    const runningContainers = await docker.listContainers({ all: false });
    const portConflict = runningContainers.some((c) =>
      c.Ports.some((p) => p.PublicPort === port)
    );
    if (portConflict) {
      sendEvent({ stage: "error", success: false, message: `端口 ${port} 已被其他容器占用，请修改端口后重试` });
      return res.end();
    }

    if (volumeName) {
      sendEvent({ stage: "volume", message: `正在准备数据卷 "${volumeName}"...` });
      try {
        const volumes = await docker.listVolumes();
        if (!(volumes.Volumes || []).some((v) => v.Name === volumeName)) {
          await docker.createVolume({ Name: volumeName, Driver: "local" });
          sendEvent({ stage: "volume", message: `数据卷 "${volumeName}" 创建成功` });
        } else {
          sendEvent({ stage: "volume", message: `数据卷 "${volumeName}" 已存在，模型数据将保留` });
        }
      } catch {
        sendEvent({ stage: "volume", message: "数据卷操作失败（将继续部署）" });
      }
    }

    const images = await docker.listImages({ all: false });
    const hasImage = images.some((img) =>
      (img.RepoTags || []).some((t) => t === image || t.startsWith(image.split(":")[0]))
    );

    if (!hasImage) {
      sendEvent({ stage: "pulling", message: `正在拉取镜像 "${image}"（首次可能需要数分钟）...` });

      await new Promise<void>((resolve, reject) => {
        docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) return reject(err);
          docker.modem.followProgress(
            stream,
            (err2: Error | null) => { if (err2) reject(err2); else resolve(); },
            (event: {
              status?: string;
              progressDetail?: { current?: number; total?: number };
              progress?: string;
              id?: string;
            }) => {
              const detail = event.progressDetail;
              const pct = detail?.total && detail.current
                ? Math.round((detail.current / detail.total) * 100) : null;
              sendEvent({
                stage: "pulling",
                message: `${event.status || "拉取中"}${event.id ? ` [${event.id}]` : ""}`,
                progress: event.progress || "",
                percent: pct,
              });
            }
          );
        });
      });
      sendEvent({ stage: "pulling", message: "镜像拉取完成！", percent: 100 });
    } else {
      sendEvent({ stage: "pulling", message: `镜像 "${image}" 已存在，跳过拉取`, percent: 100 });
    }

    sendEvent({ stage: "creating", message: `正在创建容器（名称: ${containerName}，端口: ${port}，OLLAMA_ORIGINS=*）...` });

    const envVars = ["OLLAMA_ORIGINS=*", ...extraEnv.filter((e: string) => e.trim())];
    const portKey = `${DEFAULT_PORT}/tcp`;
    const container = await docker.createContainer({
      name: containerName,
      Image: image,
      Env: envVars,
      HostConfig: {
        PortBindings: { [portKey]: [{ HostPort: String(port) }] },
        Binds: volumeName ? [`${volumeName}:/root/.ollama`] : [],
        RestartPolicy: { Name: "unless-stopped" },
      },
      ExposedPorts: { [portKey]: {} },
    });

    sendEvent({ stage: "starting", message: "正在启动容器..." });
    await container.start();
    sendEvent({ stage: "done", success: true, message: `Ollama 部署成功！容器 "${containerName}" 已启动` });
    return res.end();
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to deploy Ollama");
    const msg = err instanceof Error ? err.message : String(err);
    sendEvent({ stage: "error", success: false, message: `部署失败: ${msg}` });
    return res.end();
  }
});

router.post("/ollama/start", async (req, res) => {
  try {
    const container = await findOllamaContainer();
    if (!container) return res.status(404).json({ success: false, message: "未找到 Ollama 容器，请先部署" });
    await docker.getContainer(container.Id).start();
    return res.json({ success: true, message: "Ollama 已启动" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, message: msg });
  }
});

router.post("/ollama/stop", async (req, res) => {
  try {
    const container = await findOllamaContainer();
    if (!container) return res.status(404).json({ success: false, message: "未找到 Ollama 容器" });
    await docker.getContainer(container.Id).stop();
    return res.json({ success: true, message: "Ollama 已停止" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, message: msg });
  }
});

router.post("/ollama/restart", async (req, res) => {
  try {
    const container = await findOllamaContainer();
    if (!container) return res.status(404).json({ success: false, message: "未找到 Ollama 容器" });
    await docker.getContainer(container.Id).restart();
    return res.json({ success: true, message: "Ollama 已重启" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, message: msg });
  }
});

router.get("/ollama/logs", async (req, res) => {
  try {
    const container = await findOllamaContainer();
    if (!container) return res.json({ logs: "未找到 Ollama 容器", containerId: "" });
    const c = docker.getContainer(container.Id);
    const logs = await c.logs({ stdout: true, stderr: true, tail: 200 });
    const logStr = logs.toString("utf8").split("\n").map((line) =>
      line.length > 8 ? line.slice(8) : line
    ).join("\n");
    return res.json({ logs: logStr, containerId: container.Id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, message: msg });
  }
});

router.get("/ollama/models", async (req, res) => {
  try {
    const status = await findOllamaContainer();
    if (!status || status.State !== "running") return res.json([]);
    const portBinding = status.Ports.find((p) => p.PrivatePort === DEFAULT_PORT);
    const port = portBinding?.PublicPort ?? DEFAULT_PORT;
    const resp = await fetch(`http://localhost:${port}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return res.json([]);
    const data = (await resp.json()) as { models?: unknown[] };
    const models = (data.models || []) as Array<{
      name: string; size: number; digest: string; modified_at: string;
      details?: { parameter_size?: string; quantization_level?: string };
    }>;
    return res.json(models.map((m) => ({
      name: m.name, size: m.size, digest: m.digest, modifiedAt: m.modified_at,
      parameterSize: m.details?.parameter_size || "",
      quantizationLevel: m.details?.quantization_level || "",
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list models");
    return res.json([]);
  }
});

router.post("/ollama/models/pull", async (req, res) => {
  try {
    const { model } = req.body as { model: string };
    if (!model) return res.status(400).json({ error: "model is required" });

    const status = await findOllamaContainer();
    if (!status || status.State !== "running") {
      return res.status(400).json({ error: "Ollama 未运行，请先部署或启动 Ollama" });
    }
    const portBinding = status.Ports.find((p) => p.PrivatePort === DEFAULT_PORT);
    const port = portBinding?.PublicPort ?? DEFAULT_PORT;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    activePullController = new AbortController();
    const { signal } = activePullController;

    try {
      const resp = await fetch(`http://localhost:${port}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: model, stream: true }),
        signal,
      });

      if (!resp.ok || !resp.body) {
        res.write(`data: ${JSON.stringify({ error: "拉取请求失败，请检查模型名称是否正确" })}\n\n`);
        return res.end();
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const text = decoder.decode(value, { stream: true });
          for (const line of text.split("\n").filter((l) => l.trim())) {
            try {
              res.write(`data: ${line}\n\n`);
            } catch { /* skip */ }
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") {
        res.write(`data: ${JSON.stringify({ status: "已停止拉取" })}\n\n`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        res.write(`data: ${JSON.stringify({ error: `拉取失败: ${msg}` })}\n\n`);
      }
    } finally {
      activePullController = null;
      return res.end();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, message: msg });
  }
});

router.post("/ollama/models/stop-pull", async (req, res) => {
  if (activePullController) {
    activePullController.abort();
    activePullController = null;
    return res.json({ success: true, message: "已停止拉取" });
  }
  return res.json({ success: false, message: "当前没有正在进行的拉取" });
});

router.delete("/ollama/models/:name", async (req, res) => {
  try {
    const { name } = req.params;
    const status = await findOllamaContainer();
    if (!status || status.State !== "running") {
      return res.status(400).json({ success: false, message: "Ollama 未运行" });
    }
    const portBinding = status.Ports.find((p) => p.PrivatePort === DEFAULT_PORT);
    const port = portBinding?.PublicPort ?? DEFAULT_PORT;

    const resp = await fetch(`http://localhost:${port}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ success: false, message: text });
    }
    return res.json({ success: true, message: `模型 ${name} 已删除` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, message: msg });
  }
});

router.get("/ollama/client-config", async (req, res) => {
  try {
    const localUrl = `http://localhost:${DEFAULT_PORT}`;
    const networkIfaces = getNetworkInterfaces();
    const lanIp = networkIfaces[0]?.address || "192.168.1.x";
    const lanUrl = `http://${lanIp}:${DEFAULT_PORT}`;

    const configs = [
      {
        client: "Codex Desktop",
        description: "OpenAI Codex 桌面版本地模型配置",
        localConfig: JSON.stringify({ baseURL: `${localUrl}/v1`, apiKey: "ollama", model: "llama3" }, null, 2),
        lanConfig: JSON.stringify({ baseURL: `${lanUrl}/v1`, apiKey: "ollama", model: "llama3" }, null, 2),
        configPath: null, testUrl: localUrl,
      },
      {
        client: "Claude Code",
        description: "Claude Code (claude.ai/code) 本地模型配置",
        localConfig: `export ANTHROPIC_BASE_URL="${localUrl}/v1"\nexport ANTHROPIC_API_KEY="ollama"\nexport CLAUDE_CODE_MAX_TOKENS=4096`,
        lanConfig: `export ANTHROPIC_BASE_URL="${lanUrl}/v1"\nexport ANTHROPIC_API_KEY="ollama"\nexport CLAUDE_CODE_MAX_TOKENS=4096`,
        configPath: null, testUrl: localUrl,
      },
      {
        client: "Continue.dev",
        description: "Continue.dev VS Code 插件配置（~/.continue/config.json）",
        localConfig: JSON.stringify({
          models: [{ title: "Ollama (本地)", provider: "ollama", model: "llama3", apiBase: localUrl }],
        }, null, 2),
        lanConfig: JSON.stringify({
          models: [{ title: "Ollama (局域网)", provider: "ollama", model: "llama3", apiBase: lanUrl }],
        }, null, 2),
        configPath: "~/.continue/config.json", testUrl: localUrl,
      },
      {
        client: "Open WebUI",
        description: "Open WebUI 浏览器界面连接配置",
        localConfig: `OLLAMA_BASE_URL=${localUrl}`,
        lanConfig: `OLLAMA_BASE_URL=${lanUrl}`,
        configPath: null, testUrl: localUrl,
      },
    ];

    return res.json({ localUrl, lanUrl, configs, networkInterfaces: networkIfaces });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, message: msg });
  }
});

router.post("/ollama/test-connection", async (req, res) => {
  try {
    const { url } = req.body as { url: string };
    const startTime = Date.now();
    let resp: Response;
    try {
      resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(6000) });
    } catch (fetchErr: unknown) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      let hint = "";
      if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
        hint = "；请确认 Ollama 容器已启动且端口 11434 已正确映射";
      } else if (msg.includes("timeout") || msg.includes("AbortError")) {
        hint = "；连接超时，服务可能正在启动中，稍后重试";
      }
      return res.json({ success: false, message: `端口不通: ${msg}${hint}`, latencyMs: null, models: [], hint });
    }
    const latencyMs = Date.now() - startTime;

    if (!resp.ok) {
      return res.json({ success: false, message: `HTTP ${resp.status}，Ollama 服务异常`, latencyMs: null, models: [] });
    }

    const data = (await resp.json()) as { models?: Array<{ name: string }> };
    const models = (data.models || []).map((m) => m.name);
    const msg = models.length > 0
      ? `连接成功，延迟 ${latencyMs}ms，${models.length} 个模型已就绪`
      : `连接成功（延迟 ${latencyMs}ms），但尚未拉取任何模型`;
    return res.json({ success: true, message: msg, latencyMs, models });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.json({ success: false, message: `连接失败: ${msg}`, latencyMs: null, models: [] });
  }
});

// Get model path inside container
router.get("/ollama/models/:name/path", async (req, res) => {
  try {
    const modelName = decodeURIComponent(req.params.name);
    const container = await findOllamaContainer();
    if (!container || container.State !== "running") {
      return res.status(400).json({ success: false, message: "Ollama 容器未运行" });
    }

    // Parse model name to construct path
    let registry = "registry.ollama.ai";
    let namespace = "library";
    let name = modelName;
    let tag = "latest";

    const colonIdx = modelName.lastIndexOf(":");
    if (colonIdx > 0) {
      tag = modelName.slice(colonIdx + 1);
      name = modelName.slice(0, colonIdx);
    }
    const slashParts = name.split("/");
    if (slashParts.length === 3) {
      [registry, namespace, name] = slashParts;
    } else if (slashParts.length === 2) {
      [namespace, name] = slashParts;
    }

    const manifestPath = `/root/.ollama/models/manifests/${registry}/${namespace}/${name}/${tag}`;
    const blobsDir = `/root/.ollama/models/blobs/`;
    const baseDir = `/root/.ollama/`;

    // Try to exec into container to verify path exists
    let verified = false;
    let fileSize = "";
    try {
      const c = docker.getContainer(container.Id);
      const exec = await c.exec({
        Cmd: ["ls", "-la", manifestPath],
        AttachStdout: true,
        AttachStderr: true,
      });
      const stream = await exec.start({ Detach: false });
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve) => {
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", resolve);
      });
      const output = Buffer.concat(chunks).toString("utf8");
      verified = output.includes(tag) && !output.includes("No such file");
      const sizeMatch = output.match(/\s+(\d+)\s+/);
      if (sizeMatch) fileSize = `${sizeMatch[1]} 字节`;
    } catch { /* exec not critical */ }

    return res.json({
      success: true,
      modelName,
      baseDir,
      manifestPath,
      blobsDir,
      volumeMount: "ollama_data:/root/.ollama",
      verified,
      fileSize,
      hint: "数据卷 ollama_data 挂载到宿主机，容器重启后模型数据保留",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, message: msg });
  }
});

// Service readiness — poll until Ollama API responds
router.get("/ollama/readiness", async (req, res) => {
  try {
    const container = await findOllamaContainer();
    if (!container || container.State !== "running") {
      return res.json({ ready: false, message: "容器未运行", models: [] });
    }
    const portBinding = container.Ports.find((p) => p.PrivatePort === DEFAULT_PORT);
    const port = portBinding?.PublicPort ?? DEFAULT_PORT;

    const startTime = Date.now();
    try {
      const resp = await fetch(`http://localhost:${port}/api/tags`, { signal: AbortSignal.timeout(5000) });
      const latencyMs = Date.now() - startTime;
      if (resp.ok) {
        const data = (await resp.json()) as { models?: Array<{ name: string }> };
        const models = (data.models || []).map((m: { name: string }) => m.name);
        return res.json({ ready: true, message: `API 就绪，延迟 ${latencyMs}ms`, models, port });
      }
      return res.json({ ready: false, message: `API 返回 HTTP ${resp.status}，服务启动中...`, models: [], port });
    } catch {
      return res.json({ ready: false, message: "API 暂未就绪，Ollama 服务正在启动...", models: [], port });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ready: false, message: msg, models: [] });
  }
});

// Pre-launch check for Codex / Claude Code
router.post("/ollama/launch-check", async (req, res) => {
  try {
    const { model = "", tool = "codex" } = req.body as { model?: string; tool?: string };

    const checks: Array<{ label: string; ok: boolean; message: string; hint?: string }> = [];

    // 1. Ollama container running?
    const container = await findOllamaContainer();
    const containerRunning = !!container && container.State === "running";
    checks.push({
      label: "Ollama 容器",
      ok: containerRunning,
      message: containerRunning ? `容器运行中 (${container?.Names[0]?.replace(/^\//, "")})` : "容器未运行",
      hint: containerRunning ? undefined : "请在 Ollama 管理页面点击「一键部署 Ollama」",
    });

    const portBinding = container?.Ports.find((p) => p.PrivatePort === DEFAULT_PORT);
    const port = portBinding?.PublicPort ?? DEFAULT_PORT;

    // 2. Port reachable?
    let apiReachable = false;
    let availableModels: string[] = [];
    if (containerRunning) {
      try {
        const resp = await fetch(`http://localhost:${port}/api/tags`, { signal: AbortSignal.timeout(4000) });
        if (resp.ok) {
          apiReachable = true;
          const data = (await resp.json()) as { models?: Array<{ name: string }> };
          availableModels = (data.models || []).map((m) => m.name);
        }
      } catch { /* unreachable */ }
    }
    checks.push({
      label: `端口 ${port} (Ollama API)`,
      ok: apiReachable,
      message: apiReachable ? `端口可达，OLLAMA_ORIGINS=* 已启用` : `端口 ${port} 不可达`,
      hint: apiReachable ? undefined : "容器启动后通常需要 5-10 秒初始化，请稍后重试",
    });

    // 3. Model check
    const targetModel = model || availableModels[0] || "";
    const modelExists = targetModel ? availableModels.some((m) => m === targetModel || m.startsWith(targetModel.split(":")[0])) : availableModels.length > 0;
    const resolvedModel = modelExists ? (availableModels.find((m) => m === targetModel || m.startsWith(targetModel.split(":")[0])) || availableModels[0]) : "";
    checks.push({
      label: "模型可用性",
      ok: modelExists,
      message: modelExists
        ? `模型「${resolvedModel}」已就绪`
        : targetModel
          ? `模型「${targetModel}」未找到，已安装: ${availableModels.join(", ") || "无"}`
          : "尚未拉取任何模型",
      hint: modelExists ? undefined : "请在 Ollama 管理页面拉取需要的模型后再启动",
    });

    const baseUrl = `http://localhost:${port}`;
    const openaiBaseUrl = `${baseUrl}/v1`;
    const actualModel = resolvedModel || targetModel || "llama3";
    const ready = containerRunning && apiReachable && modelExists;

    // Generate commands by platform
    const commands = {
      codex: {
        configYaml: `# ~/.codex/config.yaml\nmodel: "${actualModel}"\nprovider: ollama\nbaseURL: "${openaiBaseUrl}"\napiKey: "ollama"\napprovalMode: suggest`,
        win: `$env:OPENAI_BASE_URL="${openaiBaseUrl}"\n$env:OPENAI_API_KEY="ollama"\nnpx @openai/codex`,
        mac: `OPENAI_BASE_URL="${openaiBaseUrl}" OPENAI_API_KEY="ollama" npx @openai/codex`,
        linux: `OPENAI_BASE_URL="${openaiBaseUrl}" OPENAI_API_KEY="ollama" npx @openai/codex`,
      },
      claude: {
        win: `$env:ANTHROPIC_BASE_URL="${openaiBaseUrl}"\n$env:ANTHROPIC_API_KEY="ollama"\n$env:ANTHROPIC_MODEL="${actualModel}"\nclaude`,
        mac: `export ANTHROPIC_BASE_URL="${openaiBaseUrl}"\nexport ANTHROPIC_API_KEY="ollama"\nexport ANTHROPIC_MODEL="${actualModel}"\nclaude`,
        linux: `export ANTHROPIC_BASE_URL="${openaiBaseUrl}"\nexport ANTHROPIC_API_KEY="ollama"\nexport ANTHROPIC_MODEL="${actualModel}"\nclaude`,
      },
    };

    return res.json({
      ready,
      checks,
      availableModels,
      resolvedModel: actualModel,
      baseUrl,
      openaiBaseUrl,
      commands,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ ready: false, checks: [], message: msg });
  }
});

export default router;
