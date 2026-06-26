// 把 orphan 中"在第一个不合格行之前"的图片视为样板图（兼容旧数据：后端未返回 sampleImages 时本地推断）
function deriveBuckets(sheet) {
  const groups = sheet.imageGroups || [];
  const orphan = sheet.orphanImages || [];
  if (Array.isArray(sheet.sampleImages)) {
    return { samples: sheet.sampleImages, groups, orphan };
  }
  const firstFail = (sheet.failRows && sheet.failRows[0])
    ? sheet.failRows[0].rowNumber
    : Infinity;
  const samples = orphan.filter(img => img.fromRow < firstFail);
  const realOrphan = orphan.filter(img => img.fromRow >= firstFail);
  return { samples, groups, orphan: realOrphan };
}

export default function SheetImages({ sheet }) {
  if (!sheet) return null;
  const { samples, groups, orphan } = deriveBuckets(sheet);
  if (samples.length === 0 && groups.length === 0 && orphan.length === 0) return null;
  return (
    <div className="image-section">
      {samples.length > 0 && (
        <div className="image-group sample-group">
          <div className="image-group-title">样板图（{samples.length} 张）</div>
          <ImageGrid images={samples} />
        </div>
      )}
      {groups.map((g, gi) => (
        <div key={gi} className="image-group">
          <div className="image-group-title">
            不合格行 {g.rows.join('、')} 关联图片（{g.images.length} 张）
          </div>
          <ImageGrid images={g.images} />
        </div>
      ))}
      {orphan.length > 0 && (
        <div className="image-group">
          <div className="image-group-title">其他附图（{orphan.length} 张，位置不在任何不合格行附近）</div>
          <ImageGrid images={orphan} />
        </div>
      )}
    </div>
  );
}

function ImageGrid({ images }) {
  return (
    <div className="image-grid">
      {images.map((img, i) => (
        <a key={i} href={img.url} target="_blank" rel="noreferrer" title={`Excel 第 ${img.fromRow}-${img.toRow} 行`}>
          <img src={img.url} alt={`row ${img.fromRow}`} loading="lazy" />
        </a>
      ))}
    </div>
  );
}
