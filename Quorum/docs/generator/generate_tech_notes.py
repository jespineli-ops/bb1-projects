#!/usr/bin/env python3
"""
Generates the BB1 Technical Notes document for the Quorum Tenancy Schedule
Report customisation.

Requirements: python-docx (pip3 install --user python-docx)

Note: this machine has no cairo/Node available, so the ERD and Process Flow
are rendered as BB1-styled tables (relationship table / swimlane table)
instead of SVG->PNG diagrams - see the "Publishing to Confluence" fallback
pattern in the bb1-tech-notes skill, which recommends the same approach when
image rendering isn't available.

Usage: python3 generate_tech_notes.py
Output: ../BB1_TechNotes_Quorum_TenancySchedule.docx (relative to this file)
"""

import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# ---------------------------------------------------------------------------
# Brand constants
# ---------------------------------------------------------------------------
BB1_BLUE = RGBColor(0x24, 0x78, 0xAA)
BB1_RED = RGBColor(0xC0, 0x28, 0x2E)
BB1_GREY = RGBColor(0x9B, 0x96, 0x92)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
BLACK = RGBColor(0x00, 0x00, 0x00)
CODE_GREY = RGBColor(0x44, 0x44, 0x44)

BB1_BLUE_HEX = "2478AA"
GREY_LIGHT_HEX = "F5F5F5"
WHITE_HEX = "FFFFFF"
BORDER_HEX = "CCCCCC"

FONT = "Roboto"
MONO_FONT = "Courier New"

CONTENT_WIDTH_CM = 17.0  # A4 (21cm) minus 2cm margins each side
ZWSP = "​"

HERE = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.normpath(os.path.join(HERE, "..", "BB1_TechNotes_Quorum_TenancySchedule.docx"))


# ---------------------------------------------------------------------------
# Low-level oxml helpers (python-docx has no first-class API for cell
# shading, custom borders, or forced column widths)
# ---------------------------------------------------------------------------

def set_cell_background(cell, hex_color):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    tcPr.append(shd)


def set_cell_borders(cell, hex_color=BORDER_HEX, sz=4):
    tcPr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement('w:tcBorders')
    for edge in ('top', 'left', 'bottom', 'right'):
        el = OxmlElement(f'w:{edge}')
        el.set(qn('w:val'), 'single')
        el.set(qn('w:sz'), str(sz))
        el.set(qn('w:space'), '0')
        el.set(qn('w:color'), hex_color)
        borders.append(el)
    tcPr.append(borders)


def set_cell_width(cell, width_cm):
    cell.width = Cm(width_cm)
    tcPr = cell._tc.get_or_add_tcPr()
    tcW = OxmlElement('w:tcW')
    tcW.set(qn('w:w'), str(int(width_cm * 567)))  # 1cm = 567 twips
    tcW.set(qn('w:type'), 'dxa')
    tcPr.append(tcW)


def set_table_fixed_layout(table, total_width_cm):
    tbl = table._tbl
    tblPr = tbl.tblPr
    layout = OxmlElement('w:tblLayout')
    layout.set(qn('w:type'), 'fixed')
    tblPr.append(layout)
    tblW = OxmlElement('w:tblW')
    tblW.set(qn('w:w'), str(int(total_width_cm * 567)))
    tblW.set(qn('w:type'), 'dxa')
    tblPr.append(tblW)


def set_cell_margins(cell, top=40, bottom=40, left=100, right=100):
    tcPr = cell._tc.get_or_add_tcPr()
    mar = OxmlElement('w:tcMar')
    for edge, val in (('top', top), ('bottom', bottom), ('left', left), ('right', right)):
        node = OxmlElement(f'w:{edge}')
        node.set(qn('w:w'), str(val))
        node.set(qn('w:type'), 'dxa')
        mar.append(node)
    tcPr.append(mar)


def soft_break(text):
    """Zero-width space after every '_' and '.' in long tokens (>=15 chars),
    so Word can wrap long NetSuite internal ids inside a narrow table cell."""
    text = str(text)
    parts = text.split(' ')
    out = []
    for part in parts:
        if len(part) >= 15:
            part = part.replace('_', '_' + ZWSP).replace('.', '.' + ZWSP)
        out.append(part)
    return ' '.join(out)


