import base64
from io import BytesIO
import sys

import xlsxwriter


def main():
    vba_bin, output = sys.argv[1], sys.argv[2]
    workbook = xlsxwriter.Workbook(output)
    workbook.add_vba_project(vba_bin)
    sheet = workbook.add_worksheet('MacroSheet')
    sheet.write('A1', '卡车车身')
    sheet.insert_button('B2', {'macro': 'say_hello', 'caption': 'Run macro'})
    sheet.write_row('A4', ['Item', 'Value'])
    sheet.write_column('A5', ['One', 'Two'])
    sheet.write_column('B5', [1, 2])
    png = BytesIO(base64.b64decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwC'
        'AAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    ))
    sheet.insert_image(
        'D2',
        'fixture.png',
        {'image_data': png, 'x_scale': 32, 'y_scale': 32},
    )
    chart = workbook.add_chart({'type': 'column'})
    chart.add_series({
        'categories': '=MacroSheet!$A$5:$A$6',
        'values': '=MacroSheet!$B$5:$B$6',
    })
    sheet.insert_chart('D8', chart)
    workbook.close()


if __name__ == '__main__':
    main()
