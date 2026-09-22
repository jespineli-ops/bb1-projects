"""
BB1 Technical Notes - diagram generator for the JKRoss SO Pick Ticket customisation.

Renders the ERD and Process Flow as PNGs directly with Pillow (no Node/cairosvg
available on this machine). Re-run after any change to the data model or flow.

Usage: python3 build_diagrams.py
Outputs: assets/erd.png, assets/flow.png (next to this script)
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "assets")
os.makedirs(OUT, exist_ok=True)

BB1_BLUE = (36, 120, 170)
BB1_RED = (192, 40, 46)
BB1_GREY = (155, 150, 146)
BODY_FILL = (245, 245, 245)
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
BORDER = (36, 120, 170)

ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

def font(size, bold=False):
    return ImageFont.truetype(ARIAL_BOLD if bold else ARIAL, size)

F_HDR = font(15, bold=True)
F_FIELD = font(12)
F_TYPE = font(11)
F_LABEL = font(12)
F_TITLE = font(20, bold=True)


def text_w(draw, txt, fnt):
    bbox = draw.textbbox((0, 0), txt, font=fnt)
    return bbox[2] - bbox[0]


# ---------------------------------------------------------------------------
# ERD
# ---------------------------------------------------------------------------

def draw_entity(draw, x, y, w, title, fields, header_fill=BB1_BLUE):
    """fields: list of (internal_id, label, type_badge, marker) marker in {'PK','FK',''}"""
    row_h = 22
    header_h = 32
    h = header_h + row_h * len(fields) + 10
    # outer border
    draw.rectangle([x, y, x + w, y + h], outline=BORDER, width=2, fill=BODY_FILL)
    # header
    draw.rectangle([x, y, x + w, y + header_h], fill=header_fill, outline=BORDER, width=2)
    tw = text_w(draw, title, F_HDR)
    draw.text((x + (w - tw) / 2, y + 8), title, font=F_HDR, fill=WHITE)
    # fields
    fy = y + header_h + 5
    for internal_id, label, badge, marker in fields:
        prefix = "\U0001F511 " if marker == "PK" else ("→ " if marker == "FK" else "")
        draw.text((x + 10, fy), f"{prefix}{internal_id}", font=F_FIELD, fill=BB1_GREY)
        draw.text((x + 10, fy + 14), f"{label}  [{badge}]", font=F_TYPE, fill=BLACK)
        fy += row_h
    return h


def draw_arrow(draw, p1, p2, label=None, dashed=False, color=BB1_RED):
    x1, y1 = p1
    x2, y2 = p2
    if dashed:
        # simple dashed line
        import math
        dist = math.hypot(x2 - x1, y2 - y1)
        steps = max(1, int(dist // 10))
        for i in range(steps):
            if i % 2 == 0:
                sx = x1 + (x2 - x1) * i / steps
                sy = y1 + (y2 - y1) * i / steps
                ex = x1 + (x2 - x1) * (i + 1) / steps
                ey = y1 + (y2 - y1) * (i + 1) / steps
                draw.line([sx, sy, ex, ey], fill=color, width=2)
    else:
        draw.line([x1, y1, x2, y2], fill=color, width=2)
    # arrowhead at p2
    import math
    ang = math.atan2(y2 - y1, x2 - x1)
    ah = 10
    left = (x2 - ah * math.cos(ang - 0.4), y2 - ah * math.sin(ang - 0.4))
    right = (x2 - ah * math.cos(ang + 0.4), y2 - ah * math.sin(ang + 0.4))
    draw.polygon([p2, left, right], fill=color)
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        tw = text_w(draw, label, F_LABEL)
        draw.rectangle([mx - tw / 2 - 4, my - 10, mx + tw / 2 + 4, my + 8], fill=WHITE)
        draw.text((mx - tw / 2, my - 8), label, font=F_LABEL, fill=BB1_GREY)


def build_erd():
    W, H = 1180, 620
    img = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(img)

    so_fields = [
        ("entityid", "Order Number", "Text", "PK"),
        ("orderstatus", "Order Status", "List", ""),
        ("location", "Location", "List/Record", "FK"),
        ("item.quantitycommitted", "Qty Committed (line)", "Number", ""),
    ]
    loc_fields = [
        ("internalid", "Location", "List/Record", "PK"),
        ("_bb1_loc_default_printer", "Default Printer", "List/Record", "FK"),
    ]
    prn_fields = [
        ("internalid", "Printer", "List/Record", "PK"),
        ("_bb1_prn_name", "Printer Name", "Free Text", ""),
        ("_bb1_prn_ip_address", "IP Address", "Free Text", ""),
        ("_bb1_prn_type", "Printer Type (new)", "List", ""),
    ]
    job_fields = [
        ("custrecord_bb1_pj_source_rec", "Source Record", "Record Ref", "FK"),
        ("custrecord_bb1_pj_source_type", "Source Record Type", "Free Text", ""),
        ("custrecord_bb1_pj_doctype", "Document Type", "Free Text", ""),
        ("custrecord_bb1_pj_template", "Template", "Free Text", ""),
        ("custrecord_bb1_pj_printer", "Printer", "List/Record", "FK"),
        ("custrecord_bb1_pj_qty", "Quantity", "Integer", ""),
        ("custrecord_bb1_pj_status", "Status", "List", ""),
    ]

    so_x, so_y = 40, 40
    loc_x, loc_y = 430, 40
    prn_x, prn_y = 830, 40
    job_x, job_y = 430, 300

    so_h = draw_entity(d, so_x, so_y, 340, "Sales Order (standard)", so_fields)
    loc_h = draw_entity(d, loc_x, loc_y, 340, "Location (standard)", loc_fields)
    prn_h = draw_entity(d, prn_x, prn_y, 300, "customrecord_bb1_printer (new)", prn_fields)
    job_h = draw_entity(d, job_x, job_y, 340, "customrecord_bb1_print_job (new)", job_fields)

    # Sales Order -> Location
    draw_arrow(d, (so_x + 340, so_y + 45), (loc_x, loc_y + 45), "location")
    # Location -> Printer
    draw_arrow(d, (loc_x + 340, loc_y + 45), (prn_x, prn_y + 45), "default printer")
    # Sales Order -> Print Job (source_rec, polymorphic)
    draw_arrow(d, (so_x + 170, so_y + so_h), (job_x + 170, job_y), "source_rec (polymorphic)")
    # Print Job -> Printer
    draw_arrow(d, (job_x + 340, job_y + 45), (prn_x, prn_y + prn_h - 20), "printer")

    d.text((40, H - 30), "BB1 Technical Notes - ERD - J&K Ross SO Pick Ticket (Gap 9)",
           font=F_LABEL, fill=BB1_GREY)

    img.save(os.path.join(OUT, "erd.png"))
    print("wrote", os.path.join(OUT, "erd.png"), img.size)


# ---------------------------------------------------------------------------
# Process flow (vertical swimlanes: one column per actor, steps flow downward)
# ---------------------------------------------------------------------------

LANES = [
    ("User / Browser", BB1_BLUE),
    ("SuiteFlow Workflow", BB1_BLUE),
    ("WFA Script / Suitelet", (42, 122, 42)),
    ("QZ Tray / Printer", BB1_RED),
]

STEPS = [
    # (lane_index, row, text, shape)
    (0, 0, "User saves Sales Order\n(Pending Fulfillment,\nqty committed > 0)", "start"),
    (1, 1, "Condition:\nstatus = Pending Fulfillment\nAND MAX(qty committed) > 0", "decision"),
    (2, 2, "bb1_jkr_prnt_doc_wfa.js\ncreates customrecord_\nbb1_print_job (PENDING)", "script"),
    (0, 3, "Browser redirected to\nSO view page\n(pageInit fires)", "process"),
    (0, 4, "bb1_print_bridge_cs.js\ncalls Suitelet with\nrecord id + type", "process"),
    (2, 5, "bb1_print_bridge_sl.js\nrenders PDF (N/render),\nbase64-encodes, marks SENT", "script"),
    (0, 6, "Client script connects to\nlocal QZ Tray via\nqz-tray.js WebSocket", "process"),
    (3, 7, "QZ Tray sends payload to\nwarehouse printer\n(pixel/PDF or raw ZPL)", "end"),
    (2, 8, "Client script calls Suitelet\nto mark job\nPRINTED / FAILED", "script"),
]

SHAPE_FILL = {
    "start": BB1_BLUE, "end": BB1_BLUE, "process": WHITE,
    "decision": (255, 243, 205), "script": (232, 244, 232),
}
SHAPE_BORDER = {
    "start": BB1_BLUE, "end": BB1_BLUE, "process": BB1_BLUE,
    "decision": BB1_RED, "script": (42, 122, 42),
}
SHAPE_TEXT = {
    "start": WHITE, "end": WHITE, "process": BLACK, "decision": BLACK, "script": BLACK,
}


def draw_multiline_center(draw, cx, cy, text, fnt, fill):
    lines = text.split("\n")
    line_h = fnt.size + 4
    total_h = line_h * len(lines)
    y = cy - total_h / 2
    for line in lines:
        w = text_w(draw, line, fnt)
        draw.text((cx - w / 2, y), line, font=fnt, fill=fill)
        y += line_h


def build_flow():
    lane_w = 280
    header_h = 46
    row_h = 118
    n_rows = max(r for _, r, _, _ in STEPS) + 1
    W = lane_w * len(LANES) + 40
    H = header_h + row_h * n_rows + 60

    img = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(img)

    # lane headers + alternating body bands
    for i, (name, colour) in enumerate(LANES):
        x = 20 + i * lane_w
        d.rectangle([x, 20, x + lane_w, 20 + header_h], fill=colour, outline=colour)
        tw = text_w(d, name, F_HDR)
        d.text((x + (lane_w - tw) / 2, 20 + header_h / 2 - 8), name, font=F_HDR, fill=WHITE)
        for r in range(n_rows):
            band_fill = (255, 255, 255) if r % 2 == 0 else (238, 244, 249)
            d.rectangle([x, 20 + header_h + r * row_h, x + lane_w, 20 + header_h + (r + 1) * row_h],
                        fill=band_fill, outline=None)
        d.line([x, 20, x, 20 + header_h + n_rows * row_h], fill=(210, 210, 210), width=1)
    d.line([20 + len(LANES) * lane_w, 20, 20 + len(LANES) * lane_w, 20 + header_h + n_rows * row_h],
           fill=(210, 210, 210), width=1)

    centers = {}
    box_w, box_h = lane_w - 40, row_h - 30
    for idx, (lane, row, text, shape) in enumerate(STEPS):
        x = 20 + lane * lane_w + 20
        y = 20 + header_h + row * row_h + 15
        cx, cy = x + box_w / 2, y + box_h / 2
        centers[idx] = (cx, cy, x, y)
        fill = SHAPE_FILL[shape]
        border = SHAPE_BORDER[shape]
        if shape == "decision":
            d.polygon([(cx, y), (x + box_w, cy), (cx, y + box_h), (x, cy)], fill=fill, outline=border, width=2)
        elif shape in ("start", "end"):
            d.rounded_rectangle([x, y, x + box_w, y + box_h], radius=box_h / 2, fill=fill, outline=border, width=2)
        else:
            d.rounded_rectangle([x, y, x + box_w, y + box_h], radius=10, fill=fill, outline=border, width=2)
        draw_multiline_center(d, cx, cy, text, F_FIELD, SHAPE_TEXT[shape])
        num_w = 18
        d.ellipse([x - 8, y - 8, x - 8 + num_w, y - 8 + num_w], fill=BB1_RED)
        d.text((x - 8 + num_w / 2 - 4, y - 8 + 2), str(idx + 1), font=font(11, bold=True), fill=WHITE)

    # arrows step (idx) -> step (idx+1)
    for idx in range(len(STEPS) - 1):
        cx1, cy1, x1, y1 = centers[idx]
        cx2, cy2, x2, y2 = centers[idx + 1]
        # exit bottom of box1, enter top/side of box2
        start = (cx1, y1 + box_h)
        end = (cx2, y2)
        if abs(cx1 - cx2) > 5 and abs(centers[idx][1] - centers[idx + 1][1]) < row_h:
            start = (x1 + box_w if cx2 > cx1 else x1, cy1)
            end = (x2 if cx2 > cx1 else x2 + box_w, cy2)
        draw_arrow(d, start, end, color=(90, 90, 90))

    d.text((20, H - 30), "BB1 Technical Notes - Process Flow - J&K Ross SO Pick Ticket (Gap 9)",
           font=F_LABEL, fill=BB1_GREY)

    img.save(os.path.join(OUT, "flow.png"))
    print("wrote", os.path.join(OUT, "flow.png"), img.size)


if __name__ == "__main__":
    build_erd()
    build_flow()