# ---------------------------------------------------------------------------
# Content helpers
# ---------------------------------------------------------------------------

def set_default_font(doc):
    style = doc.styles['Normal']
    style.font.name = FONT
    style.font.size = Pt(10)
    rpr = style.element.get_or_add_rPr()
    rFonts = rpr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = OxmlElement('w:rFonts')
        rpr.append(rFonts)
    rFonts.set(qn('w:ascii'), FONT)
    rFonts.set(qn('w:hAnsi'), FONT)
    rFonts.set(qn('w:cs'), FONT)


def set_margins(doc):
    section = doc.sections[0]
    section.page_height = Cm(29.7)
    section.page_width = Cm(21.0)
    section.top_margin = Cm(2)
    section.bottom_margin = Cm(2)
    section.left_margin = Cm(2)
    section.right_margin = Cm(2)


def add_run(paragraph, text, size=10, bold=False, italic=False, color=BLACK, font=FONT):
    run = paragraph.add_run(text)
    run.font.name = font
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    return run


def add_heading(doc, text, level, number=None):
    """level: 1=H1, 2=H2 (red), 3=H3"""
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14 if level == 1 else 10)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.outline_level = level - 1
    label = f"{number} {text}" if number else text
    size = {1: 16, 2: 14, 3: 13}[level]
    color = BB1_RED if level == 2 else BB1_BLUE
    add_run(p, label, size=size, bold=True, color=color)
    return p


def add_body(doc, text, size=10, italic=False, color=BLACK, space_after=8):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(space_after)
    add_run(p, text, size=size, italic=italic, color=color)
    return p


def add_hyperlink(paragraph, url, text, color=BB1_BLUE):
    part = paragraph.part
    r_id = part.relate_to(url, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
                           is_external=True)
    hyperlink = OxmlElement('w:hyperlink')
    hyperlink.set(qn('r:id'), r_id)
    new_run = OxmlElement('w:r')
    rPr = OxmlElement('w:rPr')
    rFonts = OxmlElement('w:rFonts')
    rFonts.set(qn('w:ascii'), FONT)
    rFonts.set(qn('w:hAnsi'), FONT)
    rPr.append(rFonts)
    color_el = OxmlElement('w:color')
    color_el.set(qn('w:val'), '2478AA')
    rPr.append(color_el)
    u = OxmlElement('w:u')
    u.set(qn('w:val'), 'single')
    rPr.append(u)
    sz = OxmlElement('w:sz')
    sz.set(qn('w:val'), '20')
    rPr.append(sz)
    new_run.append(rPr)
    t = OxmlElement('w:t')
    t.text = text
    new_run.append(t)
    hyperlink.append(new_run)
    paragraph._p.append(hyperlink)


def add_table(doc, headers, rows, col_widths_cm, mono_cols=None, note=None):
    """headers: list[str]; rows: list[list[str]]; col_widths_cm sums to CONTENT_WIDTH_CM."""
    mono_cols = mono_cols or set()
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    set_table_fixed_layout(table, sum(col_widths_cm))
    table.autofit = False

    # header row
    hdr = table.rows[0].cells
    for i, h in enumerate(headers):
        set_cell_width(hdr[i], col_widths_cm[i])
        set_cell_background(hdr[i], BB1_BLUE_HEX)
        set_cell_borders(hdr[i])
        set_cell_margins(hdr[i])
        hdr[i].paragraphs[0].text = ''
        add_run(hdr[i].paragraphs[0], h, size=11, bold=True, color=WHITE)

    for r_idx, row in enumerate(rows):
        cells = table.add_row().cells
        fill = WHITE_HEX if r_idx % 2 == 0 else GREY_LIGHT_HEX
        for c_idx, value in enumerate(row):
            cell = cells[c_idx]
            set_cell_width(cell, col_widths_cm[c_idx])
            set_cell_background(cell, fill)
            set_cell_borders(cell)
            set_cell_margins(cell)
            cell.paragraphs[0].text = ''
            values = value if isinstance(value, list) else [value]
            for v_idx, v in enumerate(values):
                p = cell.paragraphs[0] if v_idx == 0 else cell.add_paragraph()
                is_mono = c_idx in mono_cols
                display = soft_break(v) if is_mono else str(v)
                add_run(p, display, size=9 if is_mono else 10,
                        color=CODE_GREY if is_mono else BLACK,
                        font=MONO_FONT if is_mono else FONT)

    if note:
        add_body(doc, note, size=8, italic=True, color=BB1_GREY, space_after=14)
    else:
        doc.add_paragraph().paragraph_format.space_after = Pt(10)

    return table


