"""Build the v4.6 user manual with the configured bundled Python runtime."""
from pathlib import Path
import re
import shutil
from PIL import Image
from docx import Document
from docx.shared import Cm, Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs/使用手册'
IMAGES = OUT / '图片'
IMAGES.mkdir(parents=True, exist_ok=True)
QA = ROOT / '.cache/manual-v4.6'
QA.mkdir(parents=True, exist_ok=True)
for image in QA.glob('[0-9][0-9]-*.png'):
    shutil.copy2(image, IMAGES / image.name)

doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.top_margin = Cm(1.8)
section.bottom_margin = Cm(1.8)
section.left_margin = Cm(2)
section.right_margin = Cm(2)
section.footer_distance = Cm(.8)


def font(style, name, size, bold=False, color='000000'):
    style.font.name = name
    style.font.size = Pt(size)
    style.font.bold = bold
    style.font.color.rgb = RGBColor.from_string(color)
    rpr = style.element.get_or_add_rPr()
    fonts = rpr.find(qn('w:rFonts'))
    if fonts is None:
        fonts = OxmlElement('w:rFonts')
        rpr.insert(0, fonts)
    for attr in ['ascii', 'hAnsi', 'eastAsia', 'cs']:
        fonts.set(qn('w:' + attr), name)
    for attr in ['asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'cstheme']:
        fonts.attrib.pop(qn('w:' + attr), None)
    for border in style.element.findall('.//' + qn('w:pBdr')):
        border.getparent().remove(border)


font(doc.styles['Normal'], '微软雅黑', 11)
normal = doc.styles['Normal'].paragraph_format
normal.line_spacing = Pt(17)
normal.space_after = Pt(5)
normal.widow_control = True
font(doc.styles['Title'], '微软雅黑', 25, True)
font(doc.styles['Heading 1'], '微软雅黑', 18, True)
font(doc.styles['Heading 2'], '微软雅黑', 12.5, True)
font(doc.styles['Caption'], '微软雅黑', 9, False, '52635A')
for style in ['Heading 1', 'Heading 2']:
    doc.styles[style].paragraph_format.keep_with_next = True
    doc.styles[style].paragraph_format.space_before = Pt(9 if style == 'Heading 2' else 0)
    doc.styles[style].paragraph_format.space_after = Pt(6)
doc.styles['Title'].paragraph_format.space_after = Pt(10)

footer = section.footer.paragraphs[0]
doc.styles['Footer'].paragraph_format.tab_stops.clear_all()
footer.paragraph_format.tab_stops.clear_all()
footer.paragraph_format.tab_stops.add_tab_stop(Cm(17.5), 2)
footer.paragraph_format.space_after = Pt(0)
r = footer.add_run('排班工作台 v4.6.0\t')
r.font.name = '微软雅黑'
r.font.size = Pt(8.5)
footer.add_run('第 ')
field = OxmlElement('w:fldSimple')
field.set(qn('w:instr'), 'PAGE')
footer._p.append(field)
footer.add_run(' 页')
for run in footer.runs:
    run.font.size = Pt(8.5)
    run.font.color.rgb = RGBColor.from_string('52635A')

numbering = doc.part.numbering_part.element
abstract = OxmlElement('w:abstractNum')
abstract.set(qn('w:abstractNumId'), '42')
level = OxmlElement('w:lvl')
level.set(qn('w:ilvl'), '0')
for tag, value in [('start', '1'), ('numFmt', 'decimal'), ('lvlText', '%1.'), ('lvlJc', 'left')]:
    node = OxmlElement('w:' + tag)
    node.set(qn('w:val'), value)
    level.append(node)
abstract.append(level)
numbering.append(abstract)
next_number = 100


def new_list():
    global next_number
    next_number += 1
    num = OxmlElement('w:num')
    num.set(qn('w:numId'), str(next_number))
    reference = OxmlElement('w:abstractNumId')
    reference.set(qn('w:val'), '42')
    num.append(reference)
    override = OxmlElement('w:lvlOverride')
    override.set(qn('w:ilvl'), '0')
    restart = OxmlElement('w:startOverride')
    restart.set(qn('w:val'), '1')
    override.append(restart)
    num.append(override)
    numbering.append(num)
    return next_number


def table(rows):
    count = len(rows[0])
    t = doc.add_table(rows=0, cols=count)
    t.autofit = False
    widths = [4.2, 13.39] if count == 2 else [3.3, 11.59, 2.7]
    if count == 3 and rows[0][0] == '期初欠休':
        widths = [2.2, 2.5, 2.5, 10.39]
    if count == 4:
        widths = [2.1, 2.5, 2.5, 10.49]
    if rows[0][0] == '文件':
        widths = [3.0, 5.4, 9.19]
    for i, width in enumerate(widths):
        t.columns[i].width = Cm(width)
    for row_index, values in enumerate(rows):
        cells = t.add_row().cells
        trpr = t.rows[-1]._tr.get_or_add_trPr()
        trpr.append(OxmlElement('w:cantSplit'))
        if row_index == 0:
            trpr.append(OxmlElement('w:tblHeader'))
        for i, value in enumerate(values):
            cell = cells[i]
            cell.width = Cm(widths[i])
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.space_before = Pt(1)
            p.paragraph_format.line_spacing = Pt(13.2)
            run = p.add_run(value)
            run.font.size = Pt(10)
            run.bold = row_index == 0
            properties = cell._tc.get_or_add_tcPr()
            margins = OxmlElement('w:tcMar')
            for edge in ['top', 'bottom', 'left', 'right']:
                node = OxmlElement('w:' + edge)
                node.set(qn('w:w'), '20' if edge in ['top', 'bottom'] else '100')
                node.set(qn('w:type'), 'dxa')
                margins.append(node)
            properties.append(margins)
            if row_index == 0:
                shading = OxmlElement('w:shd')
                shading.set(qn('w:fill'), 'EEF2EF')
                properties.append(shading)
    borders = OxmlElement('w:tblBorders')
    for edge in ['top', 'bottom', 'left', 'right', 'insideH', 'insideV']:
        node = OxmlElement('w:' + edge)
        node.set(qn('w:val'), 'single')
        node.set(qn('w:sz'), '4')
        node.set(qn('w:color'), 'CBD3CE')
        borders.append(node)
    t._tbl.tblPr.append(borders)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


lines = (OUT / '手册内容.md').read_text(encoding='utf-8').splitlines()
first_heading = True
current_list = None
pending_break = False
i = 0
while i < len(lines):
    line = lines[i].strip()
    i += 1
    if not line:
        continue
    if line == '<!-- page -->':
        pending_break = True
        current_list = None
        continue
    if line.startswith('# '):
        title = line[2:]
        p = doc.add_paragraph(title, 'Title' if first_heading else 'Heading 1')
        if pending_break:
            p.paragraph_format.page_break_before = True
            pending_break = False
        if not first_heading:
            index = int(title.split()[0])
            start = OxmlElement('w:bookmarkStart')
            start.set(qn('w:id'), str(200 + index))
            start.set(qn('w:name'), f'chapter_{index}')
            end = OxmlElement('w:bookmarkEnd')
            end.set(qn('w:id'), str(200 + index))
            p._p.insert(0, start)
            p._p.append(end)
        first_heading = False
        current_list = None
    elif line.startswith('## '):
        doc.add_paragraph(line[3:], 'Heading 2')
        current_list = None
    elif line.startswith('|'):
        rows = [line]
        while i < len(lines) and lines[i].strip().startswith('|'):
            rows.append(lines[i].strip())
            i += 1
        parsed = [[cell.strip() for cell in row.strip('|').split('|')] for row in rows if not re.match(r'^\|\s*[-:]+\s*\|', row)]
        table(parsed)
        current_list = None
    elif line.startswith('!['):
        match = re.match(r'!\[(.*?)\]\((.*?)\)', line)
        caption, relative = match.groups()
        original = Image.open(OUT / relative)
        name = Path(relative).name
        crop_heights = {'01-周排班.png': 800, '02-人员配置.png': 800, '03-职位规则.png': 540, '04-工作量.png': 470, '05-导出预览.png': 830}
        if name in crop_heights:
            original = original.crop((0, 0, original.width, crop_heights[name]))
        target = ROOT / '.cache/manual-v4.6' / ('manual-' + name)
        original.save(target)
        p = doc.add_paragraph()
        p.paragraph_format.keep_with_next = True
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1
        width = 13.0 if name == '04-工作量.png' else 17.59
        p.add_run().add_picture(str(target), width=Cm(width))
        doc.add_paragraph(caption + '  部分可滚动内容未显示', 'Caption')
        current_list = None
    elif re.match(r'^\d+\. ', line):
        if current_list is None:
            current_list = new_list()
        p = doc.add_paragraph(re.sub(r'^\d+\. ', '', line))
        p.paragraph_format.left_indent = Cm(.6)
        p.paragraph_format.first_line_indent = Cm(-.5)
        properties = p._p.get_or_add_pPr()
        numpr = OxmlElement('w:numPr')
        level = OxmlElement('w:ilvl')
        level.set(qn('w:val'), '0')
        num = OxmlElement('w:numId')
        num.set(qn('w:val'), str(current_list))
        numpr.extend([level, num])
        properties.append(numpr)
    else:
        doc.add_paragraph(line)
        current_list = None

doc.core_properties.title = '排班工作台完整使用手册'
doc.core_properties.subject = 'Windows 桌面版 v4.6.0 的安装、排班、欠休、导出与备份操作'
doc.core_properties.author = '排班工作台'
doc.core_properties.last_modified_by = '排班工作台'
doc.core_properties.keywords = '排班 使用手册 v4.6.0'
destination = OUT / '完整使用手册.docx'
doc.save(destination)
print(destination)
