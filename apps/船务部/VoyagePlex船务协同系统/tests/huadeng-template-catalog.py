"""Regression: migrate a populated legacy catalog without deleting history or touching Xingxin."""
from pathlib import Path
import re
import sqlite3
import unittest

class CatalogTests(unittest.TestCase):
    def test_legacy_catalog_reduces_to_three_types_per_purpose(self):
        source=Path('server/VoyagePlex.Api/Services/ExportTemplateEndpoints.cs').read_text()
        block=source.split('// 华登仅保留',1)[1].split('public static async',1)[0]
        sql=re.search(r'ExecuteSqlRaw\("""(.*?)"""\)',block,re.S).group(1)
        db=sqlite3.connect(':memory:')
        db.execute('CREATE TABLE ExportTemplates(Id INTEGER PRIMARY KEY, Company TEXT, Name TEXT, ShipmentMode TEXT, Purpose TEXT, LayoutKey TEXT, WeightRule TEXT, IsEnabled INTEGER, IsDefault INTEGER)')
        db.execute('CREATE UNIQUE INDEX defaults ON ExportTemplates(Company,ShipmentMode,Purpose) WHERE IsDefault=1')
        db.execute("INSERT INTO ExportTemplates VALUES(1,'Xingxin','兴信原表','Container','Shipping','Standard','Template',1,1)")
        for purpose in ['Shipping','Warehouse']:
            for mode in ['Container','Warehouse']:
                for layout,rule in [('Standard','DisplayInteger'),('Standard','Truncate'),('CustomerItem','DisplayInteger'),('CartonMarks','DisplayInteger')]:
                    db.execute('INSERT INTO ExportTemplates(Company,Name,ShipmentMode,Purpose,LayoutKey,WeightRule,IsEnabled,IsDefault) VALUES(?,?,?,?,?,?,1,?)',('Huadeng','旧表',mode,purpose,layout,rule,int(rule=='Truncate')))
            db.execute("INSERT INTO ExportTemplates(Company,Name,ShipmentMode,Purpose,LayoutKey,WeightRule,IsEnabled,IsDefault) VALUES('Huadeng','旧SKY','Container',?,'SkyCastle','Template',1,0)",(purpose,))
        before=db.execute('SELECT * FROM ExportTemplates WHERE Company="Xingxin"').fetchall()
        count=db.execute('SELECT COUNT(*) FROM ExportTemplates').fetchone()
        for _ in range(2):
            db.executescript(sql)
            for purpose in ['Shipping','Warehouse']:
                active=db.execute('SELECT Name,LayoutKey,WeightRule FROM ExportTemplates WHERE Company="Huadeng" AND Purpose=? AND IsEnabled=1',(purpose,)).fetchall()
                self.assertEqual(set(active),{('普通走柜表','Standard','DisplayInteger'),('普通交仓表','Standard','DisplayInteger'),('SKY分柜特殊表','SkyCastle','Template')})
                self.assertEqual(db.execute('SELECT COUNT(*) FROM ExportTemplates WHERE Company="Huadeng" AND Purpose=? AND IsDefault=1',(purpose,)).fetchone()[0],2)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM ExportTemplates').fetchone(),count)
            self.assertEqual(db.execute('SELECT * FROM ExportTemplates WHERE Company="Xingxin"').fetchall(),before)

if __name__=='__main__': unittest.main()
