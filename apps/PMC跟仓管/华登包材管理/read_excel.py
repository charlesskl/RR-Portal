# -*- coding: utf-8 -*-
import pandas as pd
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

folder = r'C:\Users\1\OneDrive\Desktop\华登'
files = [
    '富格乐公仔每周统计表(1)(1).xlsx',
    '富格乐交货明细(1).xlsx',
    '富格勒3月计划与交货数汇总表3-9(1).xlsx',
    'ZURU#15780库存表   .xls',
]

for name in files:
    f = os.path.join(folder, name)
    print('=' * 60)
    print('File:', name)
    print('=' * 60)
    try:
        xls = pd.ExcelFile(f)
        for sheet in xls.sheet_names:
            print('Sheet:', sheet)
            df = pd.read_excel(f, sheet_name=sheet, header=None, nrows=12)
            for i, row in df.iterrows():
                vals = []
                for v in row:
                    s = str(v)
                    if s == 'nan':
                        vals.append('')
                    else:
                        vals.append(s)
                print('  Row', i, ':', ' | '.join(vals))
            total = len(pd.read_excel(f, sheet_name=sheet, header=None))
            print('  Total rows:', total)
    except Exception as e:
        print('Error:', e)
    print()
