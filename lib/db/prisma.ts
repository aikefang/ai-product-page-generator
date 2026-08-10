import { PrismaClient } from "@prisma/client";

import { env } from "@/lib/utils/env";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  return new PrismaClient({
    datasources: {
      db: {
        url: env.DATABASE_URL,
      },
    },
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function hasCurrentRuntimeSchema(client: PrismaClient) {
  const runtimeClient = client as PrismaClient & {
    toolboxGenerationRecord?: unknown;
    _engineConfig?: { inlineSchema?: string };
  };
  const inlineSchema = runtimeClient._engineConfig?.inlineSchema;

  return (
    typeof runtimeClient.toolboxGenerationRecord !== "undefined" ||
    (typeof inlineSchema === "string" && inlineSchema.includes("model ToolboxGenerationRecord"))
  );
}

const shouldRefreshDevClient =
  process.env.NODE_ENV === "development" &&
  globalForPrisma.prisma &&
  !hasCurrentRuntimeSchema(globalForPrisma.prisma);

if (shouldRefreshDevClient) {
  void globalForPrisma.prisma?.$disconnect().catch(() => {
    // 开发热更新时旧 Prisma Client 可能已经断开，忽略即可。
  });
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
