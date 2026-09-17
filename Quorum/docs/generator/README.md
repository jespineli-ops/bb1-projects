# BB1 Technical Notes generators - Quorum

Three standalone generators, one per customisation:

| Script | Output |
|---|---|
| `generate_tech_notes.py` | `../BB1_TechNotes_Quorum_TenancySchedule.docx` |
| `generate_tech_notes_customer_statement.py` | `../BB1_TechNotes_Quorum_CustomerStatement.docx` |
| `generate_tech_notes_prebilling.py` | `../BB1_TechNotes_Quorum_PreBilling.docx` |

## Requirements

```
pip3 install --user python-docx
```

No Node/npm or cairo/SVG toolchain is required. This machine had neither
available when either document was first generated, so each ERD (Section 2.6)
and Process Flow (Section 2.8) is a set of BB1-styled tables (relationship
table / swimlane table) rather than SVG-rendered diagrams - the same
fallback the bb1-tech-notes skill uses for Confluence when image rendering
isn't available. If a future revision has Node + the `docx` npm package and
cairosvg available, those sections can be swapped for real diagrams by
following the skill's ERD/Process Flow SVG generation steps instead.

## Regenerate

```
python3 generate_tech_notes.py
python3 generate_tech_notes_customer_statement.py
python3 generate_tech_notes_prebilling.py
```

Content (business requirements, component tables, testing steps) is
hardcoded in each script - update the relevant `add_heading`/`add_body`/
`add_table` calls directly when the customisation changes, then re-run.

All three scripts share the same low-level oxml helpers (cell shading/borders/
margins, `soft_break` for long NetSuite ids, `set_table_grid`). Note in
particular that `python-docx`'s `add_table()` writes a `w:tblGrid` with
columns divided evenly, which does **not** automatically follow later
per-cell `set_cell_width()` calls - some renderers (Google Docs, LibreOffice)
lay out columns from `w:tblGrid` rather than each cell's own `w:tcW`, which
would silently undo the intended column widths. `set_table_grid()` rewrites
the grid to match, and `add_table()` calls it - keep that call if copying
this pattern into a new generator.

`generate_tech_notes_prebilling.py`'s `add_table()` always runs `soft_break()`
on every cell's text, not only cells flagged as monospace - a long NetSuite id
(e.g. `customlist_bb1_building_prop_portfolio`) turns up inside ordinary prose
columns too (a "Detail" or "To" column), and bleeds off the page there just as
readily as in a dedicated id column, since Word never wraps on an underscore
regardless of font. Prefer this version of `add_table()` if copying the
pattern into a future generator; the two older scripts only soft-break cells
explicitly marked `mono_cols`.
