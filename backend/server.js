const http = require("http");
const redis = require("redis");
const crypto = require("crypto");

try {
  require("dotenv").config();
} catch {
  // dotenv reste optionnel dans les environnements conteneurises.
}

const PORT = process.env.PORT || 3001;
const APP_ENV = process.env.APP_ENV || "development";
const APP_VERSION = process.env.APP_VERSION || "1.0.0";
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

const VALID_STATUSES = ["todo", "in-progress", "done"];
const VALID_PRIORITIES = ["low", "medium", "high"];

function genId() {
  return crypto.randomBytes(6).toString("hex");
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON invalide"));
      }
    });
  });
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-App-Version": APP_VERSION,
    "X-App-Env": APP_ENV,
  });

  res.end(JSON.stringify(data));
}

function createRedisClient(url = REDIS_URL) {
  const client = redis.createClient({ url });
  client.on("error", (err) => console.error("Redis error:", err.message));
  return client;
}

function createTaskStore(client) {
  return {
    async getTasks() {
      const keys = await client.keys("task:*");
      if (!keys.length) {
        return [];
      }

      const tasks = await Promise.all(
        keys.map(async (key) => {
          const task = await client.hGetAll(key);
          return {
            id: key.replace("task:", ""),
            title: task.title,
            description: task.description || "",
            status: task.status || "todo",
            priority: task.priority || "medium",
            createdAt: task.createdAt,
            updatedAt: task.updatedAt || task.createdAt,
          };
        })
      );

      return tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    async getTask(id) {
      const task = await client.hGetAll(`task:${id}`);
      if (!task.title) {
        return null;
      }

      return { id, ...task };
    },

    async createTask({ title, description, priority }) {
      if (!title || !title.trim()) {
        throw new Error("Le titre est requis");
      }

      if (priority && !VALID_PRIORITIES.includes(priority)) {
        throw new Error("Priorite invalide : low, medium ou high");
      }

      const id = genId();
      const now = new Date().toISOString();
      const normalizedTitle = title.trim();
      const normalizedDescription = description ? description.trim() : "";
      const normalizedPriority = priority || "medium";

      await client.hSet(`task:${id}`, {
        title: normalizedTitle,
        description: normalizedDescription,
        status: "todo",
        priority: normalizedPriority,
        createdAt: now,
        updatedAt: now,
      });
      await client.incr("stats:total_created");

      return {
        id,
        title: normalizedTitle,
        description: normalizedDescription,
        status: "todo",
        priority: normalizedPriority,
        createdAt: now,
        updatedAt: now,
      };
    },

    async updateTask(id, { title, description, status, priority }) {
      const exists = await client.exists(`task:${id}`);
      if (!exists) {
        return null;
      }

      if (status && !VALID_STATUSES.includes(status)) {
        throw new Error("Statut invalide : todo, in-progress ou done");
      }

      if (priority && !VALID_PRIORITIES.includes(priority)) {
        throw new Error("Priorite invalide : low, medium ou high");
      }

      const now = new Date().toISOString();
      const updates = { updatedAt: now };

      if (title !== undefined) {
        updates.title = title.trim();
      }

      if (description !== undefined) {
        updates.description = description.trim();
      }

      if (status !== undefined) {
        updates.status = status;
        if (status === "done") {
          await client.incr("stats:total_completed");
        }
      }

      if (priority !== undefined) {
        updates.priority = priority;
      }

      await client.hSet(`task:${id}`, updates);
      return this.getTask(id);
    },

    async deleteTask(id) {
      const deleted = await client.del(`task:${id}`);
      return deleted > 0;
    },
  };
}

async function getHealthPayload(client) {
  const redisConnected = client.isOpen;
  const totalCreated = redisConnected ? await client.get("stats:total_created") : "0";
  const totalCompleted = redisConnected ? await client.get("stats:total_completed") : "0";

  return {
    status: redisConnected ? "ok" : "degraded",
    env: APP_ENV,
    version: APP_VERSION,
    redis: redisConnected ? "connected" : "disconnected",
    stats: {
      totalCreated: parseInt(totalCreated || "0", 10),
      totalCompleted: parseInt(totalCompleted || "0", 10),
    },
  };
}

function createServer(client) {
  const store = createTaskStore(client);

  return http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    const url = req.url.split("?")[0];

    if (req.method === "GET" && url === "/health") {
      try {
        const payload = await getHealthPayload(client);
        json(res, payload.status === "ok" ? 200 : 503, payload);
      } catch (error) {
        json(res, 503, {
          status: "error",
          env: APP_ENV,
          version: APP_VERSION,
          redis: "unavailable",
          error: error.message,
        });
      }
      return;
    }

    if (req.method === "GET" && url === "/tasks") {
      const tasks = await store.getTasks();
      json(res, 200, { total: tasks.length, tasks });
      return;
    }

    if (req.method === "POST" && url === "/tasks") {
      try {
        const body = await parseBody(req);
        const task = await store.createTask(body);
        json(res, 201, task);
      } catch (error) {
        json(res, 400, { error: error.message });
      }
      return;
    }

    const matchPut = url.match(/^\/tasks\/([a-f0-9]{12})$/);
    if (req.method === "PUT" && matchPut) {
      try {
        const body = await parseBody(req);
        const task = await store.updateTask(matchPut[1], body);
        if (!task) {
          json(res, 404, { error: "Tache introuvable" });
          return;
        }

        json(res, 200, task);
      } catch (error) {
        json(res, 400, { error: error.message });
      }
      return;
    }

    const matchDelete = url.match(/^\/tasks\/([a-f0-9]{12})$/);
    if (req.method === "DELETE" && matchDelete) {
      const deleted = await store.deleteTask(matchDelete[1]);
      if (!deleted) {
        json(res, 404, { error: "Tache introuvable" });
        return;
      }

      json(res, 200, { message: "Tache supprimee" });
      return;
    }

    json(res, 404, { error: "Route introuvable" });
  });
}

async function startServer() {
  const client = createRedisClient();
  await client.connect();

  const server = createServer(client);

  await new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`TaskFlow API - env: ${APP_ENV}, version: ${APP_VERSION}, port: ${PORT}`);
      console.log(`Redis connecte sur ${REDIS_URL}`);
      resolve();
    });
  });

  const shutdown = async (signal) => {
    console.log(`Signal recu: ${signal}. Arret en cours...`);

    await new Promise((resolve) => {
      server.close(() => resolve());
    });

    if (client.isOpen) {
      await client.quit();
    }

    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { server, client };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Impossible de demarrer:", error.message);
    process.exit(1);
  });
}

module.exports = {
  VALID_PRIORITIES,
  VALID_STATUSES,
  createRedisClient,
  createServer,
  genId,
  startServer,
};
