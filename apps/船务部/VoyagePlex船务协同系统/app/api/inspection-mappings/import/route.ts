import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { MappingRecord, writeMappings } from "@/lib/inspection-mapping-store";
import { requireRole } from "@/lib/backend-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const run = promisify(execFile);

export async function POST(request: NextRequest) {
  const auth=await requireRole(request,["admin","shipping"]); if(auth.response)return auth.response;
  let tempDir = "";
  try {
    const form=await request.formData(); const file=form.get("file");
    if (!(file instanceof File)) return NextResponse.json({error:"请选择跟单负责货号Excel"},{status:400});
    if (!/\.xls[xm]$/i.test(file.name)) return NextResponse.json({error:"目前只支持 xlsx、xlsm 文件"},{status:400});
    tempDir=await fs.mkdtemp(path.join(os.tmpdir(),"voyageplex-mapping-"));
    const input=path.join(tempDir,"mapping.xlsx"); await fs.writeFile(input,Buffer.from(await file.arrayBuffer()));
    const script=path.join(process.cwd(),"tools","parse_inspection_mapping_xlsx.py");
    const {stdout}=await run("python3",[script,input],{maxBuffer:20*1024*1024});
    const rows=JSON.parse(stdout) as MappingRecord[];
    if (!rows.length) return NextResponse.json({error:"未识别到验货映射"},{status:400});
    await writeMappings(rows);
    return NextResponse.json({filename:file.name,total:rows.length});
  } catch (error) {
    return NextResponse.json({ error:`导入失败：${error instanceof Error ? error.message : "未知错误"}` }, { status:500 });
  } finally {
    if (tempDir) await fs.rm(tempDir,{recursive:true,force:true});
  }
}
