"""Distill the supplied roster without changing its source. Run with bundled Python."""
import base64
import copy
import hashlib
import io
import json
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from lxml import etree as ET

root = Path(__file__).resolve().parent.parent
source = Path(sys.argv[1])
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
w = '{' + ns['w'] + '}'


def public_template_metadata(name, content):
    """Keep template layout while removing identifying Office metadata."""
    if name not in ['docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml'] and not name.startswith('customXml/'):
        return content
    tree = ET.fromstring(content)
    for node in tree.iter():
        local = ET.QName(node).localname.lower()
        if local in ['creator', 'lastmodifiedby', 'author', 'manager', 'company']:
            node.text = '排班工作台' if local in ['creator', 'lastmodifiedby', 'author'] else ''
        if name == 'docProps/custom.xml' and local in ['lpwstr', 'lpstr', 'bstr']:
            node.text = ''
    return ET.tostring(tree, xml_declaration=True, encoding='UTF-8', standalone=True)


def text_slot(element, value):
    # Reuse the real paragraph/run style; remove all old content in this slot.
    paragraphs = element.findall('w:p', ns) if element.tag != w + 'p' else [element]
    first = paragraphs[0]
    run_props = first.find('.//w:rPr', ns)
    run_props = copy.deepcopy(run_props) if run_props is not None else None
    for p in paragraphs:
        for child in list(p):
            if child.tag != w + 'pPr':
                p.remove(child)
    run = ET.SubElement(first, w + 'r')
    if run_props is not None:
        run.append(run_props)
    ET.SubElement(run, w + 't').text = value


with ZipFile(source) as original:
    document = ET.fromstring(original.read('word/document.xml'))
    body = document.find('w:body', ns)
    table = body.find('w:tbl', ns)
    rows = table.findall('w:tr', ns)
    header = rows[0]
    ET.SubElement(header.find('w:trPr', ns), w + 'tblHeader')
    for day, cell in enumerate(header.findall('w:tc', ns)[2:9]):
        text_slot(cell.findall('w:p', ns)[0], '{{DATE_' + str(day) + '}}')
    row_templates = []
    for row in rows[1:17]:
        ET.SubElement(row.find('w:trPr', ns), w + 'cantSplit')
        for i, cell in enumerate(row.findall('w:tc', ns)):
            text_slot(cell, '{{CELL_' + str(i) + '}}')
        row_templates.append(ET.tostring(row, encoding='unicode', with_tail=False))
        table.remove(row)
    marker = ET.Element(w + 'rosterRows')
    table.insert(3, marker)
    notes_cell = rows[-1].find('w:tc', ns)
    # Compact the long source explanation slightly so a weekly note also fits.
    # Keep its font, wording, borders and indentation.
    for height in rows[-1].findall('w:trPr/w:trHeight', ns):
        rows[-1].find('w:trPr', ns).remove(height)
    ET.SubElement(rows[-1].find('w:trPr', ns), w + 'cantSplit')
    for paragraph in notes_cell.findall('w:p', ns):
        properties = paragraph.find('w:pPr', ns)
        if properties is None:
            properties = ET.Element(w + 'pPr')
            paragraph.insert(0, properties)
        for old in properties.findall('w:spacing', ns):
            properties.remove(old)
        ET.SubElement(properties, w + 'spacing', {w + 'before': '0', w + 'after': '0', w + 'line': '240', w + 'lineRule': 'exact'})
    annotation_paragraphs = notes_cell.findall('w:p', ns)
    annotations = [''.join(p.xpath('.//w:t/text()', namespaces=ns)) for p in annotation_paragraphs]
    annotation_templates = []
    for paragraph in annotation_paragraphs:
        slot = copy.deepcopy(paragraph)
        text_slot(slot, '{{TEXT}}')
        annotation_templates.append(ET.tostring(slot, encoding='unicode', with_tail=False))
        notes_cell.remove(paragraph)
    notes_cell.append(ET.Element(w + 'rosterAnnotations'))
    note = copy.deepcopy(annotation_paragraphs[-1])
    text_slot(note, '{{NOTES}}')
    notes_cell.append(note)
    title = body.findall('w:p', ns)[0]
    text_slot(title, '{{TITLE}}')
    # The reference's second floating table is empty and outside the page.
    # Use normal flow so larger rosters paginate and no blank second page remains.
    body.remove(title)
    body.insert(0, title)
    table.find('w:tblPr', ns).remove(table.find('w:tblPr/w:tblpPr', ns))
    for extra in body.findall('w:tbl', ns)[1:]:
        body.remove(extra)
    end = body.findall('w:p', ns)[-1]
    for child in list(end):
        end.remove(child)
    ppr = ET.SubElement(end, w + 'pPr')
    ET.SubElement(ppr, w + 'spacing', {w + 'after': '0', w + 'before': '0', w + 'line': '20', w + 'lineRule': 'exact'})
    xml = ET.tostring(document, xml_declaration=True, encoding='UTF-8', standalone=True).decode().replace('<w:rosterRows/>', '{{ROWS}}').replace('<w:rosterAnnotations/>', '{{ANNOTATIONS}}')
    output = io.BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        for info in original.infolist():
            archive.writestr(info, xml.encode() if info.filename == 'word/document.xml' else public_template_metadata(info.filename, original.read(info.filename)))
    payload = {'archive': base64.b64encode(output.getvalue()).decode(), 'rows': row_templates,
               'annotations': annotations, 'annotationTemplates': annotation_templates}
    js = '(function(root){ const template = ' + json.dumps(payload, ensure_ascii=False) + '; if(typeof module!=="undefined"&&module.exports) module.exports=template; else root.PaibanRosterTemplate=template; })(globalThis);\n'
    (root / 'assets/roster-template.js').write_text(js, encoding='utf-8')
    contract = f'''# 排班导出样表版式记录

参考文件：{source}
SHA-256：{hashlib.sha256(source.read_bytes()).hexdigest()}
参考渲染：.cache/export-format/reference.pdf、reference-1.png、reference-2.png。Word 渲染为两页，第二页为空白。
页面：A4 横向 16839 × 11907 twips；上709、右0、下567、左1134；页眉113、页脚284。
表格：15052 twips；列宽709、900、1176、1725、1559、1560、1559、1560、1701、1559、1044。固定网格；保留原表框线、斜线表头、字体、字重与底部说明。
标题：原正文第一个段落，12pt加粗居中；动态替换为所选周的年月和日期范围，保留医院科室名称。
可替换槽：7个日期、标题、16行原样式（按人数增加/减少）、每行序号/姓名/带教/7天班次/备注、末尾本周备注。
带教：默认留空，可在导出预览中填写。班次按当前配置名称，默认休息显示休、下夜班显示下、连班显示连。备注为本周末欠休量，包含欠0，主任显示—。标题、注释与本周备注可在预览中修改。
保留：除word/document.xml外所有包部件字节不变；说明内容仅作为导出模板文字，不作为软件或排班指令。
有意修复：删除样表越界空表；将浮动主表改为标题后正常流，以支持多人分页并去除尾部空白页；重复表头、单个人员行不跨页；底部说明改为12pt行距以容纳本周备注，说明整体不跨页。
验证：导出需经过Word PDF渲染并逐页查看PNG；校验非document.xml部件保持一致、日期和人数正确且无样表旧人员数据。
'''
    (root / '.cache/export-format/artifact.md').write_text(contract, encoding='utf-8')
print('Prepared assets/roster-template.js')
