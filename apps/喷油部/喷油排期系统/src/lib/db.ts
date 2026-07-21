// Prisma 客户端单例（singleton）
// 目的：在 Next.js 开发模式下避免热重载（HMR）反复 new PrismaClient 导致数据库连接泄漏。
// 模式：把实例挂到 globalThis 上，开发环境复用；生产环境则只 new 一次（无 HMR）。
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
