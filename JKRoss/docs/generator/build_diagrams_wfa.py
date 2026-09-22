"""
BB1 Technical Notes - diagram generator for the JKRoss Automatic Print Documents
WorkflowActionScript (Gap 9).

Scope note: this deliverable is the WorkflowActionScript only (bb1_jkr_prnt_doc_wfa.js).
The SuiteFlow workflows that call it, and the Printer custom record referenced in the
Functional Design, are being built by another developer and are shown here as external
dependencies (dashed / grey) rather than as part of this component.

Renders the dependency diagram and process flow as PNGs directly with Pillow (no
Node/cairosvg available on this machine). Re-run after any change to the script.

Usage: python3 build_diagrams_wfa.py
Outputs: assets/erd_wfa.png, assets/flow_wfa.png (next to this script)
"""
import os
import math
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "assets")
os.makedirs(OUT, exist_ok=True)

BB1_BLUE = (36, 120, 170)
BB1_RED = (192, 40, 46)
BB1_GREY = (155, 150, 146)
BODY_FILL = (245, 245, 245)
DASHED_FILL = (245, 245, 245)
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)

ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def font(size, bold=False):
    return ImageFont.truetype(ARIAL_BOLD if bold else ARIAL, size)


F_HDR = font(14, bold=True)
F_FIELD = font(11)
F_TYPE = font(10)
F_LABEL = font(11)


def text_w(draw, txt, fnt):
    bbox = draw.textbbox((0, 0), txt, font=fnt)
    return bbox[2] - bbox[0]


# ---------------------------------------------------------------------------
# Dependency diagram (stands in for a classic ERD - this component has no
# custom-record data model of its own, only a script and its dependencies)
# ---------------------------------------------------------------------------

