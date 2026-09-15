import fs from "node:fs/promises";
import path from "node:path";

export type MappingRecord = {
  id:number; groupName:string; inspectionSource:string; isExcluded:boolean;
  customer:string; productCode:string; productName:string; owner:string;
  productionPlace:string; note:string;
};

const dataPath = path.join(process.cwd(), "data", "inspection-mappings.json");

export async function readMappings(): Promise<MappingRecord[]> {
  try { return JSON.parse(await fs.readFile(dataPath, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function writeMappings(rows: MappingRecord[]) {
  await fs.mkdir(path.dirname(dataPath), { recursive:true });
  await fs.writeFile(dataPath, JSON.stringify(rows, null, 2), "utf8");
}
