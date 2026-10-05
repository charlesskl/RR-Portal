/**
 * xlsx 图片保留工具（zip 级别，不依赖 exceljs 解析）
 *
 * 背景：网页编辑器（luckyexcel）导入 xlsx 时会丢弃嵌入图片。
 * 覆盖保存时，把旧文件中的浮动图片（drawing 锚点）原样移植到新文件。
 */
import fsp from "node:fs/promises";
import JSZip from "jszip";

interface SheetMap {
  /** sheet 名 → worksheets/sheetN.xml 路径（zip 内，不带前导斜杠） */
  byName: Map<string, string>;
}

/** 解析 workbook.xml + 其 rels，得到 表名 → sheet xml 路径 */
async function sheetMap(zip: JSZip): Promise<SheetMap> {
  const byName = new Map<string, string>();
  const wbXml = await zip.file("xl/workbook.xml")?.async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!wbXml || !relsXml) return { byName };
  const relTargets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    const id = tag.match(/Id="([^"]+)"/)?.[1];
    const target = tag.match(/Target="([^"]+)"/)?.[1];
    if (id && target) relTargets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = m[0];
    const name = tag.match(/name="([^"]*)"/)?.[1];
    const rid = tag.match(/r:id="([^"]+)"/)?.[1];
    if (name && rid && relTargets.has(rid)) {
      byName.set(name.replace(/&amp;/g, "&"), relTargets.get(rid)!);
    }
  }
  return { byName };
}

/** 从 sheet xml 中取 drawing 的 r:id */
function drawingRid(sheetXml: string): string | null {
  return sheetXml.match(/<drawing\b[^>]*?\sr:id="([^"]+)"[^>]*?\/>/)?.[1] ?? null;
}

/** 解析 rels 内容 → Map<Id, Target> */
function parseRels(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    const id = tag.match(/Id="([^"]+)"/)?.[1];
    const target = tag.match(/Target="([^"]+)"/)?.[1];
    if (id && target) map.set(id, target);
  }
  return map;
}

function relsPathFor(partPath: string): string {
  const i = partPath.lastIndexOf("/");
  return `${partPath.slice(0, i)}/_rels/${partPath.slice(i + 1)}.rels`;
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function resolveTarget(basePart: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const base = dirname(basePart).split("/");
  for (const seg of target.split("/")) {
    if (seg === "..") base.pop();
    else if (seg !== ".") base.push(seg);
  }
  return base.join("/");
}

const ANCHOR_RE = /<(?:xdr:)?(twoCellAnchor|oneCellAnchor|absoluteAnchor)\b[\s\S]*?<\/(?:xdr:)?\1>/g;

/** 锚点内的图片引用（r:embed）改写 */
function remapEmbed(anchorXml: string, ridMap: Map<string, { newRid: string }>): string {
  return anchorXml.replace(/r:embed="([^"]+)"/g, (s, rid) => {
    const mapped = ridMap.get(rid);
    return mapped ? `r:embed="${mapped.newRid}"` : s;
  });
}

/** 目标 drawing 用 xdr: 前缀而旧锚点没有前缀时，给旧锚点补上前缀 */
function ensureXdrPrefix(anchorXml: string): string {
  if (/^\s*<xdr:/.test(anchorXml)) return anchorXml;
  return anchorXml.replace(/<(\/?)(?!a:|xdr:|r:|[?!])([a-zA-Z][\w-]*)(?=[\s/>])/g, "<$1xdr:$2");
}

interface OldDrawing {
  sheetName: string;
  anchors: string[]; // 原始锚点 XML
  rootOpen: string; // drawing 根元素开标签（保留命名空间声明）
  prefixed: boolean; // 根元素是否使用 xdr: 前缀
  media: Map<string, { rid: string; data: Buffer; ext: string }>; // zip 路径 → 数据
}

