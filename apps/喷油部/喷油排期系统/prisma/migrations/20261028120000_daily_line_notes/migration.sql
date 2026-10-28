CREATE TABLE IF NOT EXISTS daily_line_notes (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  factoryId TEXT NOT NULL DEFAULT 'XINGXIN', lineId INTEGER NOT NULL,
  noteDate BIGINT NOT NULL, text TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0,
  updatedAt BIGINT NOT NULL, updatedBy TEXT NOT NULL,
  FOREIGN KEY (lineId) REFERENCES production_lines(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_line_notes_factoryId_lineId_noteDate_key
  ON daily_line_notes(factoryId, lineId, noteDate);
