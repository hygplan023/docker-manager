import { Router } from "express";
import { docker } from "../lib/docker";

const router = Router();

router.get("/containers", async (req, res) => {
  try {
    const all = req.query.all === "true" || req.query.all === "1";
    const containers = await docker.listContainers({ all });
    const result = containers.map((c) => ({
      id: c.Id,
      names: c.Names,
      image: c.Image,
      status: c.Status,
      state: c.State,
      created: c.Created,
      ports: (c.Ports || []).map((p) => ({
        privatePort: p.PrivatePort,
        publicPort: p.PublicPort ?? null,
        type: p.Type,
      })),
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list containers");
    res.status(500).json({ error: "Failed to list containers" });
  }
});

router.post("/containers/:id/start", async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.start();
    res.json({ success: true, message: "容器已启动" });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to start container");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: msg });
  }
});

router.post("/containers/:id/stop", async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.stop();
    res.json({ success: true, message: "容器已停止" });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to stop container");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: msg });
  }
});

router.post("/containers/:id/restart", async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.restart();
    res.json({ success: true, message: "容器已重启" });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to restart container");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: msg });
  }
});

router.delete("/containers/:id", async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    await container.remove({ force: true });
    res.json({ success: true, message: "容器已删除" });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to remove container");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: msg });
  }
});

router.post("/containers/create", async (req, res) => {
  try {
    const {
      image,
      name,
      portBindings = [],
      env = [],
      binds = [],
      restartPolicy = "no",
      autoStart = true,
    } = req.body as {
      image: string;
      name?: string;
      portBindings?: { hostPort: string; containerPort: string; protocol?: string }[];
      env?: string[];
      binds?: string[];
      restartPolicy?: string;
      autoStart?: boolean;
    };

    if (!image) {
      return res.status(400).json({ success: false, message: "镜像名称不能为空" });
    }

    const portBindingsConfig: Record<string, { HostPort: string }[]> = {};
    const exposedPorts: Record<string, object> = {};
    for (const pb of portBindings) {
      if (!pb.containerPort) continue;
      const proto = pb.protocol || "tcp";
      const key = `${pb.containerPort}/${proto}`;
      portBindingsConfig[key] = [{ HostPort: pb.hostPort || "" }];
      exposedPorts[key] = {};
    }

    const createOpts: Parameters<typeof docker.createContainer>[0] = {
      Image: image,
      Env: env.filter((e) => e.trim()),
      ExposedPorts: Object.keys(exposedPorts).length ? exposedPorts : undefined,
      HostConfig: {
        PortBindings: Object.keys(portBindingsConfig).length ? portBindingsConfig : undefined,
        Binds: binds.filter((b) => b.trim()),
        RestartPolicy: { Name: restartPolicy as "no" | "always" | "unless-stopped" | "on-failure" },
      },
    };
    if (name && name.trim()) (createOpts as Record<string, unknown>).name = name.trim();

    const container = await docker.createContainer(createOpts);
    let started = false;
    if (autoStart) {
      try {
        await container.start();
        started = true;
      } catch {}
    }

    return res.json({
      success: true,
      message: started ? "容器已创建并启动" : "容器已创建（未启动）",
      containerId: container.id,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to create container");
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, message: `创建失败: ${msg}` });
  }
});

router.get("/containers/:id/logs", async (req, res) => {
  try {
    const container = docker.getContainer(req.params.id);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: 100,
    });
    const logStr = logs
      .toString("utf8")
      .split("\n")
      .map((line) => {
        // Docker multiplexed stream: first 8 bytes are header
        if (line.length > 8) {
          const stripped = line.slice(8);
          return stripped;
        }
        return line;
      })
      .join("\n");
    res.json({ logs: logStr, containerId: req.params.id });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to get container logs");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: msg });
  }
});

export default router;