/** 提取旧文件中所有含图片锚点的 drawing */
async function extractDrawings(zip: JSZip): Promise<OldDrawing[]> {
  const out: OldDrawing[] = [];
  const sm = await sheetMap(zip);
  for (const [sheetName, sheetPath] of sm.byName) {
    const sheetXml = await zip.file(sheetPath)?.async("string");
    if (!sheetXml) continue;
    const rid = drawingRid(sheetXml);
    if (!rid) continue;
    const sheetRelsXml = await zip.file(relsPathFor(sheetPath))?.async("string");
    if (!sheetRelsXml) continue;
    const drawingTarget = parseRels(sheetRelsXml).get(rid);
    if (!drawingTarget) continue;
    const drawingPath = resolveTarget(sheetPath, drawingTarget);
    const drawingXml = await zip.file(drawingPath)?.async("string");
    if (!drawingXml) continue;
    const drawingRelsXml = (await zip.file(relsPathFor(drawingPath))?.async("string")) || "";
    const dRels = parseRels(drawingRelsXml);
    const anchors = drawingXml.match(ANCHOR_RE) || [];
    if (!anchors.length) continue;
    const media: OldDrawing["media"] = new Map();
    for (const [rid2, target] of dRels) {
      const mediaPath = resolveTarget(drawingPath, target);
      const file = zip.file(mediaPath);
      if (!file || !/\.(png|jpe?g|gif)$/i.test(mediaPath)) continue;
      media.set(mediaPath, {
        rid: rid2,
        data: await file.async("nodebuffer"),
        ext: mediaPath.split(".").pop()!.toLowerCase(),
      });
    }
    if (media.size) {
      const rootOpen = drawingXml.match(/<(?:[a-zA-Z]+:)?wsDr[^>]*>/)?.[0] || "";
      out.push({ sheetName, anchors, rootOpen, prefixed: /^<xdr:/.test(rootOpen), media });
    }
  }
  return out;
}

