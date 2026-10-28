import { expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

it("renames every old standard line even when a canonical line precedes it, preserving other factories and resources", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sprayplan-line-rename-"));
  const url = `file:${path.join(directory, "fixture.db")}`;
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    await db.$executeRawUnsafe(`CREATE TABLE production_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, workshop TEXT,
      factoryId TEXT NOT NULL DEFAULT 'XINGXIN', leaderName TEXT,
      craftType TEXT NOT NULL, dailyCapacityLimit INTEGER NOT NULL DEFAULT 0,
      isActive BOOLEAN NOT NULL DEFAULT 1
    )`);
    const fixtures = [
      ["B拉：自动喷", "自动喷", "XINGXIN"],
      ["A拉：自动喷", "自动喷", "XINGXIN"],
      ["A拉：手喷", "手喷", "XINGXIN"],
      ["B拉：手喷", "手喷", "XINGXIN"],
      ["A拉", "自动喷", "XINGXIN"],
      ["B拉", "手喷", "XINGXIN"],
      ["A拉：自动喷", "自动喷", "HUADENG"],
      ["B拉：手喷", "手喷", "HUADENG"],
      ["A拉：自动喷（自定义）", "自动喷", "XINGXIN"],
      ["A拉：自动喷", "手喷", "XINGXIN"],
    ];
    await db.productionLine.createMany({ data: fixtures.map(([name, craftType, factoryId], i) => ({
      id: i + 1, name, craftType, factoryId, workshop: "Fixture workshop",
      leaderName: `Fixture ${i}`, dailyCapacityLimit: 1234 + i, isActive: i % 2 === 0,
    })) });
    const before = await db.productionLine.findMany({ orderBy: { id: "asc" } });
    const app = fileURLToPath(new URL("../../../", import.meta.url));
    const cli = createRequire(import.meta.url).resolve("tsx/cli");
    const rename = () => execFileSync(process.execPath, [cli, path.join(app, "prisma/rename-lines.ts")], {
      cwd: app, env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", timeout: 5000,
    });
    rename();
    const after = await db.productionLine.findMany({ orderBy: { id: "asc" } });
    expect(after).toEqual(before.map((line, i) => i < 6 ? {
      ...line, name: line.craftType === "手喷" ? "A拉：手喷" : "B拉：自动喷", workshop: "兴信A",
    } : line));
    rename();
    expect(await db.productionLine.findMany({ orderBy: { id: "asc" } })).toEqual(after);
  } finally {
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
}, 10000);
