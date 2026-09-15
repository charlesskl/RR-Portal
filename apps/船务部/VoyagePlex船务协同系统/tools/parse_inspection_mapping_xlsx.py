#!/usr/bin/env python3
import json, re, sys, zipfile
import xml.etree.ElementTree as ET

NS = {"m":"http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r":"http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "p":"http://schemas.openxmlformats.org/package/2006/relationships"}

def text(value):
    if value is None: return ""
    value = str(value).strip()
    return value[:-2] if re.fullmatch(r"-?\d+\.0", value) else value

def load_book(path):
    with zipfile.ZipFile(path) as archive:
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(t.text or "" for t in item.findall(".//m:t", NS)) for item in root.findall("m:si", NS)]
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {item.attrib["Id"]:item.attrib["Target"] for item in rels.findall("p:Relationship", NS)}
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        result = []
        for sheet in workbook.findall("m:sheets/m:sheet", NS):
            target = targets[sheet.attrib[f"{{{NS['r']}}}id"]].lstrip("/")
            filename = target if target.startswith("xl/") else "xl/" + target
            root = ET.fromstring(archive.read(filename))
            cells = {}; max_row = max_col = 0
            for cell in root.findall(".//m:sheetData/m:row/m:c", NS):
                address = cell.attrib.get("r", "A1")
                letters, number = re.match(r"([A-Z]+)(\d+)", address).groups()
                col = 0
                for char in letters: col = col * 26 + ord(char) - 64
                row = int(number); max_row=max(max_row,row); max_col=max(max_col,col)
                kind = cell.attrib.get("t")
                node = cell.find("m:v", NS)
                value = node.text if node is not None else ""
                if kind == "s" and value: value = shared[int(value)]
                elif kind == "inlineStr": value = "".join(t.text or "" for t in cell.findall(".//m:t", NS))
                cells[(row-1,col-1)] = text(value)
            rows = [[cells.get((r,c),"") for c in range(min(max_col,20))] for r in range(max_row)]
            result.append((sheet.attrib["name"].strip(), rows))
        return result

def item(group, source, customer, code, name="", owner="", place="", note="", excluded=False):
    code=text(code).replace("\n","")
    reserved={"货号","产品货号","序号","合计","半成品","ZURU","MOOSE","CEPIA","LIFELINES","TIGERHEAD","TOMY","ZANAOON"}
    if not code or code.upper() in reserved: return None
    return {"id":0,"groupName":group,"inspectionSource":source,"isExcluded":excluded,
            "customer":text(customer),"productCode":code,"productName":text(name),
            "owner":text(owner),"productionPlace":text(place),"note":text(note)}

def val(row, index): return row[index] if index < len(row) else ""

def parse(path):
    output=[]
    for title, rows in load_book(path):
        if title.startswith("兴信B车间"):
            for start in (0,4,8,12,16):
                customer=val(rows[0],start) if rows else ""
                for row in rows[2:]:
                    x=item("兴信B车间","兴信验货总结表",customer,val(row,start),val(row,start+1),"龙丽娟","兴信B车间")
                    if x: output.append(x)
        elif title.startswith("兴信A车间石玉珍"):
            customer=""
            for row in rows[1:]:
                customer=val(row,0) or customer; raw=val(row,1); parts=raw.split("/",1)
                x=item("兴信A车间 · 石玉珍","兴信验货总结表",customer,parts[0],parts[1] if len(parts)>1 else "","石玉珍","兴信A车间")
                if x: output.append(x)
        elif title.startswith("兴信A车间李诗妍"):
            customer=""
            for row in rows[2:]:
                customer=val(row,1) or customer
                x=item("兴信A车间 · 李诗妍","兴信验货总结表",customer,val(row,2),"","李诗妍",val(row,3) or "兴信A车间")
                if x: output.append(x)
        elif "华嘉负责货号" in title:
            customer=""
            for row in rows[2:]:
                customer=val(row,1) or customer
                x=item("华嘉","兴信验货总结表",customer,val(row,2),"","华嘉",val(row,3),"兴信表")
                if x: output.append(x)
        elif title.startswith("湖南钟雅娴"):
            customer=""; place=""
            for row in rows[1:]:
                place=val(row,1) or place or "湖南"; customer=val(row,2) or customer
                x=item("湖南 · 钟雅娴","湖南验货总结表",customer,val(row,3),val(row,4),val(row,7) or val(row,6) or "钟雅娴",place)
                if x: output.append(x)
        elif title.startswith("湖南砚秋") or title.startswith("湖南Evol"):
            owner="吕宇祥" if "吕宇祥" in title else "杨海彬"; group="湖南 · "+owner
            for start in (0,4,8,12,16):
                customer=val(rows[0],start) if rows else ""
                for row in rows[2:]:
                    x=item(group,"湖南验货总结表",customer,val(row,start),val(row,start+1),owner,"湖南")
                    if x: output.append(x)
        elif title.startswith("河源"):
            for row in rows:
                x=item("河源","不参与验货检查","ZURU",val(row,0),val(row,1),val(row,2),"河源","自行做柜",True)
                if x: output.append(x)
        elif title.startswith("华登"):
            customer=val(rows[0],0) if rows else "ZURU"; owners={"东莞华登":"王远露","湖南华登":val(rows[2],5) if len(rows)>2 else ""}
            for row in rows[2:]:
                place=val(row,2); x=item("华登","华登验货总结表",customer,val(row,0),val(row,1),owners.get(place,""),place)
                if x: output.append(x)
    unique={}
    for row in output: unique[(row["groupName"],row["productCode"])]=row
    rows=list(unique.values())
    for index,row in enumerate(rows,1): row["id"]=index
    return rows

if __name__ == "__main__":
    print(json.dumps(parse(sys.argv[1]),ensure_ascii=False))