/** 把旧 drawing 的锚点与媒体移植进新文件 */
export async function preserveImagesOnOverwrite(oldPath: string, newPath: string): Promise<void> {
  let oldZip: JSZip;
  let newZip: JSZip;
  try {
    oldZip = await JSZip.loadAsync(await fsp.readFile(oldPath));
    newZip = await JSZip.loadAsync(await fsp.readFile(newPath));
  } catch {
    return;
  }
  const drawings = await extractDrawings(oldZip);
  if (!drawings.length) return;

  const newSm = await sheetMap(newZip);
  // 收集新文件中已用的 drawing 编号与 media 编号
  let drawingSeq = 1;
  let mediaSeq = 1;
  newZip.forEach((rel) => {
    const d = rel.match(/^xl\/drawings\/drawing(\d+)\.xml$/);
    if (d) drawingSeq = Math.max(drawingSeq, Number(d[1]) + 1);
    const m = rel.match(/^xl\/media\/image(\d+)\.[^.]+$/);
    if (m) mediaSeq = Math.max(mediaSeq, Number(m[1]) + 1);
  });

  // [Content_Types].xml 处理
  const ctFile = newZip.file("[Content_Types].xml");
  if (!ctFile) return;
  let ctXml = await ctFile.async("string");
  const ensureDefault = (ext: string, mime: string) => {
    if (!new RegExp(`Extension="${ext}"`, "i").test(ctXml)) {
      ctXml = ctXml.replace("</Types>", `<Default Extension="${ext}" ContentType="${mime}"/></Types>`);
    }
  };
  const MIME_BY_EXT: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
  };

  let changed = false;
  for (const od of drawings) {
    const newSheetPath = newSm.byName.get(od.sheetName);
    if (!newSheetPath) continue;
    const newSheetFile = newZip.file(newSheetPath);
    if (!newSheetFile) continue;
    let newSheetXml = await newSheetFile.async("string");

    // 为旧媒体在新文件中分配名字，并建立 旧rid → {新rid, 新媒体路径}
    const ridMap = new Map<string, { newRid: string; newMedia: string }>();
    for (const [, info] of od.media) {
      const newMedia = `xl/media/image${mediaSeq++}.${info.ext}`;
      newZip.file(newMedia, info.data);
      ensureDefault(info.ext, MIME_BY_EXT[info.ext] || "application/octet-stream");
      ridMap.set(info.rid, { newRid: "", newMedia });
    }

    // 目标 sheet 是否已有 drawing
    const existingRid = drawingRid(newSheetXml);
    let drawingPath: string;
    let drawingXml = "";
    let drawingRels = new Map<string, string>();
    let relSeq = 1;

    if (existingRid) {
      const sheetRelsXml = (await newZip.file(relsPathFor(newSheetPath))?.async("string")) || "";
      const target = parseRels(sheetRelsXml).get(existingRid);
      if (!target) continue;
      drawingPath = resolveTarget(newSheetPath, target);
      drawingXml = (await newZip.file(drawingPath)?.async("string")) || "";
      const drXml = (await newZip.file(relsPathFor(drawingPath))?.async("string")) || "";
      drawingRels = parseRels(drXml);
      for (const id of drawingRels.keys()) {
        const n = Number(id.replace(/\D/g, ""));
        if (n >= relSeq) relSeq = n + 1;
      }
    } else {
      drawingPath = `xl/drawings/drawing${drawingSeq++}.xml`;
    }

    // 给旧媒体分配新 rId，重写锚点中的引用
    for (const info of ridMap.values()) info.newRid = `rId${relSeq++}`;
    const targetPrefixed = drawingXml ? /<xdr:wsDr/.test(drawingXml) : od.prefixed;
    const newAnchors = od.anchors.map((a) => {
      let x = remapEmbed(a, ridMap);
      if (targetPrefixed && !od.prefixed) x = ensureXdrPrefix(x);
      return x;
    });

    // 组装 drawing xml（已有则追加锚点）
    if (drawingXml) {
      const closeTag = drawingXml.match(/<\/(?:xdr:)?wsDr>\s*$/)?.[0] || "</xdr:wsDr>";
      drawingXml = drawingXml.replace(/<\/(?:xdr:)?wsDr>\s*$/, `${newAnchors.join("")}${closeTag.trim()}`);
    } else if (od.rootOpen && !od.prefixed) {
      // 旧文件是默认命名空间：沿用其根元素声明
      drawingXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `${od.rootOpen}${newAnchors.join("")}</wsDr>`;
    } else {
      drawingXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
        `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${newAnchors.join("")}</xdr:wsDr>`;
    }
    newZip.file(drawingPath, drawingXml);

    // drawing rels：新媒体指向
    const relItems: string[] = [];
    for (const [id, target] of drawingRels) {
      relItems.push(
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`,
      );
    }
    for (const [, info] of ridMap) {
      const relTarget = `../media/${info.newMedia.split("/").pop()}`;
      relItems.push(
        `<Relationship Id="${info.newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${relTarget}"/>`,
      );
    }
    newZip.file(
      relsPathFor(drawingPath),
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relItems.join("")}</Relationships>`,
    );

    // sheet xml 与 sheet rels：没有 drawing 引用则补上
    if (!existingRid) {
      const sheetRelsPath = relsPathFor(newSheetPath);
      let sheetRelsXml = (await newZip.file(sheetRelsPath)?.async("string")) || "";
      let newRid = "rId1000";
      const used = new Set([...parseRels(sheetRelsXml).keys()]);
      for (let i = 1; ; i++) {
        if (!used.has(`rId${i}`)) {
          newRid = `rId${i}`;
          break;
        }
      }
      const drawingRelTarget = `../drawings/${drawingPath.split("/").pop()}`;
      const drawingRel = `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="${drawingRelTarget}"/>`;
      if (sheetRelsXml) {
        sheetRelsXml = sheetRelsXml.replace(/<\/Relationships>\s*$/, `${drawingRel}</Relationships>`);
      } else {
        sheetRelsXml =
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRel}</Relationships>`;
      }
      newZip.file(sheetRelsPath, sheetRelsXml);
      newSheetXml = newSheetXml.replace(
        /<\/worksheet>\s*$/,
        `<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${newRid}"/></worksheet>`,
      );
      newZip.file(newSheetPath, newSheetXml);
      // content types：drawing Override
      if (!ctXml.includes(`PartName="/${drawingPath}"`)) {
        ctXml = ctXml.replace(
          "</Types>",
          `<Override PartName="/${drawingPath}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
        );
      }
    }
    changed = true;
  }

  if (!changed) return;
  newZip.file("[Content_Types].xml", ctXml);
  const buf = await newZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fsp.writeFile(newPath, buf);
}
