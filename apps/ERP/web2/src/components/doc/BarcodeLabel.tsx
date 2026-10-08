// 单个条码标签:Code128 条码(SVG 矢量)+ 编号 + 名称。用于打印贴物料。
// 照抄老系统 web/src/components/scan/BarcodeLabel.tsx(纯 SVG 内联样式,打印样式自包含)。
import { useMemo } from "react";
import { encodeCode128B, totalModules } from "@/lib/code128";

export default function BarcodeLabel({
  value,
  title,
  subtitle,
}: {
  value: string;
  title?: string;
  subtitle?: string;
}) {
  const modules = useMemo(() => {
    try {
      return encodeCode128B(value);
    } catch {
      return null;
    }
  }, [value]);

  if (!modules) {
    return (
      <div style={{ color: "#cf1322", fontSize: 12, padding: 8 }}>
        无法生成条码(含中文/非法字符):{value}
      </div>
    );
  }

  const modW = 2; // 每模块像素宽
  const height = 56; // 条码高度
  const quiet = 10; // 两侧留白
  const w = totalModules(modules) * modW + quiet * 2;

  let x = quiet;
  const rects: React.ReactNode[] = [];
  modules.forEach((m, i) => {
    if (m.bar)
      rects.push(<rect key={i} x={x} y={0} width={m.width * modW} height={height} fill="#000" />);
    x += m.width * modW;
  });

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "10px 12px",
        border: "1px dashed #bbb",
        borderRadius: 4,
        background: "#fff",
        pageBreakInside: "avoid",
      }}
    >
      {title && (
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 4,
            maxWidth: w,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
      )}
      <svg width={w} height={height} style={{ display: "block" }}>
        {rects}
      </svg>
      <div
        style={{
          fontFamily: "monospace",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: 1,
          marginTop: 2,
        }}
      >
        {value}
      </div>
      {subtitle && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}
