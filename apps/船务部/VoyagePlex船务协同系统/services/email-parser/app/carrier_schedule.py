"""Read carrier tables by column, without mixing dates or unrelated SO rows."""
import re
from html.parser import HTMLParser
from .rules import normalize_deadline


class ScheduleTables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self.stack = []
        self.cell = None
        self.row = None
        self.spans = {}
        self.row_index = -1
        self.cell_span = (1, 1)

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.stack.append([])
            self.spans = {}
            self.row_index = -1
        elif tag == "tr":
            self.row = []
            self.row_index += 1
        elif tag in ("td", "th"):
            self.cell = []
            attributes = dict(attrs)
            try:
                self.cell_span = (max(1, min(100, int(attributes.get("rowspan", 1)))), max(1, min(100, int(attributes.get("colspan", 1)))))
            except ValueError:
                self.cell_span = (1, 1)
        elif tag == "br" and self.cell is not None:
            self.cell.append(" ")

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            if self.row is not None:
                while len(self.row) in self.spans and self.spans[len(self.row)][0] > self.row_index:
                    self.row.append(self.spans[len(self.row)][1])
                value = re.sub(r"\s+", " ", "".join(self.cell)).strip()
                rowspan, colspan = self.cell_span
                for _ in range(colspan):
                    column = len(self.row)
                    self.row.append(value)
                    if rowspan > 1:
                        self.spans[column] = (self.row_index + rowspan, value)
            self.cell = None
        elif tag == "tr" and self.row is not None:
            while len(self.row) in self.spans and self.spans[len(self.row)][0] > self.row_index:
                self.row.append(self.spans[len(self.row)][1])
            if self.stack:
                self.stack[-1].append(self.row)
            self.row = None
        elif tag == "table" and self.stack:
            self.tables.append(self.stack.pop())


def carrier_tables(message) -> list:
    parser = ScheduleTables()
    for part in message.walk():
        if part.get_content_type() == "text/html" and not part.get_filename():
            parser.feed(str(part.get_content()))
    return parser.tables


def apply_carrier_schedule(fields: dict, tables: list) -> None:
    primary = fields.get("so_number", "")
    for table in tables:
        for index, header in enumerate(table):
            keys = [re.sub(r"[^a-z]", "", value.lower()) for value in header]
            if "carrierso" not in keys or "so" not in keys:
                continue
            for row in table[index + 1:]:
                if len(row) != len(keys):
                    continue
                values = dict(zip(keys, row))
                if values.get("so") != primary:
                    continue
                carrier = values.get("carrierso", "")
                if re.fullmatch(r"[A-Za-z0-9-]{6,}", carrier):
                    fields["so_number"] = ",".join(dict.fromkeys([primary, carrier]))
                for column, target in (("sicutoffday", "si_deadline"), ("vouchercutoff", "cutoff_date")):
                    date = normalize_deadline(values.get(column, ""))
                    if date:
                        fields[target] = date
                return