def add_numbered_list(doc, items):
    for item in items:
        p = doc.add_paragraph(style='List Number')
        add_run(p, item, size=10)


# ---------------------------------------------------------------------------
# Build the document
# ---------------------------------------------------------------------------

def build():
    doc = Document()
    set_default_font(doc)
    set_margins(doc)

    # ---- Cover ----
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(120)
    add_run(p, "BB1", size=48, bold=True, color=BB1_BLUE)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_run(p, "Technical Notes", size=28, bold=True, color=BB1_BLUE)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(40)
    add_run(p, "Quorum", size=22, bold=True, color=BB1_RED)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_run(p, "Tenancy Schedule Report", size=18, bold=True, color=BB1_BLUE)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(40)
    add_run(p, "Author: Jared Espineli   |   Date: 28 August 2026", size=11, color=BB1_GREY)

    doc.add_page_break()

    # ---- 1. Overview ----
    add_heading(doc, "Overview", 1, "1.")

    add_heading(doc, "Introduction", 3, "1.1")
    add_body(doc, "The Tenancy Schedule Report is a self-service reporting page (Suitelet) built for Quorum's "
                  "property team. It lets a user filter down to the buildings, blocks, floors, units and "
                  "accommodation types they want to report on, choose an “As of Date”, and produce either "
                  "a print-ready PDF or a raw CSV export - both built on demand from the tenancy, lease and charge "
                  "data already held in NetSuite.")

    add_heading(doc, "BRS / Specification", 3, "1.2")
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    add_run(p, "Service Request: ", size=10, bold=True)
    add_hyperlink(p, "https://docs.google.com/document/d/1XQSoYuiZzTjcz3nRTd0f7g0d8CN3JeqBQoQykJUlGR4/edit?tab=t.0",
                  "Tenancy Schedule - Service Request")
    p2 = doc.add_paragraph()
    p2.paragraph_format.space_after = Pt(12)
    add_run(p2, "NetSuite Workbook (source query this report is modelled on): ", size=10, bold=True)
    add_hyperlink(p2, "https://11536405.app.netsuite.com/app/common/report/report.nl?workbook=9",
                  "Workbook 9")

    add_heading(doc, "Development Environment", 3, "1.3")
    add_body(doc, "Quorum Production - NetSuite Account 11536405.")

    add_heading(doc, "Business Requirements", 2, "1.4")

    add_heading(doc, "Summary", 3, "1.4.1")
    add_body(doc,
             "Quorum manages a portfolio of residential, student, retail, office and industrial buildings, each "
             "let to tenants under individual lease contracts carrying their own rent and additional charges. "
             "Bringing together who occupies which unit, what they pay, and how a property is performing "
             "previously meant manually assembling that picture from several different records. The Tenancy "
             "Schedule Report gives the property team a single, on-demand report - filterable by portfolio, "
             "building, block, floor, unit and accommodation type, and evaluated as of any chosen date - that "
             "lists every unit's lease, rent and other charges, subtotals by accommodation type, and totals "
             "occupancy and vacancy across the whole property. The same filters drive both a client-ready PDF "
             "and a CSV export for further analysis, so the two outputs never fall out of step with each other.")

    add_heading(doc, "Report access and filtering", 3, "1.4.2")
    add_body(doc,
             "The report opens as a single screen with cascading location filters: choosing one or more "
             "Buildings narrows the Block list to only those under the selected Buildings, choosing a Block "
             "narrows Floor the same way, and choosing a Floor narrows Unit. Property Portfolio and "
             "Accommodation Type are additional filters that can be combined with the location filters to "
             "narrow the result set further. Each filter is optional except for the As of Date, which must be "
             "provided - if a user tries to generate the report without it, the page alerts them and stops "
             "before any PDF or CSV is produced. Leaving every other filter blank simply reports on the whole "
             "portfolio.")

    add_heading(doc, "Report generation - Print PDF and Export CSV", 3, "1.4.3")
    add_body(doc,
             "Two buttons sit above the filters. Print PDF opens a print-ready Tenancy Schedule as an in-browser "
             "PDF, formatted for landscape A4 with the company logo, the report title and the chosen As of Date "
             "in the header. Export CSV instead produces a CSV file - saved into NetSuite's file cabinet and "
             "downloaded to the user's browser - carrying the same filtered dataset in a flatter, one-row-per-unit "
             "shape suited to further analysis in Excel or Google Sheets. Both buttons send the same set of "
             "selected filters and As of Date to the report engine, so a PDF and a CSV produced from the same "
             "filter selection always describe the same set of units.")

    add_heading(doc, "PDF layout: grouping, subtotals and grand totals", 3, "1.4.4")
    add_body(doc,
             "The PDF lists every selected unit's premises, area, tenant, lease dates, rent and other charges, "
             "grouped under its Accommodation Type with a subtotal row ahead of that group's units. A unit with "
             "more than one charge (for example rent plus a fixed refuse or effluent charge) prints one row per "
             "charge, with the unit's own details shown only on its first row so the schedule reads cleanly. "
             "Beneath the grouped detail, the report totals the whole property: a Property Totals row, a Total "
             "Vacancy row and a Total Occupancy row, followed by a boxed Grand Totals block repeating those same "
             "figures in bold for a clear closing summary. Rent Rate, Rate and Gross Rate are all calculated per "
             "unit of area, so they read consistently whether shown against a single unit, an accommodation type "
             "subtotal, or the property-wide total.")

    add_heading(doc, "CSV export: a working dataset per unit", 3, "1.4.5")
    add_body(doc,
             "The CSV export is built from a separate, more detailed query than the PDF and is meant as a working "
             "dataset rather than a formatted document. Each row is one unit, carrying its building address, "
             "tenant contact and address details, occupancy status, bed reference and future-lease flag alongside "
             "the same lease and charge figures shown on the PDF. Where a unit has multiple charge lines, their "
             "amount columns are summed into that single row rather than being listed separately, so every unit "
             "still appears exactly once in the export.")

    add_heading(doc, "As of Date: what counts as occupied on a given day", 3, "1.4.6")
    add_body(doc,
             "Every figure in the report - whether a unit reads as occupied or vacant, and every rent and charge "
             "amount that flows from that - is evaluated as of the date the user chooses, not simply today. A "
             "unit's lease counts as active on that date when its start date has arrived and either it has no end "
             "date or that date falls before the end date; a unit whose lease isn't active on the chosen date "
             "reads as vacant for that run of the report, with its tenant, dates and charge figures left blank. "
             "This lets the property team run the same report for a past or future As of Date and see the "
             "portfolio's occupancy exactly as it stood, or is contracted to stand, on that day.")

    doc.add_page_break()

    # ---- 2. Components ----
    add_heading(doc, "Components", 1, "2.")
    add_body(doc,
             "This customisation is a reporting layer only: it introduces no new custom records, fields or "
             "lists. It reads an existing data model - Building, Block, Floor, Unit, Lease Contract and Utilised "
             "Charges - already built as part of an earlier phase of the Quorum implementation. The records, "
             "fields and lists below are documented as reference context for the SuiteQL queries in Section 2.4, "
             "not as components this customisation created.")

    add_heading(doc, "Custom Records Referenced (pre-existing)", 2, "2.1")

    add_heading(doc, "Building - customrecord_cseg_bb1_building", 3, "")
    add_table(doc, ["Field Name", "Field Internal ID", "Type", "Description"], [
        ["Name", "name", "Free Text", "Building name"],
        ["Property Portfolio", "custrecord_bb1_building_portfolio",
         "List/Record (customlist_bb1_building_prop_portfolio)",
         "Portfolio the building belongs to; source of the report's Portfolio filter"],
    ], [2.5, 5.0, 5.5, 4.0], mono_cols={1})
    add_body(doc,
             "Building is a custom segment filtered by Subsidiary. The CSV export also reads a building's postal "
             "address from its Subsidiary's main address, rather than from a field on the Building record itself.",
             size=8, italic=True, color=BB1_GREY, space_after=14)

    add_heading(doc, "Block - customrecord_cseg_bb1_block", 3, "")
    add_table(doc, ["Field Name", "Field Internal ID", "Type", "Description"], [
        ["Name", "name", "Free Text", "Block name"],
        ["Building (filter)", "cseg_bb1_block_filterby_cseg_bb1_building", "List/Record",
         "Filters Block by Building - cascading filter"],
    ], [2.5, 5.5, 4.0, 5.0], mono_cols={1})

    add_heading(doc, "Floor - customrecord_cseg_bb1_floor", 3, "")
    add_table(doc, ["Field Name", "Field Internal ID", "Type", "Description"], [
        ["Name", "name", "Free Text", "Floor name"],
        ["Block (filter)", "cseg_bb1_floor_filterby_cseg_bb1_block", "List/Record",
         "Filters Floor by Block - cascading filter"],
    ], [2.5, 5.5, 4.0, 5.0], mono_cols={1})

    add_heading(doc, "Unit - customrecord_cseg_bb1_unit", 3, "")
    add_table(doc, ["Field Name", "Field Internal ID", "Type", "Description"], [
        ["Name", "name", "Free Text", "Unit name"],
        ["Floor (filter)", "cseg_bb1_unit_filterby_cseg_bb1_floor", "List/Record",
         "Filters Unit by Floor - cascading filter"],
        ["Unit Counter", "custrecord_bb1_unit_counter", "Integer",
         "Number of units/parking bays this record represents; divides Rent Rate/Rate/Gross Rate"],
        ["Area", "custrecord_bb1_unit_area", "Decimal", "Unit floor area (CSV export only)"],
        ["Status", "custrecord_bb1_unit_status", "List/Record", "Occupied/Vacant status held on the Unit record"],
        ["Accommodation Type", "custrecord_bb1_unit_accommodation_type",
         "List/Record (customlist_bb1_building_accommoda_type)",
         "Drives the report's Accommodation Type grouping and filter"],
        ["Budget Rate", "custrecord_bb1_unit_budget_rate", "Decimal", "Printed as the Budget Rate column"],
    ], [2.5, 5.0, 5.5, 4.0], mono_cols={1})

    add_heading(doc, "Lease Contract - customrecord_bb1_lease_contract", 3, "")
    add_table(doc, ["Field Name", "Field Internal ID", "Type", "Description"], [
        ["Unit", "cseg_bb1_unit", "List/Record", "Links the lease to its Unit"],
        ["Tenant", "custrecord_bb1_lease_tenant", "List/Record (Customer)", "Tenant on the lease"],
        ["Bed", "cseg_bb1_bed", "List/Record", "Bed reference (CSV export only)"],
        ["Start Date", "custrecord_bb1_lease_start_date", "Date", "Lease start; drives the active-lease check"],
        ["End Date", "custrecord_bb1_lease_end_date", "Date", "Lease end; drives the active-lease check"],
        ["Review Date", "custrecord_bb1_lease_review_date", "Date", "Printed as the Review column"],
        ["Option Months", "custrecord_bb1_lease_opt_months", "Integer", "Printed as Months Option"],
        ["Rent Escalation", "custrecord_bb1_lease_rent_escalation", "Percent", "Printed as Rent Esc%"],
        ["Future Lease", "custrecord_bb1_lease_future", "Checkbox", "Flag included in the CSV export only"],
    ], [2.5, 5.5, 4.5, 4.5], mono_cols={1})

    add_heading(doc, "Utilised Charges - customrecord_bb1_utilised_charges", 3, "")
    add_table(doc, ["Field Name", "Field Internal ID", "Type", "Description"], [
        ["Lease", "custrecord_bb1_utilised_lease", "List/Record", "Links the charge line to its Lease Contract"],
        ["Type", "custrecord_bb1_utilised_type", "List/Record",
         "'Rent' rows feed Current Rent; every other value prints as an Other Chargings line"],
        ["Description", "custrecord_bb1_utilised_description", "Free Text",
         "Printed as Description (non-Rent lines only)"],
        ["Rate (ex VAT)", "custrecord_bb1_utilised_rate_ex_vat", "Decimal",
         "Feeds Current Rent (Rent lines) or Amount (non-Rent lines)"],
        ["Rate/Area (ex VAT)", "custrecord_bb1_utilised_rateareaexcl_vat", "Decimal", "CSV export only"],
        ["Amount (incl VAT)", "custrecord_bb1_utilised_amt_inclusiv_vat", "Decimal", "CSV export only"],
    ], [3.0, 5.5, 4.0, 4.5], mono_cols={1})

    add_heading(doc, "Custom Fields", 2, "2.2")
    add_body(doc, "No new custom fields were created by this customisation. Every field referenced by the "
                  "report is documented against its record in Section 2.1 above.")

    add_heading(doc, "Custom Lists Referenced (pre-existing)", 2, "2.3")
    add_table(doc, ["List Name", "List Internal ID", "Function"], [
        ["Property Portfolio", "customlist_bb1_building_prop_portfolio",
         "Values for the Portfolio filter - Residential, Commercial, Student, Body Corporate"],
        ["Accommodation Type", "customlist_bb1_building_accommoda_type",
         "Values for the Accommodation Type filter/grouping - Residential, Student, Retail, Office, Industrial"],
    ], [4.0, 6.0, 7.0], mono_cols={1})

    add_heading(doc, "Scripts", 2, "2.4")
    add_body(doc, "File cabinet path: SuiteScripts/[QPG] Tenancy Schedule/", size=9, color=BB1_GREY, space_after=10)
    add_table(doc, ["File Name", "Type", "Function", "Deployed To"], [
        ["bb1_qpg_tschd_report_sl.js", "su",
         "Suitelet - renders the filter UI, and on request generates the PDF (Print PDF) or CSV (Export CSV)",
         "Standalone - accessed via its own Suitelet URL, no record association"],
        ["bb1_qpg_tschd_report_cs.js", "cs",
         "Client Script - cascading Building/Block/Floor/Unit filters, mandatory As of Date validation with "
         "an on-screen alert, Print PDF/Export CSV button handlers",
         "Attached to the Suitelet form (form.clientScriptModulePath)"],
    ], [4.5, 1.2, 7.8, 3.5], mono_cols={0})

    add_heading(doc, "Other Files", 2, "2.5")
    add_body(doc, "Supporting library modules used by the Suitelet and Client Script above - not separate "
                  "deployed scripts in their own right.", size=9, color=BB1_GREY, space_after=10)
    add_table(doc, ["File Name", "Function"], [
        ["bb1_qpg_tschd_report_form_lib.js", "Builds the Suitelet form - fields, buttons, button styling"],
        ["bb1_qpg_tschd_report_lib_helper.js",
         "Shared field ids, cascading-filter helpers, the Print PDF/Export CSV URL builder, and date/label "
         "formatting used by both the Client Script and the server-side libraries"],
        ["bb1_qpg_tschd_report_data_lib.js",
         "Builds and runs the SuiteQL queries behind the PDF and CSV exports, and shapes the results into "
         "grouped rows with subtotals (PDF) or one row per unit (CSV)"],
        ["bb1_qpg_tschd_report_pdf_lib.js", "Builds the Tenancy Schedule PDF via N/render (Advanced PDF/HTML)"],
        ["bb1_qpg_tschd_report_csv_lib.js", "Builds the CSV file and saves it to the File Cabinet for download"],
    ], [6.0, 11.0], mono_cols={0})

    add_heading(doc, "Entity Relationship Diagram", 2, "2.6")
    add_body(doc, "Represented as a relationship table below (no image-rendering environment was available when "
                   "this document was generated).", size=8, italic=True, color=BB1_GREY, space_after=10)
    add_table(doc, ["From", "Link Field", "To"], [
        ["Block", "cseg_bb1_block_filterby_cseg_bb1_building", "Building"],
        ["Floor", "cseg_bb1_floor_filterby_cseg_bb1_block", "Block"],
        ["Unit", "cseg_bb1_unit_filterby_cseg_bb1_floor", "Floor"],
        ["Unit", "custrecord_bb1_unit_accommodation_type", "Accommodation Type (list)"],
        ["Building", "custrecord_bb1_building_portfolio", "Property Portfolio (list)"],
        ["Lease Contract", "cseg_bb1_unit", "Unit"],
        ["Lease Contract", "custrecord_bb1_lease_tenant", "Customer (Tenant)"],
        ["Utilised Charges", "custrecord_bb1_utilised_lease", "Lease Contract"],
    ], [4.5, 8.0, 4.5], mono_cols={1})

    add_heading(doc, "Additional Components", 2, "2.7")
    add_table(doc, ["Item", "Detail"], [
        ["Source NetSuite Workbook", "Workbook 9 - the query this report's SuiteQL was modelled on. See the "
                                      "link in Section 1.2."],
        ["CSV export destination", "File Cabinet folder ID 1541 - every Export CSV run saves its file here in "
                                    "addition to downloading it to the browser"],
    ], [5.0, 12.0])

    add_heading(doc, "Process Flow", 2, "2.8")
    add_body(doc, "Represented as a swimlane-style table below (no image-rendering environment was available "
                   "when this document was generated).", size=8, italic=True, color=BB1_GREY, space_after=10)
    add_table(doc, ["Actor", "Step", "Produces"], [
        ["User", "Opens the Tenancy Schedule Suitelet URL",
         "Suitelet renders the filter form (bb1_qpg_tschd_report_sl.js -> formLib.buildForm)"],
        ["User", "Selects Property Portfolio / Building / Accommodation Type / Block / Floor / Unit",
         "Client Script cascades Building -> Block -> Floor -> Unit options as each parent changes"],
        ["User", "Sets the As of Date and clicks Print PDF or Export CSV",
         "Client Script alerts and stops if As of Date is blank; otherwise builds the report URL with the "
         "selected filters and opens it"],
        ["Suitelet", "Receives the request with the action parameter",
         "Routes to pdfLib.buildPdf (Print PDF) or csvLib.buildCsv (Export CSV)"],
        ["Data Lib", "Runs the filtered SuiteQL query for the chosen action",
         "Rows grouped by Unit then Accommodation Type (PDF) or per Unit (CSV); As of Date drives each row's "
         "active-lease/vacancy status"],
        ["PDF Lib / CSV Lib", "Formats the query results",
         "Print PDF: inline Advanced PDF opened in a new tab. Export CSV: CSV file saved to File Cabinet folder "
         "1541 and downloaded to the browser"],
    ], [3.0, 6.5, 7.5])

    doc.add_page_break()

    # ---- 3. Testing & Setup ----
    add_heading(doc, "Testing & Setup", 1, "3.")

    add_heading(doc, "Steps to Test / Replicate", 2, "3.1")

    add_body(doc, "Filters and cascading behaviour", size=11, italic=False, color=BB1_BLUE, space_after=4)
    add_numbered_list(doc, [
        "Open the Tenancy Schedule Suitelet. Confirm the page loads with Property Portfolio, Building, "
        "Accommodation Type, Block, Floor, Unit and As of Date filters, and Print PDF/Export CSV buttons.",
        "Select one or more Buildings. Confirm the Block field's available options are limited to blocks "
        "under the selected building(s), and that Floor/Unit are cleared.",
        "Select a Block. Confirm Floor's options narrow to that block, and Unit is cleared.",
        "Select a Floor. Confirm Unit's options narrow to that floor.",
        "Clear the Building selection. Confirm the dependent Block/Floor/Unit selections are cleared.",
    ])

    add_body(doc, "Mandatory As of Date validation", size=11, italic=False, color=BB1_BLUE, space_after=4)
    add_numbered_list(doc, [
        "Leave As of Date blank and click Print PDF. Confirm an alert appears naming As of Date as required, "
        "and that no PDF is opened.",
        "Leave As of Date blank and click Export CSV. Confirm the same alert appears and no CSV is generated.",
        "Enter an As of Date and click Print PDF. Confirm the alert no longer appears and the PDF opens.",
        "Enter an As of Date and click Export CSV. Confirm the alert no longer appears and the CSV downloads.",
    ])

    add_body(doc, "Print PDF output", size=11, italic=False, color=BB1_BLUE, space_after=4)
    add_numbered_list(doc, [
        "Generate the PDF with no filters selected other than As of Date. Confirm it opens as a landscape A4 "
        "document with the company logo, “Tenancy Schedule” title and “as of <date>” in the header, "
        "and a Printed timestamp/page number in the top-right.",
        "Confirm units are grouped under their Accommodation Type, each group preceded by a bold subtotal row, "
        "and that a unit with more than one charge line (e.g. Rent plus a fixed charge) prints one row per "
        "charge with the unit's own details shown only on its first row.",
        "Confirm the report ends with a Property Totals row, a Total Vacancy row, a Total Occupancy row, a "
        "boxed blank divider, then a bold Grand Totals/Total Vacancy/Total Occupancy block and a second boxed "
        "blank divider.",
        "Cross-check a handful of Rent Rate/Rate/Gross Rate values against Current Rent/Amount/Gross Income "
        "divided by the relevant area, for both an individual unit row and the Property Totals row.",
        "Re-run with an As of Date before a known lease's Start Date, and again after its End Date. Confirm "
        "that unit reads as vacant on both runs (blank tenant/dates/charges) and is excluded from Current Rent/"
        "Amount/Gross Income, and re-run with an As of Date inside the lease term to confirm it reads as "
        "occupied.",
        "Apply a Portfolio, Accommodation Type, Building, Block, Floor and Unit filter (each on its own, then "
        "combined) and confirm each PDF only contains units matching the selection.",
        "Run the report against a filter combination with no matching units and confirm the “No records "
        "found” row is shown instead of an empty or broken table.",
    ])

    add_body(doc, "Export CSV output", size=11, italic=False, color=BB1_BLUE, space_after=4)
    add_numbered_list(doc, [
        "Generate the CSV and confirm a file named “Tenancy Schedule <as of date>.csv” downloads, and "
        "that the same file also appears in the File Cabinet under folder ID 1541.",
        "Open the CSV and confirm the title row reads “Tenancy Schedule as of <date> - Printed: "
        "<timestamp>”, followed by a blank row and then the column headers.",
        "Confirm there is exactly one row per unit (not per charge line), that a unit with multiple charge "
        "lines has its amount columns (Rate, Amount, Gross Income, etc.) summed into that single row, and that "
        "amount columns show exactly two decimal places.",
        "Confirm the Occupancy column reads Vacant for any unit whose lease isn't active as of the chosen As "
        "of Date, matching the same active-lease logic verified on the PDF.",
        "Apply the same filter combinations used for the PDF checks above and confirm the CSV returns the "
        "same set of units as the equivalently-filtered PDF.",
    ])

    add_body(doc, "General / regression checks", size=11, italic=False, color=BB1_BLUE, space_after=4)
    add_numbered_list(doc, [
        "Pick a date that displays as day-of-month > 12 (e.g. 26/08/2026) and confirm the report still parses "
        "it as the correct calendar day rather than misreading it as month/day.",
        "Confirm the As of Date shown in the PDF header and CSV title exactly matches the date selected on the "
        "filter screen (no day-shift from timezone handling).",
    ])

    add_heading(doc, "Custom Record Setup", 2, "3.2")
    add_body(doc,
              "This customisation creates no new custom records, fields or lists, so there is no setup to "
              "perform for it specifically. To exercise the tests above, the following pre-existing records "
              "must already hold representative data in the target account:")
    add_numbered_list(doc, [
        "At least one Building, with at least one Block, Floor and Unit beneath it, and a Property Portfolio "
        "value set on the Building.",
        "At least one Unit with an Accommodation Type set, a non-zero Unit Counter, and (for the CSV checks) "
        "an Area and Budget Rate.",
        "At least one Lease Contract linked to a Unit and a Tenant (Customer), with a Start Date, and both "
        "with and without an End Date, to exercise both a fixed-term and an open-ended lease.",
        "At least one Utilised Charges record of type Rent, and at least one of another type (e.g. Fixed), "
        "linked to the same Lease Contract, to exercise the multi-charge-line grouping on both outputs.",
    ])

    doc.save(OUTPUT_PATH)
    print(f"Written: {OUTPUT_PATH}")


if __name__ == "__main__":
    build()
