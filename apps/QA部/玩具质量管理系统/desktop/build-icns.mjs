import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [iconsetDirectory, outputFile] = process.argv.slice(2);
if (!iconsetDirectory || !outputFile) throw new Error("用法：node build-icns.mjs <iconset目录> <输出.icns>");

const entries = [
  ["icp4", "icon_16x16.png"],
  ["icp5", "icon_32x32.png"],
  ["icp6", "icon_32x32@2x.png"],
  ["ic07", "icon_128x128.png"],
  ["ic08", "icon_256x256.png"],
  ["ic09", "icon_512x512.png"],
  ["ic10", "icon_512x512@2x.png"],
].map(([type,file])=>{
  const image=readFileSync(join(iconsetDirectory,file));
  const header=Buffer.alloc(8);
  header.write(type,0,"ascii");
  header.writeUInt32BE(image.length+8,4);
  return Buffer.concat([header,image]);
});

const body=Buffer.concat(entries);
const header=Buffer.alloc(8);
header.write("icns",0,"ascii");
header.writeUInt32BE(body.length+8,4);
writeFileSync(outputFile,Buffer.concat([header,body]));
