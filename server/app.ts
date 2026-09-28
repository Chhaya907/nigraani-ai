import "dotenv/config";
import express, { Express } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./_core/oauth";
import { registerStorageProxy } from "./_core/storageProxy";
import { appRouter } from "./routers";
import { createContext } from "./_core/context";
import { evidenceRouter } from "./evidenceRoute";
import fs from "fs";
import path from "path";
import { getUploadsBaseDir } from "./uploadsDir";

export function createExpressApp(): Express {
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Uploads directory fallback (safe for both local filesystem and serverless /tmp)
  const uploadsDir = getUploadsBaseDir();

  // Health check endpoint for deployment monitoring
  app.get(["/api/health", "/health"], (_req: any, res: any) => {
    res.json({
      status: "ok",
      service: "Nigraani AI Platform",
      roles: ["mospi", "state", "district", "mp", "cag"],
      databaseConfigured: Boolean(process.env.DATABASE_URL),
      storageConfigured: Boolean(process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || process.env.BUILT_IN_FORGE_API_URL),
      timestamp: new Date().toISOString(),
    });
  });

  // Evidence serving and PDF export routes
  app.use(evidenceRouter);
  app.use("/uploads", express.static(uploadsDir));

  // Storage proxy and OAuth
  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // tRPC API (supports both /api/trpc and /trpc rewrites)
  const trpcHandler = createExpressMiddleware({
    router: appRouter,
    createContext,
  });

  app.use("/api/trpc", trpcHandler);
  app.use("/trpc", trpcHandler);

  return app;
}
