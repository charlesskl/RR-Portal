const WORKSHOPS = [
  { id: 1, name: '湖南', sort_order: 1, color: '#1677ff' },
  { id: 2, name: '兴信', sort_order: 2, color: '#fa8c16' },
  { id: 3, name: '华登', sort_order: 3, color: '#52c41a' },
];

function seedWorkshops(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO workshops(id, name, sort_order, color) VALUES (?, ?, ?, ?)'
  );
  for (const w of WORKSHOPS) insert.run(w.id, w.name, w.sort_order, w.color);
}

const LINES = [
  { name: '宋沛霖手喷', sort_order: 1 },
  { name: '宋沛霖自动', sort_order: 2 },
  { name: '胡旗移印',   sort_order: 3 },
  { name: 'UV',         sort_order: 4 },
];

const LINE_DEFAULTS = [
  { technique: '喷油',     line_name: null },
  { technique: '移印',     line_name: '胡旗移印' },
  { technique: 'UV',       line_name: 'UV' },
  { technique: '散枪',     line_name: '宋沛霖手喷' },
  { technique: '洗货',     line_name: '宋沛霖手喷' },
  { technique: '洗油',     line_name: '宋沛霖手喷' },
  { technique: '2印',      line_name: '胡旗移印' },
  { technique: '1印',      line_name: '胡旗移印' },
  { technique: '4印',      line_name: '胡旗移印' },
  { technique: '2夹',      line_name: '宋沛霖手喷' },
  { technique: '2边',      line_name: '宋沛霖手喷' },
  { technique: '1边',      line_name: '宋沛霖手喷' },
  { technique: '1夹',      line_name: '宋沛霖手喷' },
  { technique: '自动机',   line_name: '宋沛霖自动' },
];

function seedLines(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO lines(name, sort_order) VALUES (?, ?)');
  for (const l of LINES) insert.run(l.name, l.sort_order);
}

const PER_WORKSHOP_LINES = [
  { name: '手喷', sort_order: 1 },
  { name: '自动', sort_order: 2 },
  { name: '移印', sort_order: 3 },
  { name: 'UV',   sort_order: 4 },
];

function seedLinesPerWorkshop(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO lines(name, sort_order, workshop_id) VALUES (?, ?, ?)'
  );
  for (const wid of [1, 3]) {
    for (const l of PER_WORKSHOP_LINES) insert.run(l.name, l.sort_order, wid);
  }
}

function seedLineDefaultsForWorkshop(db, workshopId) {
  const getLineId = db.prepare('SELECT id FROM lines WHERE workshop_id=? AND name=?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO technique_line_defaults(workshop_id, technique, line_id) VALUES (?, ?, ?)'
  );
  // 名字映射:湖南/华登 (workshop 1/3) 用「手喷/自动/移印」,兴信 (workshop 2) 用「宋沛霖手喷/宋沛霖自动/胡旗移印」
  function mapLineName(originalName, wid) {
    if (wid === 2) return originalName;
    return originalName
      .replace('宋沛霖手喷', '手喷')
      .replace('宋沛霖自动', '自动')
      .replace('胡旗移印', '移印');
  }
  for (const d of LINE_DEFAULTS) {
    const lineName = d.line_name ? mapLineName(d.line_name, workshopId) : null;
    const line = lineName ? getLineId.get(workshopId, lineName) : null;
    insert.run(workshopId, d.technique, line ? line.id : null);
  }
}

function seedLineDefaults(db) {
  for (const wid of [1, 2, 3]) seedLineDefaultsForWorkshop(db, wid);
}

module.exports = { seedLines, seedLineDefaults, seedLineDefaultsForWorkshop, seedWorkshops, seedLinesPerWorkshop, LINES, LINE_DEFAULTS, WORKSHOPS, PER_WORKSHOP_LINES };
