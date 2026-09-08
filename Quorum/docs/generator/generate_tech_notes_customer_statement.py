#!/usr/bin/env python3
"""
Generates the BB1 Technical Notes document for the Quorum Customer Statement
customisation.

Requirements: python-docx (pip3 install --user python-docx)

Note: this machine has no cairo/Node available, so the ERD and Process Flow
are rendered as BB1-styled tables (relationship table / swimlane table)
instead of SVG->PNG diagrams - the same fallback used by
generate_tech_notes.py (Tenancy Schedule Report) in this same folder. See
the "Publishing to Confluence" fallback pattern in the bb1-tech-notes skill,
which recommends the same approach when image rendering isn't available.

Usage: python3 generate_tech_notes_customer_statement.py
Output: ../BB1_TechNotes_Quorum_CustomerStatement.docx (relative to this file)
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
OUTPUT_PATH = os.path.normpath(os.path.join(HERE, "..", "BB1_TechNotes_Quorum_CustomerStatement.docx"))


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


def set_table_grid(table, col_widths_cm):
    """python-docx's add_table() writes a tblGrid with the columns divided evenly,
    which does not automatically follow later per-cell set_cell_width() calls. Some
    renderers (Google Docs, LibreOffice) lay out columns from tblGrid rather than the
    individual w:tcW on each cell, which would silently undo the custom widths set
    below - so the grid itself must be rewritten to match."""
    tbl = table._tbl
    grid = tbl.find(qn('w:tblGrid'))
    for col in list(grid):
        grid.remove(col)
    for width_cm in col_widths_cm:
        gridCol = OxmlElement('w:gridCol')
        gridCol.set(qn('w:w'), str(int(width_cm * 567)))
        grid.append(gridCol)


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
    set_table_grid(table, col_widths_cm)
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
    add_run(p, "Customer Statement", size=18, bold=True, color=BB1_BLUE)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(40)
    add_run(p, "Author: Jared Espineli   |   Date: 8 September 2026", size=11, color=BB1_GREY)

    doc.add_page_break()

    # ---- 1. Overview ----
    add_heading(doc, "Overview", 1, "1.")

    add_heading(doc, "Introduction", 3, "1.1")
    add_body(doc,
             "The Customer Statement customisation gives Quorum's finance team an on-demand way to produce and "
             "distribute tenant statements straight out of NetSuite. Rather than assembling invoice, payment and "
             "ageing detail by hand for each tenant, a user searches for a customer or a customer category, marks "
             "one or more tenants from the results, and either prints a merged PDF statement or emails each "
             "tenant their own statement - both built in the background so a large batch of tenants doesn't time "
             "out or lock up the browser. Each statement mirrors Quorum's existing tenant statement design: "
             "entity and property detail, itemised activity for the billing month with a running balance, "
             "current-month totals, and an ageing summary.")

    add_heading(doc, "BRS / Specification", 3, "1.2")
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    add_run(p, "Service Request: ", size=10, bold=True)
    add_hyperlink(p, "https://docs.google.com/document/d/1wjI3tsNbXEn9B7uJFitM2yVo1r2yW7CUgs9e5nQ1Odo/edit?tab=t.0",
                  "Customer Statement - Service Request")
    p2 = doc.add_paragraph()
    p2.paragraph_format.space_after = Pt(4)
    add_run(p2, "Related BRS (contract/charge data this report depends on): ", size=10, bold=True)
    add_hyperlink(p2, "https://docs.google.com/document/d/1SAVNacnxpZ0WIQhK6tY6jN8gzMs--dXqyMUz91YDz1s/edit?tab=t.0",
                  "Quorum Contracts")
    p3 = doc.add_paragraph()
    p3.paragraph_format.space_after = Pt(12)
    add_run(p3, "Reference sample statements: ", size=10, bold=True)
    add_hyperlink(p3, "https://drive.google.com/drive/folders/1QzqVvD545gXVDjMuBHe8jF_-75BspUY9?usp=drive_link",
                  "Customer Statements (Drive folder)")

    add_heading(doc, "Development Environment", 3, "1.3")
    add_body(doc, "Quorum Production - NetSuite Account 11536405. This customisation was built and is deployed "
                  "directly in the production account; there is no separate sandbox deployment for it.")

    add_heading(doc, "Business Requirements", 2, "1.4")

    add_heading(doc, "Summary", 3, "1.4.1")
    add_body(doc,
             "Quorum's finance team currently produces tenant statements outside of NetSuite, pulling invoice, "
             "payment and ageing detail together by hand for every tenant each billing cycle. The Customer "
             "Statement customisation moves that process into NetSuite itself: a user searches for the customer "
             "or customer category they want to statement, marks the tenants to include, and generates either a "
             "single merged PDF covering every marked tenant or an individual email to each one, complete with "
             "their own statement PDF attached. Because generation runs as a background job rather than inline "
             "in the browser, the same flow scales from a single tenant to a large batch without failing on load "
             "or execution-time limits. The result is a faster, more consistent statement run each month, with "
             "the underlying data - invoices, credits, payments, deposits and refunds - always drawn live from "
             "NetSuite rather than a separate spreadsheet.")

    add_heading(doc, "Finding a customer and starting a statement run", 3, "1.4.2")
    add_body(doc,
             "A statement run starts on the Customer Statement page, a simple search screen offering a Customer "
             "field and a Category field alongside a Search Customer button. A user can search by a single named "
             "customer, or leave Customer blank and choose a Customer Category instead to bring back every "
             "tenant in that category; when both are filled in, the Customer selection takes priority. Clicking "
             "Search Customer carries that selection through to the Generate Statement page, where the matching "
             "tenants are listed ready for selection.")

    add_heading(doc, "Selecting customers for a statement run", 3, "1.4.3")
    add_body(doc,
             "The Generate Statement page lists the matching customers in a paginated Customer List, fifteen "
             "tenants per page, showing each tenant's name, subsidiary, currency and current balance alongside a "
             "selection checkbox. A user can tick individual tenants, or use Select All to mark every tenant "
             "across every page of the current search in one click, and Clear All to start over; a page-range "
             "dropdown above the list moves between pages without losing marks made on other pages, so a tenant "
             "marked on page one stays marked while page three is being reviewed. Before a statement can be "
             "generated or emailed, a Start Date and a Statement Date must both be set, and Roll Prior Charges "
             "into B/f - which folds older charges and payments into a single opening balance rather than "
             "itemising them - defaults to on.")

    add_heading(doc, "Generating the merged statement PDF in the background", 3, "1.4.4")
    add_body(doc,
             "Clicking Generate Statement opens a new browser tab and queues a background job that builds one "
             "statement page per marked tenant, running each tenant's own set of queries independently so a "
             "large selection can't exhaust a single request's execution time. That tab shows a progress bar, "
             "driven by the job's own reported completion, while the job runs; once every page is built, the job "
             "merges them into one PDF - separated by a page break per tenant - and the tab automatically opens "
             "the finished document. If a particular tenant's statement can't be built, that page shows a short "
             "error instead of stopping the whole batch, so the rest of the run still completes.")

    add_heading(doc, "What the statement itself shows", 3, "1.4.5")
    add_body(doc,
             "Each tenant's statement page follows Quorum's existing tenant statement design: the entity name, "
             "VAT and registration numbers, the property and unit, and the tenant's own registration and VAT "
             "numbers, deposit and bank guarantee, printed in a panel alongside the tenant's billing address. "
             "Below that, an activity table lists every invoice line, payment, credit, deposit and refund posted "
             "in the statement period with a running balance, opening with a Balance Brought Forward figure when "
             "Roll Prior Charges is on. A totals block then shows Arrears/Prepaid, the current month's charges "
             "split into Exclusive/Tax/Inclusive, and the overall Amount Due, followed by a Queries panel with "
             "the finance team's contact details and an ageing summary split into Current, 30, 60, 90 and 120+ "
             "day buckets.")

    add_heading(doc, "Balance roll-up and the statement period", 3, "1.4.6")
    add_body(doc,
             "Quorum bills in advance, so a statement dated in a given month is for charges due the following "
             "month; the customisation carries that same one-month offset through every statement it produces. "
             "When Roll Prior Charges into B/f is switched on - the default - invoices and credit memos from "
             "before the billing month, and payments, deposits and refunds from before the previous statement, "
             "are folded into a single Balance Brought Forward figure instead of being listed line by line, "
             "keeping the statement focused on the current period's activity while the ageing summary still "
             "reflects everything still outstanding.")

    add_heading(doc, "Emailing statements to customers", 3, "1.4.7")
    add_body(doc,
             "Email Statement works the same way as generating a PDF, but sends each marked tenant their own "
             "single-page statement by email instead of opening one merged document. Each tenant's statement is "
             "emailed to the address held on their customer record, with a CC address sent alongside it where "
             "one is on file; a tenant with no statement email on file is skipped rather than failing the run, "
             "and any tenant whose email genuinely fails to send is reported separately. The sender shown on "
             "each email is the Customer Statement Author configured against the tenant's own subsidiary, so "
             "different subsidiaries can email statements from different people rather than all sharing one "
             "fixed sender; a tenant whose subsidiary has no author configured is likewise skipped, with the "
             "reason recorded for follow-up. Once every marked tenant has been processed, the same progress tab "
             "shows a summary of how many statements were sent, skipped and failed, so the user knows "
             "immediately whether every tenant received their statement.")

    add_heading(doc, "Scheduled monthly email run", 3, "1.4.8")
    add_body(doc,
             "Alongside the on-demand Email Statement button, the same background job also runs itself "
             "automatically once a month, on the 20th, with no user needing to open the Generate Statement page "
             "at all. Rather than a user-marked subset of tenants, this scheduled run processes every tenant "
             "returned by the same Customer List search the Generate Statement page itself searches from, so "
             "keeping that search's criteria current is what keeps the scheduled run's coverage current. Because "
             "there is no form to read a Start Date and Statement Date from on a scheduled run, the job works "
             "them out itself from the date it fires: the Statement Date is always the 20th of the current "
             "month, and the Start Date is the 1st of the month two months before it - the same one-month-in-"
             "advance billing logic used everywhere else in this customisation then bills that period one month "
             "ahead, exactly as an equivalent manually-entered run would. Roll Prior Charges into B/f still "
             "defaults on. Every other part of the process - the per-tenant statement PDF, the per-subsidiary "
             "sender and Queries panel detail, and the skip/fail handling - works identically whether a run was "
             "triggered by a user or by the schedule.")

    doc.add_page_break()

    # ---- 2. Components ----
    add_heading(doc, "Components", 1, "2.")
    add_body(doc,
             "This customisation introduces no new custom records or custom lists. It reads Quorum's standard "
             "AR transactions (invoices, credit memos, payments, deposits and refunds) via SuiteQL, together "
             "with a handful of custom fields and segments on the Customer, Transaction and Subsidiary records - "
             "most added in an earlier phase of the Quorum implementation and documented below as reference "
             "context, but three Subsidiary fields (Customer Statement Author, Queries Email, Queries Whatsapp "
             "Number - Section 2.2) were added as part of this phase, replacing a single hardcoded sender and "
             "hardcoded Queries panel text with per-subsidiary values. The property/lease hierarchy described in "
             "the Business Requirement (Building, Block, Floor, Unit, Contract, Charges) belongs to the separate "
             "Quorum Contracts customisation; per that document's own assumption, its monthly scripts must run "
             "before this report so the resulting invoice data is in place to statement.")

    add_heading(doc, "Custom Records", 2, "2.1")
    add_body(doc, "No new custom records were created by this customisation.")

    add_heading(doc, "Custom Fields Referenced (pre-existing)", 2, "2.2")
    add_table(doc, ["Field Name", "Field Internal ID", "Applied To", "Type", "Description"], [
        ["Statement Email", "custentity_bb1_statement_email", "Customer", "Free Text",
         "Comma-separated statement recipient address(es), read by Email Statement"],
        ["Statement Email CC", "custentity_bb1_statement_email_cc", "Customer", "Free Text",
         "Comma-separated CC address(es), read by Email Statement"],
        ["Company Registration No.", "custentity_alf_company_reg_num", "Customer", "Free Text",
         "Printed as Recipient Registration No."],
        ["Bank Guarantee", "custentity_bb1_bank_guarantee", "Customer", "Decimal",
         "Printed as Bank Guarantee in the entity panel"],
        ["VAT Reg. Number", "vatregnumber", "Customer (standard)", "Free Text", "Printed as Recipient VAT No."],
        ["Deposit Balance", "depositbalance", "Customer (standard)", "Decimal", "Printed as Deposit"],
        ["Subsidiary", "subsidiary", "Customer (standard)", "List/Record",
         "Fallback source for the statement's subsidiary when the invoice line carries none"],
        ["Subsidiary Legal Name", "custbody_alf_subsidiary_legal_name", "Transaction (Invoice)", "Free Text",
         "Printed as Entity"],
        ["Subsidiary Address", "custbody_alf_subsidiary_address", "Transaction (Invoice)", "Free Text",
         "Entity address - queried, not currently rendered on the page"],
        ["Currency Symbol", "custbody_alf_currency_symbol", "Transaction (Invoice)", "Free Text",
         "Prefixes the Amount Due figure; defaults to R when blank"],
        ["Payment Reference", "custbody_alf_payment_reference", "Transaction (Invoice)", "Free Text",
         "Queried but not currently printed - the statement's Payment Reference line actually prints the "
         "customer's Entity ID (entityid) instead. Worth confirming with Quorum which value should show."],
        ["Bank Details (to print)", "custbody_alf_bank_det_to_print", "Transaction (Invoice)", "Long Text",
         "Pre-formatted bank detail block printed beside the totals"],
        ["Building", "cseg_bb1_building", "Transaction (Invoice) - Custom Segment", "List/Record",
         "Printed as Property"],
        ["Unit", "cseg_bb1_unit", "Transaction (Invoice) - Custom Segment", "List/Record",
         "Printed as Unit No."],
        ["Federal ID Number", "federalidnumber", "Subsidiary (standard)", "Free Text",
         "Printed as Entity VAT No."],
        ["PeachPayments URL", "custrecord_bb1_peach_payment_url", "Subsidiary", "Free Text",
         "Payment link - href of the clickable Peach Payments logo (see custrecord_bb1_peach_payment_image below)"],
        ["PeachPayments Logo", "custrecord_bb1_peach_payment_image", "Subsidiary", "List/Record (File)",
         "File Cabinet id of the Peach Payments logo image shown beside the Queries panel"],
        ["Customer Statement Author", "custrecord_bb1_cust_statement_author", "Subsidiary", "List/Record (Employee)",
         "Employee that statement emails for this subsidiary's customers are sent as - resolved per customer via "
         "their subsidiary; a customer whose subsidiary has none configured is skipped rather than emailed"],
        ["Queries Email", "custrecord_bb1_queries_email", "Subsidiary", "Free Text",
         "Printed on the statement's Queries panel; blank on the PDF if not configured for that subsidiary"],
        ["Queries Whatsapp Number", "custrecord_bb1_queries_whatsapp", "Subsidiary", "Free Text",
         "Printed as the Whatsapp Nr line on the Queries panel; blank on the PDF if not configured"],
    ], [3.5, 4.6, 4.0, 2.2, 2.7], mono_cols={1},
       note="All of the above were added directly in the NetSuite UI (either during earlier project phases, or "
            "this one for the three Subsidiary fields added 8 September 2026) and are not tracked in this "
            "project's SDF source.")

    add_heading(doc, "Custom Lists", 2, "2.3")
    add_body(doc, "No new custom lists were created by this customisation.")

    add_heading(doc, "Scripts", 2, "2.4")
    add_body(doc, "File cabinet path: SuiteScripts/[QPG] Customer Statement/", size=9, color=BB1_GREY, space_after=10)
    add_table(doc, ["File Name", "Type", "Function", "Deployed To"], [
        ["bb1_qpg_cstmt_cls_sl.js", "su",
         "Suitelet - renders the Customer Statement search form (Customer/Category + Search Customer button)",
         "Standalone - customscript_bb1_qpg_cstmt_cls_sl"],
        ["bb1_qpg_cstmt_cls_cs.js", "cs",
         "Client Script - Search Customer redirects to the Generate Statement Suitelet, carrying the Customer/"
         "Category selection as query params",
         "Attached to the Customer Statement Suitelet form"],
        ["bb1_qpg_cstmt_gts_sl.js", "su",
         "Suitelet - renders the Generate Statement form and Customer List, and routes the Print PDF/Email "
         "Statement/status-check/download actions",
         "Standalone - customscript_bb1_qpg_cstmt_gts_sl"],
        ["bb1_qpg_cstmt_gts_cs.js", "cs",
         "Client Script - required-field/selection validation, pagination, Select All/Clear All, and opening "
         "the Generate/Email Statement progress tab",
         "Attached to the Generate Statement Suitelet form"],
        ["bb1_qpg_cstmt_gts_mr.js", "mr",
         "Map/Reduce - builds one statement page per marked customer in the background, merges them into one "
         "PDF, and reports the result via N/cache for the progress page to poll",
         "customscript_bb1_qpg_cstmt_gts_mr (queued via N/task, not directly deployed to a record)"],
        ["bb1_qpg_cstmt_gts_email_mr.js", "mr",
         "Map/Reduce - emails each marked (or, on the Scheduled deployment, every) customer their own single-"
         "page statement PDF in the background, tallying a sent/skipped/failed summary via N/cache",
         "customscript_bb1_qpg_cstmt_gts_email_mr - two deployments: an on-demand one queued via N/task from "
         "the Suitelet, and customdeploy_bb1_qpg_cstmt_gts_email_mrs, Scheduled, firing on the 20th of each "
         "month"],
    ], [4.7, 1.0, 7.5, 3.8], mono_cols={0},
       note="Deployment note: the two Map/Reduce scripts' Script and Script Deployment records - and their "
            "Free-Form Text parameters - must be created manually in the NetSuite UI; this project's SDF source "
            "does not track Script/ScriptDeployment objects. See Section 3.2.")

    add_heading(doc, "Other Files", 2, "2.5")
    add_body(doc, "Supporting library modules used by the scripts above - not separate deployed scripts in "
                  "their own right.", size=9, color=BB1_GREY, space_after=10)
    add_table(doc, ["File Name", "Function"], [
        ["bb1_qpg_cstmt_cls_form_lib.js", "Builds the Customer Statement Suitelet form (Customer/Category "
                                           "fields, Search Customer button)"],
        ["bb1_qpg_cstmt_cls_lib_helper.js", "Shared field ids and the redirect-URL builder used by the "
                                             "Customer Statement Suitelet and its Client Script"],
        ["bb1_qpg_cstmt_gts_form_lib.js", "Builds the Generate Statement Suitelet form: date/roll-up fields, "
                                           "buttons, and the paginated Customer List sublist"],
        ["bb1_qpg_cstmt_gts_lib_helper.js", "Shared field ids, request-param helpers, cross-page selection "
                                             "tracking, and the Script/Script Parameter ids for both Map/Reduce "
                                             "jobs - used across every gts_* script"],
        ["bb1_qpg_cstmt_gts_task_lib.js", "Queues the Map/Reduce jobs via N/task, builds the progress page "
                                           "shown while a job runs, and polls its status via N/cache/"
                                           "task.checkStatus()"],
        ["bb1_qpg_cstmt_gts_pdf_lib.js", "Queries the statement data set via SuiteQL (header, AR activity, "
                                          "invoice lines, ageing) and renders the statement PDF via N/render"],
        ["bb1_qpg_cstmt_gts_email_lib.js", "Resolves the sender, parses the recipient/CC address fields, "
                                            "builds the subject/body, and sends the statement email"],
    ], [5.5, 11.5], mono_cols={0})

    add_heading(doc, "Entity Relationship Diagram", 2, "2.6")
    add_body(doc, "Represented as a relationship table below (no image-rendering environment was available when "
                   "this document was generated).", size=8, italic=True, color=BB1_GREY, space_after=10)
    add_table(doc, ["From", "Link Field", "To"], [
        ["Transaction (Invoice/Credit/Payment/Deposit/Refund)", "entity", "Customer"],
        ["Transaction", "cseg_bb1_building", "Property (Building segment)"],
        ["Transaction", "cseg_bb1_unit", "Unit (segment)"],
        ["TransactionLine / TransactionAccountingLine", "transaction / account (AcctRec)", "Transaction / Account"],
        ["TransactionLine (invoice)", "item", "Item (statement Allocation column)"],
        ["CustomerAddressbook / CustomerAddressbookEntityAddress", "entity / addressbookaddress",
         "Customer (billing address)"],
        ["Customer", "subsidiary (fallback)", "Subsidiary"],
        ["Subsidiary", "federalidnumber, custrecord_bb1_peach_payment_url", "Entity VAT No. / payment link"],
        ["Subsidiary", "custrecord_bb1_cust_statement_author", "Employee (per-customer Email Statement sender)"],
        ["Subsidiary", "custrecord_bb1_queries_email, custrecord_bb1_queries_whatsapp", "Statement Queries panel"],
        ["Customer", "custentity_bb1_statement_email, _email_cc", "Email Statement recipients"],
        ["gts_mr / gts_email_mr (Map/Reduce)", "N/cache bb1_qpg_cstmt_gts_status, keyed by Run ID",
         "Progress page polling (gts_task_lib.js) - blank on the Scheduled deployment, which has no page polling"],
        ["Customer List saved search", "custscript_bb1_qpg_cstmt_cust_list_sea (Company Preference)",
         "Generate Statement Suitelet's Customer List, and gts_email_mr's Scheduled deployment customer source"],
    ], [7.5, 5.0, 4.5], mono_cols={1})

    add_heading(doc, "Additional Components", 2, "2.7")
    add_table(doc, ["Item", "Detail"], [
        ["Customer List saved search",
         "A saved Customer search, its internal id set as the custscript_bb1_qpg_cstmt_cust_list_sea parameter. "
         "This is now a Company Preference (Store Value) rather than a plain per-deployment Script Parameter, "
         "specifically so both the Generate Statement Suitelet (which filters it further by the Customer/"
         "Category selection carried over from the search page) and gts_email_mr's Scheduled deployment (which "
         "has no deployment of its own to hold the parameter) can read the same value"],
        ["Temp PDF output folder", "File Cabinet folder id 1649 - where gts_mr.js saves the merged statement "
                                    "PDF temporarily; gts_sl.js streams and deletes it immediately after"],
        ["Statement email sender", "Resolved per customer from the Customer Statement Author field on their "
                                    "subsidiary (custrecord_bb1_cust_statement_author, Section 2.2), rather than "
                                    "one fixed employee sending every statement email"],
        ["Scheduled Email Statement deployment", "customdeploy_bb1_qpg_cstmt_gts_email_mrs on "
                                    "customscript_bb1_qpg_cstmt_gts_email_mr, recurring on the 20th of each "
                                    "month. Its CUSTOMER_IDS/START_DATE/STATEMENT_DATE/RUN_ID parameters are all "
                                    "left blank: CUSTOMER_IDS blank falls back to every customer in the Customer "
                                    "List search above; the dates default to Statement Date = the 20th of the "
                                    "current month and Start Date = the 1st of the month two months before (see "
                                    "getDefaultPeriodDates() in gts_pdf_lib.js); and a blank RUN_ID simply skips "
                                    "the N/cache status write, since no progress page is polling for one. Because "
                                    "a blank RUN_ID alone can't prove a log entry came from a genuine scheduled "
                                    "firing rather than someone testing that deployment via Deploy Script, "
                                    "summarize() also logs runtime.getCurrentScript().deploymentId alongside it"],
        ["N/cache usage", "Both Map/Reduce jobs write their result (a file id, a send summary, or an error) to "
                           "the bb1_qpg_cstmt_gts_status cache, keyed by a self-generated Run ID - the only "
                           "channel back to the progress page, since a Map/Reduce job has no live HTTP "
                           "connection to push a result through. Not used by the Scheduled deployment"],
        ["Statement design source", "Layout matches the reference sample \"Tenant Statements - Commercial.pdf\" "
                                     "(linked in Section 1.2) up to the ageing strip; everything the reference "
                                     "sample prints after that is dropped in favour of a plain page-number footer, "
                                     "per spec. Note the reference samples show an Ozow payment link, while the "
                                     "implemented PDF renders a Peach Payments logo/URL sourced from the "
                                     "Subsidiary record - confirm with Quorum which payment provider is current "
                                     "before go-live"],
    ], [5.0, 12.0])

    add_heading(doc, "Process Flow", 2, "2.8")
    add_body(doc, "Represented as swimlane-style tables below (no image-rendering environment was available "
                   "when this document was generated).", size=8, italic=True, color=BB1_GREY, space_after=10)

    add_body(doc, "Flow 1 - Search and Generate Statement (Print PDF)", size=11, italic=False, color=BB1_BLUE,
              space_after=4)
    add_table(doc, ["Actor", "Step", "Produces"], [
        ["User", "Opens the Customer Statement Suitelet URL",
         "cls_sl renders the Customer/Category search form"],
        ["User", "Selects a Customer or Category, clicks Search Customer",
         "cls_cs.searchCustomer redirects to the Generate Statement Suitelet, carrying the Customer/Category "
         "selection as query params"],
        ["Suitelet (gts_sl)", "Receives the redirect with no action param",
         "Renders the Generate Statement form: Start Date/Statement Date/Roll Prior Charges fields plus a "
         "paginated Customer List sublist, loaded from the saved search and filtered by Customer/Category"],
        ["User", "Marks one or more customers (checkboxes or Select All), sets Start/Statement Date, clicks "
                  "Generate Statement",
         "gts_cs.generateStatement validates the required fields and that at least one customer is marked, "
         "then opens a new tab to the Print PDF action"],
        ["Suitelet (gts_sl)", "Receives the Print PDF action",
         "task_lib.submitGenerateStatementTask queues gts_mr.js via N/task, returns a self-generated Run ID + "
         "the real NetSuite task id, and renders a progress page"],
        ["MR Job (gts_mr)", "getInputData / map / summarize",
         "One page built per marked customer (pdf_lib.buildCustomerPageXml, querying AR activity via SuiteQL); "
         "summarize merges every page into one PDF, saves it as a temp file, and writes the file id (or an "
         "error) to N/cache keyed by Run ID"],
        ["Progress page", "Polls the status-check action every 4 seconds",
         "Updates a progress bar (from task.checkStatus()'s per-stage percentage) until N/cache reports ready"],
        ["Suitelet (gts_sl)", "Download PDF action, once ready",
         "Streams the merged temp PDF inline to the same browser tab, then deletes the temp file"],
    ], [3.2, 6.8, 7.0])

    add_body(doc, "Flow 2 - Email Statement (on demand)", size=11, italic=False, color=BB1_BLUE, space_after=4)
    add_table(doc, ["Actor", "Step", "Produces"], [
        ["User", "Marks one or more customers, sets Start/Statement Date, clicks Email Statement",
         "gts_cs.emailStatement runs the same required-field/selection validation as Generate Statement, then "
         "opens a new tab to the Email Statement action"],
        ["Suitelet (gts_sl)", "Receives the Email Statement action",
         "task_lib.submitEmailStatementTask queues gts_email_mr.js via N/task with the marked customer ids and "
         "typed dates, and renders a progress page"],
        ["MR Job (gts_email_mr)", "map (per marked customer)",
         "Builds that customer's own single-page statement PDF (resolving their subsidiary's Customer Statement "
         "Author, Queries Email and Queries Whatsapp along the way), looks up custentity_bb1_statement_email/"
         "_cc, and sends via N/email.send - skipped (with a logged reason) if no recipient email or no "
         "subsidiary author is on file, failed and logged otherwise"],
        ["MR Job (gts_email_mr)", "summarize",
         "Tallies every per-customer result into a sent/skipped/failed summary, written to N/cache keyed by "
         "Run ID, and logs it alongside runtime.getCurrentScript().deploymentId"],
        ["Progress page", "Polls the status-check action, same as Flow 1",
         "Once ready, shows the send summary (X sent, Y skipped, Z failed) directly - no download step, since "
         "nothing is streamed back"],
    ], [3.2, 6.8, 7.0])

    add_body(doc, "Flow 3 - Email Statement (scheduled monthly run)", size=11, italic=False, color=BB1_BLUE,
              space_after=4)
    add_table(doc, ["Actor", "Step", "Produces"], [
        ["NetSuite scheduler", "Fires customdeploy_bb1_qpg_cstmt_gts_email_mrs on its recurrence - the 20th of "
                               "each month - with no user action",
         "gts_email_mr.js starts with CUSTOMER_IDS/START_DATE/STATEMENT_DATE/RUN_ID all blank on this deployment"],
        ["MR Job (gts_email_mr)", "getInputData",
         "CUSTOMER_IDS is blank, so getCustomerListSearchIds() loads the Customer List saved search off the "
         "custscript_bb1_qpg_cstmt_cust_list_sea Company Preference and returns every matching customer id, "
         "paged in 1000-row chunks"],
        ["MR Job (gts_email_mr)", "map (per customer in the search)",
         "getFilters() falls back to pdf_lib.getDefaultPeriodDates() since START_DATE/STATEMENT_DATE are blank "
         "(Statement Date = the 20th of the current month, Start Date = the 1st of the month two months "
         "before); otherwise identical to Flow 2's map step - same PDF build, same per-subsidiary author/"
         "Queries resolution, same skip/fail handling"],
        ["MR Job (gts_email_mr)", "summarize",
         "Same sent/skipped/failed tally as Flow 2, but RUN_ID is blank so the N/cache status write is skipped "
         "(nothing is polling for one) - the summary is still logged, tagged with this deployment's id"],
    ], [3.2, 6.8, 7.0])

    doc.add_page_break()

    # ---- 3. Testing & Setup ----
    add_heading(doc, "Testing & Setup", 1, "3.")

    add_heading(doc, "Testing Details", 2, "3.1")
    add_body(doc,
              "To be completed by the tester following execution of BB1 QA testing / UAT for this "
              "customisation. Record each test case, the steps taken, the expected and actual results, and its "
              "pass/fail status below.",
              italic=True, color=BB1_GREY, space_after=10)
    add_table(doc, ["Test Area", "Test Case", "Steps", "Expected Result", "Actual Result", "Status"], [
        ["", "", "", "", "", ""],
        ["", "", "", "", "", ""],
        ["", "", "", "", "", ""],
        ["", "", "", "", "", ""],
        ["", "", "", "", "", ""],
    ], [2.3, 2.7, 4.0, 3.5, 3.0, 1.5],
       note="Suggested Test Areas to cover: Customer Statement search (Customer/Category); Generate Statement "
            "selection & pagination (marking, Select All/Clear All, page navigation); required-field validation; "
            "Generate Statement PDF output (layout, roll-up on/off, ageing, multi-customer merge); Email "
            "Statement (sent/skipped/failed, recipient/CC handling); background job behaviour on a large "
            "selection.")

    add_heading(doc, "Deployment & Configuration Setup", 2, "3.2")
    add_body(doc,
              "This customisation creates no new custom records, fields or lists, but several deployment-time "
              "configuration steps are required and are not captured in this project's SDF source - see the "
              "deployment notes on the Scripts table in Section 2.4.",
              space_after=8)
    add_numbered_list(doc, [
        "Deploy the Customer Statement Suitelet (bb1_qpg_cstmt_cls_sl.js) as customscript_bb1_qpg_cstmt_cls_sl, "
        "deployment id customdeploy_bb1_qpg_cstmt_cls_sl.",
        "Deploy the Generate Statement Suitelet (bb1_qpg_cstmt_gts_sl.js) as customscript_bb1_qpg_cstmt_gts_sl, "
        "deployment id customdeploy_bb1_qpg_cstmt_gts_sl, and add the custscript_bb1_qpg_cstmt_cust_list_sea "
        "Script Parameter holding the internal id of the saved Customer List search.",
        "Manually create a Map/Reduce Script record and deployment for bb1_qpg_cstmt_gts_mr.js as "
        "customscript_bb1_qpg_cstmt_gts_mr, with Free-Form Text Parameters: "
        "custscript_bb1_qpg_cstmt_mr_run_id, custscript_bb1_qpg_cstmt_mr_customer_ids, "
        "custscript_bb1_qpg_cstmt_mr_start_date, custscript_bb1_qpg_cstmt_mr_stmnt_date, and "
        "custscript_bb1_qpg_cstmt_mr_rollup.",
        "Manually create a Map/Reduce Script record and an on-demand deployment for bb1_qpg_cstmt_gts_email_mr.js "
        "as customscript_bb1_qpg_cstmt_gts_email_mr, with Free-Form Text Parameters: "
        "custscript_bb1_qpg_cstmt_eml_run_id, custscript_bb1_qpg_cstmt_eml_cust_ids, "
        "custscript_bb1_qpg_cstmt_eml_start_date, custscript_bb1_qpg_cstmt_eml_stmnt_date, and "
        "custscript_bb1_qpg_cstmt_eml_rollup. There is no AUTHOR_ID parameter - the sender is resolved per "
        "customer from their subsidiary (see the Customer Statement Author field below).",
        "Add a second deployment on the same script, customdeploy_bb1_qpg_cstmt_gts_email_mrs, type Scheduled, "
        "recurring on the 20th of each month. Leave every one of its Free-Form Text Parameters blank - a blank "
        "custscript_bb1_qpg_cstmt_eml_cust_ids falls back to the full Customer List search, and blank dates fall "
        "back to the computed defaults (see Section 2.7).",
        "On the Customer List saved search's Script Parameter, custscript_bb1_qpg_cstmt_cust_list_sea, check "
        "Store Value so it becomes a Company Preference readable by both the Suitelet and the Scheduled Map/"
        "Reduce deployment, then set its value (Setup > Company > General Preferences) to the saved search's "
        "internal id.",
        "Confirm File Cabinet folder id 1649 exists and is writable (the temporary merged-PDF output folder for "
        "Generate Statement); update OUTPUT_FOLDER_ID in bb1_qpg_cstmt_gts_mr.js if a different folder should "
        "be used.",
        "Add Customer Statement Author, Queries Email and Queries Whatsapp Number (custrecord_bb1_cust_"
        "statement_author, custrecord_bb1_queries_email, custrecord_bb1_queries_whatsapp - Section 2.2) to every "
        "Subsidiary that will send statement emails, especially before relying on the scheduled monthly run: a "
        "subsidiary with no Customer Statement Author configured causes every one of its customers to be "
        "silently skipped rather than emailed.",
        "Confirm custentity_bb1_statement_email and custentity_bb1_statement_email_cc exist on the Customer "
        "record, and populate them for every customer who should receive statements by email.",
        "Confirm the pre-existing fields listed in Section 2.2 (Customer, Transaction body and Subsidiary "
        "fields/segments) already exist and are populated - these were added in earlier Quorum implementation "
        "phases, not by this customisation.",
        "Confirm the Quorum Contracts monthly scripts (see the BRS assumption in Section 1.2) have already run "
        "for the relevant period before generating statements, since the invoice data statemented here depends "
        "on them.",
        "Known issue (fixed 8 September 2026): a join added to the Customer List saved search to reach the "
        "three new Subsidiary fields above was one-to-many (a customer can sit under more than one subsidiary), "
        "which broke Customer List pagination on its last page. gts_form_lib.js's row rendering is now guarded "
        "against it, but the recommended fix is still to keep those three fields off the Customer List search "
        "entirely - gts_pdf_lib.js already reads them directly from the Subsidiary record via SuiteQL, so the "
        "search never needed the join.",
        "Known gap: the statement's \"Entity Reg. No.\" line has no field bound to it yet - bb1_qpg_cstmt_gts_"
        "pdf_lib.js leaves entity_reg_no blank pending confirmation of which Subsidiary-level field should supply "
        "it (distinct from Entity VAT No. and Recipient Registration No., which are already wired up). Confirm "
        "the source field with Quorum before go-live.",
        "Confirm with Quorum whether the statement's payment link/logo should point to Peach Payments (as "
        "currently implemented, sourced from custrecord_bb1_peach_payment_url/_image on the Subsidiary) or Ozow "
        "(as shown in the reference sample statements in Section 2.7) - the two providers differ.",
    ])

    doc.save(OUTPUT_PATH)
    print(f"Written: {OUTPUT_PATH}")


if __name__ == "__main__":
    build()
