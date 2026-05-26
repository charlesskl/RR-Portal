export default function SheetImages({ sheet }) {
  if (!sheet) return null;
  const groups = sheet.imageGroups || [];
  const orphan = sheet.orphanImages || [];
  if (groups.length === 0 && orphan.length === 0) return null;
  return (
    <div className="image-section">
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
          <div className="image-group-title">其他附图（{orphan.length} 张，未关联到不合格行）</div>
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