def draw_entity(draw, x, y, w, title, fields, header_fill=BB1_BLUE, dashed=False):
    row_h = 20
    title_lines = title.split("\n")
    header_h = 18 * len(title_lines) + 16
    h = header_h + row_h * len(fields) + 10
    border = BB1_GREY if dashed else BB1_BLUE
    if dashed:
        # manual dashed rectangle outline
        for xa, ya, xb, yb in [(x, y, x + w, y), (x, y + h, x + w, y + h),
                                (x, y, x, y + h), (x + w, y, x + w, y + h)]:
            dist = math.hypot(xb - xa, yb - ya)
            steps = max(1, int(dist // 8))
            for i in range(steps):
                if i % 2 == 0:
                    sx = xa + (xb - xa) * i / steps
                    sy = ya + (yb - ya) * i / steps
                    ex = xa + (xb - xa) * (i + 1) / steps
                    ey = ya + (yb - ya) * (i + 1) / steps
                    draw.line([sx, sy, ex, ey], fill=border, width=2)
        draw.rectangle([x, y, x + w, y + h], fill=BODY_FILL)
    else:
        draw.rectangle([x, y, x + w, y + h], outline=border, width=2, fill=BODY_FILL)
    draw.rectangle([x, y, x + w, y + header_h], fill=header_fill, outline=border, width=2)
    ty = y + 8
    for line in title_lines:
        tw = text_w(draw, line, F_HDR)
        draw.text((x + max(4, (w - tw) / 2), ty), line, font=F_HDR, fill=WHITE)
        ty += 18
    fy = y + header_h + 5
    for internal_id, label, badge in fields:
        draw.text((x + 10, fy), internal_id, font=F_FIELD, fill=BB1_GREY)
        draw.text((x + 10, fy + 12), f"{label}  [{badge}]", font=F_TYPE, fill=BLACK)
        fy += row_h
    return h


def draw_arrow(draw, p1, p2, label=None, dashed=False, color=BB1_RED):
    x1, y1 = p1
    x2, y2 = p2
    if dashed:
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
    ang = math.atan2(y2 - y1, x2 - x1)
    ah = 10
    left = (x2 - ah * math.cos(ang - 0.4), y2 - ah * math.sin(ang - 0.4))
    right = (x2 - ah * math.cos(ang + 0.4), y2 - ah * math.sin(ang + 0.4))
    draw.polygon([p2, left, right], fill=color)
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        tw = text_w(draw, label, F_LABEL)
        draw.rectangle([mx - tw / 2 - 4, my - 9, mx + tw / 2 + 4, my + 9], fill=WHITE)
        draw.text((mx - tw / 2, my - 7), label, font=F_LABEL, fill=BB1_GREY)


def build_erd():
    W, H = 1320, 620
    img = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(img)

    trig_fields = [
        ("newRecord.type", "Record Type", "Free Text"),
        ("newRecord.id", "Record Id", "Free Text"),
    ]
    script_fields = [
        ("custscript_bb1_jkr_auto_print_cust_form", "Print Form Number", "Integer/List"),
    ]
    lib_fields = [
        ("AddJobToQueue()", "Queue a print job", "Function"),
        ("InitiateProcessJobQueue()", "Process queue + redirect", "Function"),
    ]
    proc_fields = [
        ("customscript_bb1_qz_pi_record", "Queue processor script id", "Script Ref"),
        ("jobData.type / id / format / formnumber", "Print job payload", "Object"),
    ]
    printer_fields = [
        ("_bb1_prn_name", "Printer Name", "Free Text"),
        ("_bb1_prn_ip_address", "IP Address", "Free Text"),
    ]

    trig_x, trig_y = 40, 90
    script_x, script_y = 480, 90
    lib_x, lib_y = 960, 90
    proc_x, proc_y = 960, 360
    prn_x, prn_y = 480, 360

    trig_h = draw_entity(d, trig_x, trig_y, 320, "Triggering Record\n(generic)", trig_fields)
    script_h = draw_entity(d, script_x, script_y, 340, "bb1_jkr_prnt_doc_wfa.js\n(WFA)", script_fields,
                            header_fill=(42, 122, 42))
    lib_h = draw_entity(d, lib_x, lib_y, 320, "BB1 QZ Library\n(existing SuiteApp)", lib_fields)
    proc_h = draw_entity(d, proc_x, proc_y, 320, "Queue Processor\n(existing, external)", proc_fields)
    prn_h = draw_entity(d, prn_x, prn_y, 340, "Printer custom record\n(per FDD - not built here)",
                         printer_fields, header_fill=BB1_GREY, dashed=True)

    draw_arrow(d, (trig_x + 320, trig_y + 30), (script_x, script_y + 30), None)
    d.text((trig_x + 330, trig_y - 20), "onAction()", font=F_LABEL, fill=BB1_GREY)
    draw_arrow(d, (script_x + 340, script_y + 30), (lib_x, lib_y + 30), None)
    d.text((script_x + 350, script_y - 20), "AddJobToQueue()", font=F_LABEL, fill=BB1_GREY)
    draw_arrow(d, (lib_x + 160, lib_y + lib_h), (proc_x + 160, proc_y), None)
    d.text((lib_x + 165, lib_y + lib_h + 8), "InitiateProcess-\nJobQueue(url)", font=F_LABEL, fill=BB1_GREY)
    draw_arrow(d, (script_x + 170, script_y + script_h), (prn_x + 170, prn_y), None,
               dashed=True, color=BB1_GREY)
    d.text((script_x + 180, script_y + script_h + 8), "not yet referenced\nby script", font=F_LABEL, fill=BB1_GREY)

    d.text((40, H - 26), "BB1 Technical Notes - Dependency Diagram - J&K Ross Automatic Print Documents WFA (Gap 9)",
           font=F_LABEL, fill=BB1_GREY)

    img.save(os.path.join(OUT, "erd_wfa.png"))
    print("wrote", os.path.join(OUT, "erd_wfa.png"), img.size)


# ---------------------------------------------------------------------------
# Process flow
# ---------------------------------------------------------------------------

LANES = [
    ("SuiteFlow Workflow\n(built separately)", BB1_BLUE),
    ("bb1_jkr_prnt_doc_wfa.js", (42, 122, 42)),
    ("BB1 QZ Library / Browser", BB1_BLUE),
    ("QZ Tray / Printer", BB1_RED),
]

STEPS = [
    (0, 0, "Workflow's own trigger\nfires (e.g. Build saved AND\nfinished goods commit to\nan open Sales Order)", "start"),
    (1, 1, "onAction() reads\nnewRecord.type / id\nfrom scriptContext", "process"),
    (1, 2, "Resolves record URL via\nN/url.resolveRecord()", "process"),
    (1, 3, "Reads script param\ncustscript_bb1_jkr_auto_\nprint_cust_form", "process"),
    (1, 4, "Builds jobData:\ntype, id, format=PDF,\nformnumber", "process"),
    (1, 5, "bb1qz.AddJobToQueue()\ntargets customscript_\nbb1_qz_pi_record", "script"),
    (1, 6, "bb1qz.InitiateProcess\nJobQueue(redirectUrl)", "script"),
    (2, 7, "Browser redirects to record;\nQZ Library processes the\nqueued job", "process"),
    (3, 8, "QZ Tray delivers the PDF\nto the configured printer", "end"),
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
    header_h = 56
    row_h = 118
    n_rows = max(r for _, r, _, _ in STEPS) + 1
    W = lane_w * len(LANES) + 40
    H = header_h + row_h * n_rows + 60

    img = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(img)

    for i, (name, colour) in enumerate(LANES):
        x = 20 + i * lane_w
        d.rectangle([x, 20, x + lane_w, 20 + header_h], fill=colour, outline=colour)
        draw_multiline_center(d, x + lane_w / 2, 20 + header_h / 2, name, F_HDR, WHITE)
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

    for idx in range(len(STEPS) - 1):
        cx1, cy1, x1, y1 = centers[idx]
        cx2, cy2, x2, y2 = centers[idx + 1]
        start = (cx1, y1 + box_h)
        end = (cx2, y2)
        if abs(cx1 - cx2) > 5 and abs(centers[idx][1] - centers[idx + 1][1]) < row_h:
            start = (x1 + box_w if cx2 > cx1 else x1, cy1)
            end = (x2 if cx2 > cx1 else x2 + box_w, cy2)
        draw_arrow(d, start, end, color=(90, 90, 90))

    d.text((20, H - 30), "BB1 Technical Notes - Process Flow - J&K Ross Automatic Print Documents WFA (Gap 9)",
           font=F_LABEL, fill=BB1_GREY)

    img.save(os.path.join(OUT, "flow_wfa.png"))
    print("wrote", os.path.join(OUT, "flow_wfa.png"), img.size)


if __name__ == "__main__":
    build_erd()
    build_flow()
