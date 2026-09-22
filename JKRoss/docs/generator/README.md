# BB1 Tech Notes generators — JKRoss Automatic Print Documents (Gap 9)

Two independent generators live here, one per document. Both use `python-docx` + Pillow
instead of the standard `docx` npm package + SVG pipeline (no Node/npm or cairosvg on
this machine), following the same BB1 brand rules (colours, DXA-fixed table widths,
zero-width-space soft breaks on long NetSuite identifiers).

## 1. SO Pick Ticket — solution design (pending build)

Regenerates `../BB1_TechNotes_JKR_SOPickTicket.docx`. Written as a forward-looking
solution design for the Sales Order / Released trigger row, including a proposed (not
yet built) Print Job Queue custom record — see its own Section 4, Action Items, before
treating it as current state.

```bash
python3 build_diagrams.py   # writes assets/erd.png, assets/flow.png
python3 build_docx.py       # writes ../BB1_TechNotes_JKR_SOPickTicket.docx
```

- `build_diagrams.py` — draws the ERD and process-flow diagrams straight to PNG
- `build_docx.py` — builds the full Technical Notes document

## 2. Automatic Print Documents — WorkflowActionScript (as actually built)

Regenerates `../BB1_TechNotes_JKR_AutoPrintWFA.docx`. Documents what was actually built
and assigned to this developer: the WorkflowActionScript `bb1_jkr_prnt_doc_wfa.js` only.
The SuiteFlow workflows that call it (all five rows of the Functional Design's trigger
matrix, including Work Order/Build → finished goods committed to an open Sales Order)
are being built separately by another developer and are documented as dependencies, not
as part of this component — see its Section 2.7 and Section 4.

```bash
python3 build_diagrams_wfa.py   # writes assets/erd_wfa.png, assets/flow_wfa.png
python3 build_docx_wfa.py       # writes ../BB1_TechNotes_JKR_AutoPrintWFA.docx
```

- `build_diagrams_wfa.py` — draws the dependency diagram and process-flow diagram
- `build_docx_wfa.py` — builds the full Technical Notes document

## Common

Requires `python-docx` and `Pillow` (both already present in this environment's
`python3`). Uses `/System/Library/Fonts/Supplemental/Arial*.ttf` for diagram text.
`assets/` holds the generated PNGs for both documents, embedded into their respective
docx files.
