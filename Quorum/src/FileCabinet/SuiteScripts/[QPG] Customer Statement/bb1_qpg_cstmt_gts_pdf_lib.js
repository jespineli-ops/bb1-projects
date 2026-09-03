/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library that renders the Generate Statement Suitelet's PDF -
 * one merged PDF covering every customer marked in the Customer List, each
 * as its own page (separated by a page break), opened in a single browser
 * tab (see gts_cs.js's generateStatement/gts_lib_helper.js's buildPrintUrl).
 * Builds the full statement now - header (logo, Entity/Property panel,
 * customer block), the statement date/from/for-the-month line, the AR
 * activity table, the totals block (with bank details standing in for the
 * reference design's online-payment prompt), and a Queries/aging-days
 * strip - matching "Tenant Statements - Commercial.pdf" up to the aging
 * strip; everything the reference design shows after that (the itemised
 * bank details table, "Printed:"/software footer) is intentionally
 * dropped in favour of a plain page number, per spec.
 *
 * Date                 Author              Purpose
 * 03-September-2026    Jared Espineli      Initial Release - header section (logo, Entity/Property panel,
 *                                          customer block) for every marked customer, merged into one PDF
 * 03-September-2026    Jared Espineli      Fixed two rendering bugs seen on the actual PDF output: (1) the logo
 *                                          was badly stretched - the ported POC comment claimed a 0.53:1
 *                                          portrait ratio, but the real file (checked directly) is a 2.78:1
 *                                          landscape wordmark; resized to LOGO_WIDTH_PT/LOGO_HEIGHT_PT matching
 *                                          its real ratio. (2) "Recipient Registration No." (and other wrapped
 *                                          labels/values) rendered with stretched-out letter spacing - BFO
 *                                          justifies wrapped <td> text by default; panelCell() now wraps label/
 *                                          value text in a left-aligned <p> (leftAligned()) to override that,
 *                                          same fix already used by the Tenancy Schedule report's column
 *                                          headers. Also widened the panel's label column (27% -> 30%) and
 *                                          added vertical-align/line-height so a wrapped two-line label doesn't
 *                                          sit oddly against a single-line value beside it
 * 04-September-2026    Jared Espineli      Rebuilt the Entity/Property panel around a stacked label-above-value
 *                                          layout (stackedCell() replaces panelCell()) - splitting each row into
 *                                          narrow side-by-side label/value sub-columns left "Recipient
 *                                          Registration No." (and "Entity Registration No.") only ~30% of the
 *                                          panel width to wrap in, and the wrapped second line rendered
 *                                          overlapping the FOLLOWING row instead of pushing it down - a BFO row-
 *                                          height quirk with uneven-height sibling cells on the same row. Giving
 *                                          each label its own full (or half, for two-up rows) width column
 *                                          removes the wrap almost entirely and matches "Tenant Statements -
 *                                          Commercial.pdf"'s actual layout more closely besides. Also enlarged
 *                                          the logo (110x40pt -> 180x65pt, same 2.78:1 ratio) per feedback that
 *                                          it should occupy more of the header
 * 04-September-2026    Jared Espineli      Fixed the rebuilt panel's label/value rendering fully on top of each
 *                                          other within the same cell - stackedCell() had stacked them as two
 *                                          separate <p> elements (with margin/line-height resets to control the
 *                                          gap between them), which BFO collapsed onto the same vertical
 *                                          position instead of stacking. Replaced with the proven-safe pattern
 *                                          already used for the multi-line billing address elsewhere in this
 *                                          same document: one <p>, two <span>s joined by a literal <br/>
 * 04-September-2026    Jared Espineli      Reworked the panel back to a plain 4-column label/value grid per
 *                                          feedback (panelCell() replaces stackedCell()) - no borders, background
 *                                          colour only, colspan-merging a row's cells down to a single label +
 *                                          full-width value when there's only one pair (Entity, Entity VAT No.,
 *                                          Entity Reg. No.). "Entity/Recipient Registration No." shortened to
 *                                          "... Reg. No." so each fits the 30%-wide label column on one line -
 *                                          the earlier row-overlap bug was specifically a wrapped label bleeding
 *                                          into the row below, so this avoids the wrap outright
 * 04-September-2026    Jared Espineli      Added the rest of the statement: buildMetaLine() (Statement Date/
 *                                          From (the Start Date, replacing the reference design's Tax Invoice
 *                                          No.)/For the Month), buildActivityTable() (the AR activity rows,
 *                                          sourced from dataLib.buildStatementData - see its own row-shape
 *                                          comments for the Balance B/f and item-line rules ported from the POC),
 *                                          buildTotalsSection() (Arrears/Current Month Charges/Amount Due,
 *                                          matching the reference design, with the header's bank_details text in
 *                                          place of the design's online-payment prompt on the left), and
 *                                          buildQueriesAgingSection() (Queries email/WhatsApp left, the 120+/90/
 *                                          60/30/Current aging strip right - QUERIES_EMAIL/QUERIES_WHATSAPP
 *                                          ported verbatim from the POC's own constants). Everything the
 *                                          reference design shows after the aging strip is dropped per spec, in
 *                                          favour of a plain page-number footer (cstmtfooter macro). Switched
 *                                          buildCustomerPage from dataLib.buildStatementHeader to the full
 *                                          buildStatementData now that rows/lines/aging/totals are all needed
 * 04-September-2026    Jared Espineli      Restyled the activity table and totals box to match a cleaner
 *                                          reference screenshot: activity table's grey header fill and per-row
 *                                          border lines replaced with a plain header (one solid rule underneath)
 *                                          and alternating row shading (cstmt-row-alt) instead - flattenActivityRows()
 *                                          now flattens statement.rows/.lines into one plain list up front so the
 *                                          stripe index runs continuously and doesn't reset at an invoice's own
 *                                          item lines. Totals box now explicitly sizes its own Exclusive/Tax/
 *                                          Inclusive columns off the SAME COL_DATE/COL_ALLOCATION/COL_REMARKS/
 *                                          COL_NUM constants the activity table uses (re-based to the box's own
 *                                          width), so they land exactly under their counterparts above instead
 *                                          of just approximating the split with separate hardcoded percentages;
 *                                          also boxed the totals table in a thin border and added a rule above
 *                                          Amount Due, and the bank-details text on the left is now plain (no
 *                                          grey panel background), matching the screenshot
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/render', 'N/log', './bb1_qpg_cstmt_gts_data_lib', './bb1_qpg_cstmt_gts_lib_helper'],
    /**
     * @param{render} render
     * @param{log} log
     * @param{dataLib} dataLib
     * @param{helperLib} helperLib
     */
    (render, log, dataLib, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        // File cabinet URL of the Quorum logo - the tall, stacked house-icon
        // + "PROPERTIES" wordmark used on the tenant statement (not the
        // wide wordmark logo the Tenancy Schedule report uses - see its own
        // bb1_qpg_tschd_report_pdf_lib.js). Ported from the standalone POC
        // Suitelet (bb1_qpg_stmt_tenant_su_poc.js, v23-2026-08-30). Escape
        // any & in this URL as &amp; if it's ever changed.
        const LOGO_URL = 'https://11536405.app.netsuite.com/core/media/media.nl' +
            '?id=5936&amp;c=11536405' +
            '&amp;h=ShdVNtHtCNZxRziqz5XaCmH8XthcQqu1MScOaMoTvGlWj9lm';

        // Logo size in points (1pt = 1/72 inch). BFO ignores CSS pixel
        // widths and falls back to the image's native size unless BOTH
        // dimensions are given, so width and height are always emitted
        // together. The POC's own comment claimed this asset was "taller
        // than wide - roughly 0.53:1", which badly stretched it here - the
        // actual file (checked directly) is 2889x1040px, a WIDE landscape
        // wordmark, ratio ~2.78:1. Keep that ratio if this is ever resized.
        const LOGO_WIDTH_PT = 180;
        const LOGO_HEIGHT_PT = 65;

        // Queries panel shown bottom-left of the statement, next to the
        // aging strip. Ported verbatim from the POC's own constants
        // (bb1_qpg_stmt_tenant_su_poc.js).
        const QUERIES_EMAIL = 'commercial@qholdings.co.za';
        const QUERIES_WHATSAPP = '082 400 3693';

        const LIB_FX = {};

        //-----------------------------------------------
        //Formatting helpers
        //-----------------------------------------------

        // Escape record data before it reaches the BFO document - BFO parses
        // strict XML, so an unescaped ampersand/quote in an address or memo
        // would fail the whole render.
        const escapeXml = (value) => {
            if (value === null || value === undefined) return '';
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        }

        // Two decimals with thousands separators, blank for null/blank/NaN
        const formatAmount = (value) => {
            if (value === null || value === undefined || value === '') return '';
            const number = Number(value);
            return isNaN(number) ? '' : number.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        }

        //-----------------------------------------------
        //Header section
        //Logo + title + customer/tenant block on the
        //left, the Entity/Property panel on the right -
        //everything the statement prints above its AR
        //activity table (not built yet, see file header)
        //-----------------------------------------------

        // One label/value cell PAIR in the Entity/Property panel's 4-column
        // grid (label 30% / value 20%, twice per row) - plain, borderless,
        // background-filled cells; colspan lets a row with only one pair
        // (Entity, Entity VAT No., Entity Reg. No.) merge its value across
        // the remaining 3 columns instead of leaving them blank, while
        // still lining up under the two-up rows below/above it. Content is
        // still wrapped in its own left-aligned <p> - BFO justifies
        // (stretches) wrapped <td> text by default, and an occasional long
        // VALUE (e.g. a long entity/property name) can still wrap even
        // though labels are sized not to (see buildEntityPanel).
        const panelCell = (label, value, colspan) => {
            const span = colspan ? ` colspan="${colspan}"` : '';
            const valueWidth = colspan ? '' : ' style="width: 20%;"';
            return `<td class="cstmt-label" style="width: 30%;"><p style="text-align: left; margin: 0;">${escapeXml(label)}</p></td>` +
                `<td class="cstmt-value"${span}${valueWidth}><p style="text-align: left; margin: 0;">${escapeXml(value)}</p></td>`;
        }

        // Three full-width rows (Entity, Entity VAT No., Entity Reg. No.)
        // then three two-up rows (Property | Unit No., Recipient VAT No. |
        // Recipient Reg. No., Deposit | Bank Guarantee), matching "Tenant
        // Statements - Commercial.pdf"'s layout. "Entity Registration No."/
        // "Recipient Registration No." are shortened to "... Reg. No." -
        // at this panel's width (45% of an A4 page), the label column (30%
        // of that, ~70pt) is too narrow for either phrase in full to fit on
        // one line, and a wrapped label previously overlapped the row below
        // it (a BFO row-height quirk) - shortening avoids the wrap outright
        // rather than fighting that quirk again.
        const buildEntityPanel = (header) => `
            <table class="cstmt-panel">
                <tr>${panelCell('Entity', header.entity_name, 3)}</tr>
                <tr>${panelCell('Entity VAT No.', header.entity_vat_no, 3)}</tr>
                <tr>${panelCell('Entity Reg. No.', header.entity_reg_no, 3)}</tr>
                <tr>${panelCell('Property', header.property)}${panelCell('Unit No.', header.unit_no)}</tr>
                <tr>${panelCell('Recipient VAT No.', header.recipient_vat_no)}${panelCell('Recipient Reg. No.', header.recipient_reg_no)}</tr>
                <tr>${panelCell('Deposit', formatAmount(header.deposit))}${panelCell('Bank Guarantee', formatAmount(header.bank_guarantee))}</tr>
            </table>
        `;

        const buildHeaderSection = (statement) => {
            const header = statement.header;
            const addressHtml = header.bill_address
                ? escapeXml(header.bill_address).replace(/\r\n|\r|\n/g, '<br/>')
                : '';

            return `
                <table class="cstmt-plain" style="width: 100%;">
                    <tr>
                        <td style="width: 55%; vertical-align: top; border: none;">
                            <img src="${LOGO_URL}" alt="Company Logo" width="${LOGO_WIDTH_PT}" height="${LOGO_HEIGHT_PT}"
                                 style="width: ${LOGO_WIDTH_PT}pt; height: ${LOGO_HEIGHT_PT}pt;" />
                            <h1 class="cstmt-title">Tax Invoice &amp; Statement</h1>
                            <p class="cstmt-tenant-name">${escapeXml(header.customer_name)}</p>
                            <p>${addressHtml}</p>
                        </td>
                        <td style="width: 45%; vertical-align: top; border: none;">
                            ${buildEntityPanel(header)}
                        </td>
                    </tr>
                </table>
            `;
        }

        //-----------------------------------------------
        //Statement date/from/for-the-month line
        //Replaces the reference design's "Tax Invoice
        //No." with "From" (the Start Date), per spec
        //-----------------------------------------------
        const buildMetaLine = (statement) => `
            <p class="cstmt-meta">
                Statement Date: <span class="cstmt-meta-value">${escapeXml(statement.statementDate)}</span>&nbsp;&nbsp;&nbsp;&nbsp;
                From: <span class="cstmt-meta-value">${escapeXml(statement.startDate)}</span>&nbsp;&nbsp;&nbsp;&nbsp;
                For the Month: <span class="cstmt-meta-value">${escapeXml(statement.billingMonth)}</span>
            </p>
        `;

        //-----------------------------------------------
        //AR activity table
        //Row/column shape ported from the POC's own
        //buildStatementXml, adapted to the reference
        //design's 6-column header (no Document column)
        //-----------------------------------------------

        // Activity table's own column widths - shared with buildTotalsSection
        // below so its Exclusive/Tax/Inclusive columns line up exactly under
        // these ones, per the reference screenshot ("align the totals ...
        // right below it").
        const COL_DATE = 12;
        const COL_ALLOCATION = 18;
        const COL_REMARKS = 40;
        const COL_NUM = 10; // Exclusive / Tax / Inclusive, each

        // Left-aligned text cells go through their own <p> - same fix used
        // throughout this file for BFO's default wrapped-<td> justification
        // (Remarks, in particular, regularly wraps to 2-3 lines). Numeric
        // cells are never long enough to wrap, so they skip the <p> and
        // rely on the .num class's text-align: right directly.
        const textCell = (value) => `<td><p style="text-align: left; margin: 0;">${escapeXml(value)}</p></td>`;
        const numCell = (value) => `<td class="num">${value}</td>`;

        // One rendered row - rowIndex drives the zebra striping (every other
        // row gets a light grey fill instead of a border line between rows,
        // matching the reference screenshot) and continues seamlessly
        // across a boundary between two different statement.rows entries -
        // see buildActivityRows, which flattens everything into one list
        // before this is ever called, so the stripe never resets mid-invoice.
        const activityRow = (entry, rowIndex) => {
            const rowClass = rowIndex % 2 === 1 ? ' class="cstmt-row-alt"' : '';
            return `<tr${rowClass}>${textCell(entry.date)}${textCell(entry.allocation)}${textCell(entry.remarks)}` +
                `${numCell(entry.exclusive)}${numCell(entry.tax)}${numCell(entry.inclusive)}</tr>`;
        }

        // Flattens statement.rows (+ nested .lines) into one list of plain
        // {date, allocation, remarks, exclusive, tax, inclusive} row
        // entries, in display order - kept separate from activityRow so the
        // zebra stripe above can run off one continuous index regardless of
        // which statement.rows entry (or invoice's item lines) a given
        // rendered row actually came from.
        //
        // MRI (and the POC ported from it) suppresses an invoice's own
        // transaction-level row and prints its item lines in its place -
        // only a row with no item lines (Balance B/f, a receipt, a credit
        // memo with no lines, etc.) shows at transaction level.
        //
        // Document number isn't its own column here (the reference design
        // has none), so a header-less row's document number is shown in
        // Remarks instead - Balance B/f has neither a document number nor a
        // real date/tax breakdown (it's a synthetic aggregate, not a real
        // transaction), so those stay blank; every other header-less row
        // shows its real date and 0.00 in Exclusive/Tax - matches the
        // reference design exactly (its Receipt row shows "0.00  0.00",
        // Balance B/f shows blank in both).
        const flattenActivityRows = (rows) => {
            const flat = [];

            rows.forEach((row) => {
                if (row.lines && row.lines.length) {
                    row.lines.forEach((line) => flat.push({
                        date: line.transaction_date,
                        allocation: line.allocation,
                        remarks: line.remarks,
                        exclusive: formatAmount(line.exclusive),
                        tax: formatAmount(line.tax),
                        inclusive: formatAmount(line.inclusive)
                    }));
                    return;
                }

                const isBroughtForward = row.transaction_type === 'Balance B/f';

                flat.push({
                    date: isBroughtForward ? '' : row.transaction_date,
                    allocation: row.transaction_type,
                    remarks: row.document_number,
                    exclusive: isBroughtForward ? '' : formatAmount(0),
                    tax: isBroughtForward ? '' : formatAmount(0),
                    inclusive: formatAmount(row.amount)
                });
            });

            return flat;
        }

        const buildActivityTable = (statement) => `
            <table class="cstmt-activity">
                <thead>
                    <tr>
                        <th style="width: ${COL_DATE}%;">Date</th>
                        <th style="width: ${COL_ALLOCATION}%;">Allocation</th>
                        <th style="width: ${COL_REMARKS}%;">Remarks</th>
                        <th class="num" style="width: ${COL_NUM}%;">Exclusive</th>
                        <th class="num" style="width: ${COL_NUM}%;">Tax</th>
                        <th class="num" style="width: ${COL_NUM}%;">Inclusive</th>
                    </tr>
                </thead>
                <tbody>
                    ${flattenActivityRows(statement.rows).map(activityRow).join('')}
                </tbody>
            </table>
        `;

        //-----------------------------------------------
        //Totals block
        //Matches the reference screenshot's Arrears/
        //Current Month Charges/Amount Due box, its own
        //Exclusive/Tax/Inclusive columns sized to line up
        //under the activity table's (see COL_* above) -
        //the design's online-payment prompt (left) is
        //replaced with the transaction's own bank
        //details, per spec
        //-----------------------------------------------
        const buildTotalsSection = (statement, symbol) => {
            // The totals box occupies Remarks + the 3 numeric columns
            // (COL_REMARKS + 3 * COL_NUM = 70% of the page); its own label
            // column is Remarks' share of THAT box, and each numeric column
            // is one COL_NUM's share of it - same 4:1:1:1 ratio as the
            // activity table, just re-based to the box's own 100%.
            const boxWidth = COL_REMARKS + (3 * COL_NUM);
            const labelWidthPct = (COL_REMARKS / boxWidth * 100).toFixed(2);
            const numWidthPct = (COL_NUM / boxWidth * 100).toFixed(2);

            return `
                <table class="cstmt-plain" style="width: 100%; margin-top: 6pt;">
                    <tr>
                        <td style="width: ${COL_DATE + COL_ALLOCATION}%; vertical-align: top; border: none;">
                            ${statement.header.bank_details
                                ? `<p style="text-align: left; margin: 0;">${escapeXml(statement.header.bank_details).replace(/\r\n|\r|\n/g, '<br/>')}</p>`
                                : ''}
                        </td>
                        <td style="width: ${boxWidth}%; vertical-align: top; border: none;">
                            <table class="cstmt-totals">
                                <tr>
                                    <td style="width: ${labelWidthPct}%;">Arrears/Prepaid</td>
                                    <td class="num" style="width: ${numWidthPct}%;"></td>
                                    <td class="num" style="width: ${numWidthPct}%;"></td>
                                    <td class="num" style="width: ${numWidthPct}%;">${formatAmount(statement.totals.arrears)}</td>
                                </tr>
                                <tr>
                                    <td style="width: ${labelWidthPct}%;">Current Month Charges</td>
                                    <td class="num" style="width: ${numWidthPct}%;">${formatAmount(statement.totals.exclusive)}</td>
                                    <td class="num" style="width: ${numWidthPct}%;">${formatAmount(statement.totals.tax)}</td>
                                    <td class="num" style="width: ${numWidthPct}%;">${formatAmount(statement.totals.inclusive)}</td>
                                </tr>
                                <tr class="cstmt-total-row">
                                    <td class="cstmt-total-strong" style="width: ${labelWidthPct}%;">Amount Due</td>
                                    <td class="num" style="width: ${numWidthPct}%;"></td>
                                    <td class="num" style="width: ${numWidthPct}%;"></td>
                                    <td class="num cstmt-total-strong" style="width: ${numWidthPct}%;">${escapeXml(symbol)}${formatAmount(statement.aging.total_due)}</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            `;
        }

        //-----------------------------------------------
        //Queries + aging strip
        //Last section shown - everything the reference
        //design prints after this (itemised bank details
        //table, "Printed:"/software footer) is dropped in
        //favour of a plain page-number footer (see buildPdf)
        //-----------------------------------------------
        const buildQueriesAgingSection = (statement) => `
            <table class="cstmt-plain" style="width: 100%; margin-top: 8pt;">
                <tr>
                    <td style="width: 55%; vertical-align: top; border: none;">
                        <p class="cstmt-queries">Queries</p>
                        <p>${escapeXml(QUERIES_EMAIL)}</p>
                        <p>Whatsapp Nr: ${escapeXml(QUERIES_WHATSAPP)}</p>
                    </td>
                    <td style="width: 45%; vertical-align: top; border: none;">
                        <table class="cstmt-aging">
                            <thead>
                                <tr>
                                    <th class="num">120 Days +</th>
                                    <th class="num">90 Days</th>
                                    <th class="num">60 Days</th>
                                    <th class="num">30 Days</th>
                                    <th class="num">Current</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td class="num">${formatAmount(statement.aging.days_120_plus)}</td>
                                    <td class="num">${formatAmount(statement.aging.days_90)}</td>
                                    <td class="num">${formatAmount(statement.aging.days_60)}</td>
                                    <td class="num">${formatAmount(statement.aging.days_30)}</td>
                                    <td class="num">${formatAmount(statement.aging.current_amt)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </td>
                </tr>
            </table>
        `;

        // One marked customer's page. A bad id/no invoice in period/query
        // failure for one customer must not take the whole merged PDF down
        // - it prints its own short error page instead of the rest.
        const buildCustomerPage = (customerId, filters) => {
            try {
                const statement = dataLib.LIB_FX.buildStatementData(Object.assign({}, filters, {customerId}));
                const symbol = statement.header.currency_symbol || 'R';

                return buildHeaderSection(statement) +
                    buildMetaLine(statement) +
                    buildActivityTable(statement) +
                    buildTotalsSection(statement, symbol) +
                    buildQueriesAgingSection(statement);
            } catch (e) {
                log.error(`Statement failed for customer ${customerId}`, e.message);
                return `<p>Could not generate the statement for customer ${escapeXml(customerId)}: ${escapeXml(e.message)}</p>`;
            }
        }

        //-----------------------------------------------
        //PDF assembly
        //-----------------------------------------------

        // Builds the merged PDF - one page per marked customer id, in the
        // order they were marked, separated by a page break.
        LIB_FX.buildPdf = (params) => {
            const customerIds = helperLib.LIB_FX.parseIdListParam(params && params[_FIELDS.ACTION.CUSTOMER_IDS]);

            const filters = {
                startDate: params && params[_FIELDS.FORM.START_DATE],
                statementDate: params && params[_FIELDS.FORM.STATEMENT_DATE],
                rollup: !(params && params[_FIELDS.FORM.ROLL_PRIOR_CHARGES] === 'F')
            };

            const pages = customerIds.map((customerId) => buildCustomerPage(customerId, filters));
            const body = pages.join('<pbr/>');

            const xml = `
                <?xml version="1.0"?>
                <!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
                <pdf>
                    <head>
                        <macrolist>
                            <macro id="cstmtfooter">
                                <table style="width: 100%; border: none;">
                                    <tr><td style="border: none; text-align: left; font-size: 7pt; color: #777777;">Page <pagenumber/></td></tr>
                                </table>
                            </macro>
                        </macrolist>
                        <style>
                            * { font-family: Arial, Helvetica, sans-serif; }
                            body { font-size: 8pt; color: #333333; }
                            h1.cstmt-title { font-size: 15pt; color: #B8912F; font-weight: normal; margin: 4pt 0; }
                            .cstmt-tenant-name { font-weight: bold; font-size: 9pt; }
                            .cstmt-meta { font-size: 8pt; margin: 10pt 0 6pt 0; }
                            .cstmt-meta-value { font-weight: bold; }
                            table.cstmt-plain td { border: none; padding: 0; }
                            table.cstmt-panel { width: 100%; border-collapse: collapse; }
                            table.cstmt-panel td { background-color: #F6F6F6; border: none; padding: 4pt 6pt; vertical-align: top; }
                            table.cstmt-panel .cstmt-label { font-weight: bold; font-size: 7pt; color: #555555; }
                            table.cstmt-panel .cstmt-value { font-size: 8.5pt; }
                            table.cstmt-activity { width: 100%; border-collapse: collapse; }
                            table.cstmt-activity th { text-align: left; padding: 4pt; font-size: 7.5pt; border-bottom: 1pt solid #333333; }
                            table.cstmt-activity td { padding: 4pt; font-size: 7.5pt; vertical-align: top; border: none; }
                            table.cstmt-activity .num { text-align: right; }
                            table.cstmt-activity .cstmt-row-alt td { background-color: #F2F2F2; }
                            table.cstmt-totals { width: 100%; border-collapse: collapse; border: 0.5pt solid #CCCCCC; }
                            table.cstmt-totals td { border: none; padding: 4pt 6pt; font-size: 8pt; }
                            table.cstmt-totals .num { text-align: right; }
                            table.cstmt-totals .cstmt-total-row td { border-top: 1pt solid #333333; padding-top: 6pt; }
                            .cstmt-total-strong { font-weight: bold; font-size: 10pt; }
                            .cstmt-queries { font-weight: bold; font-size: 8pt; margin: 0 0 2pt 0; }
                            table.cstmt-aging { width: 100%; border-collapse: collapse; }
                            table.cstmt-aging th { background-color: #EEEEEE; padding: 4pt; font-size: 7.5pt; }
                            table.cstmt-aging td { padding: 4pt; font-size: 8pt; }
                            table.cstmt-aging .num { text-align: right; }
                        </style>
                    </head>
                    <body footer="cstmtfooter" footer-height="20pt" size="A4" padding="0.5in">
                        ${body}
                    </body>
                </pdf>
            `;

            // xml.trim() strips the leading newline/indentation so <?xml ?> is the first character
            return render.xmlToPdf({xmlString: xml.trim()});
        }

        return {LIB_FX};
    });
