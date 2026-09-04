/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library that renders the Generate Statement Suitelet's PDF -
 * one merged PDF covering every customer marked in the Customer List, each
 * as its own page (separated by a page break). Builds the header (logo,
 * Entity/Property panel, customer block), the statement date/from/for-the-
 * month line, the AR activity table, the totals block, and a Queries/
 * aging-days strip - matching "Tenant Statements - Commercial.pdf" up to
 * the aging strip; everything after that is dropped in favour of a plain
 * page number, per spec.
 *
 * Date                 Author              Purpose
 * 03-September-2026    Jared Espineli      Initial Release - header section (logo, Entity/Property panel,
 *                                          customer block); fixed the logo's aspect ratio and wrapped-label
 *                                          letter-spacing rendering bugs.
 * 04-September-2026    Jared Espineli      Iterated the Entity/Property panel layout (stacked, then back to a
 *                                          plain 4-column grid) to fix rendering bugs, added the rest of the
 *                                          statement (meta line, activity table, totals, queries/aging),
 *                                          restyled the activity table/totals to match the reference design, and
 *                                          split buildPdf into buildCustomerPageXml/wrapPagesAsPdf so gts_mr.js
 *                                          could generate pages per customer in the background.
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

        // File Cabinet URL of the Quorum logo used on the tenant statement (not the Tenancy Schedule report's
        // wordmark logo). Escape any & in this URL as &amp; if it's ever changed.
        const LOGO_URL = 'https://11536405.app.netsuite.com/core/media/media.nl' +
            '?id=5936&amp;c=11536405' +
            '&amp;h=ShdVNtHtCNZxRziqz5XaCmH8XthcQqu1MScOaMoTvGlWj9lm';

        // Logo size in points - BFO ignores CSS pixel widths and falls back to native size unless both
        // dimensions are given. Actual asset ratio is ~2.78:1 landscape; keep that ratio if resized.
        const LOGO_WIDTH_PT = 180;
        const LOGO_HEIGHT_PT = 65;

        // Queries panel shown bottom-left of the statement, next to the aging strip.
        const QUERIES_EMAIL = 'commercial@qholdings.co.za';
        const QUERIES_WHATSAPP = '082 400 3693';

        const LIB_FX = {};

        //-----------------------------------------------
        //Formatting helpers
        //-----------------------------------------------

        // Escape record data before it reaches the BFO document - BFO parses strict XML, so an unescaped
        // ampersand/quote in an address or memo would fail the whole render.
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
        //Header section - logo + title + customer block
        //left, Entity/Property panel right
        //-----------------------------------------------

        // One label/value cell pair in the Entity/Property panel's 4-column grid - colspan merges a row with
        // only one pair across the remaining columns. Content is wrapped in a left-aligned <p> since BFO
        // justifies wrapped <td> text by default.
        const panelCell = (label, value, colspan) => {
            const span = colspan ? ` colspan="${colspan}"` : '';
            const valueWidth = colspan ? '' : ' style="width: 20%;"';
            return `<td class="cstmt-label" style="width: 30%;"><p style="text-align: left; margin: 0;">${escapeXml(label)}</p></td>` +
                `<td class="cstmt-value"${span}${valueWidth}><p style="text-align: left; margin: 0;">${escapeXml(value)}</p></td>`;
        }

        // Three full-width rows then three two-up rows, matching the reference design's layout. Registration
        // No. labels are shortened to fit the narrow label column on one line, avoiding a BFO wrap/row-overlap
        // quirk.
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
        //Statement date/from/for-the-month line - replaces
        //"Tax Invoice No." with "From" (the Start Date)
        //-----------------------------------------------
        const buildMetaLine = (statement) => `
            <p class="cstmt-meta">
                Statement Date: <span class="cstmt-meta-value">${escapeXml(statement.statementDate)}</span>&nbsp;&nbsp;&nbsp;&nbsp;
                From: <span class="cstmt-meta-value">${escapeXml(statement.startDate)}</span>&nbsp;&nbsp;&nbsp;&nbsp;
                For the Month: <span class="cstmt-meta-value">${escapeXml(statement.billingMonth)}</span>
            </p>
        `;

        //-----------------------------------------------
        //AR activity table - row/column shape adapted from
        //the POC, matching the reference design's 6-column
        //header (no Document column)
        //-----------------------------------------------

        // Activity table's own column widths - shared with buildTotalsSection below so its Exclusive/Tax/
        // Inclusive columns line up exactly under these ones.
        const COL_DATE = 12;
        const COL_ALLOCATION = 18;
        const COL_REMARKS = 40;
        const COL_NUM = 10; // Exclusive / Tax / Inclusive, each

        // Left-aligned text cells go through their own <p> to avoid BFO's default wrapped-<td> justification.
        // Numeric cells never wrap, so they rely on the .num class's text-align: right directly.
        const textCell = (value) => `<td><p style="text-align: left; margin: 0;">${escapeXml(value)}</p></td>`;
        const numCell = (value) => `<td class="num">${value}</td>`;

        // One rendered row - rowIndex drives zebra striping and continues seamlessly across statement.rows
        // boundaries. See flattenActivityRows, which flattens everything into one list first so the stripe
        // never resets mid-invoice.
        const activityRow = (entry, rowIndex) => {
            const rowClass = rowIndex % 2 === 1 ? ' class="cstmt-row-alt"' : '';
            return `<tr${rowClass}>${textCell(entry.date)}${textCell(entry.allocation)}${textCell(entry.remarks)}` +
                `${numCell(entry.exclusive)}${numCell(entry.tax)}${numCell(entry.inclusive)}</tr>`;
        }

        // Flattens statement.rows (+ nested .lines) into one plain list of row entries, in display order. An
        // invoice's own transaction-level row is suppressed in favour of its item lines; Balance B/f has no
        // document number or date/tax breakdown since it's a synthetic aggregate.
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
        //Totals block matching the reference screenshot's
        //Arrears/Current Month Charges/Amount Due box - its
        //own columns line up under the activity table's
        //(see COL_* above)
        //-----------------------------------------------
        const buildTotalsSection = (statement, symbol) => {
            // The totals box occupies Remarks + the 3 numeric columns (70% of the page). Its label/numeric
            // column shares reuse the same 4:1:1:1 ratio as the activity table, re-based to the box's own 100%.
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
        //Queries + aging strip - last section shown;
        //everything the reference design prints after this
        //is dropped in favour of a plain page-number footer
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

        // One marked customer's page - a bad id/query failure prints a short error page instead of taking the
        // whole merged PDF down. Exported so gts_mr.js's map stage can build one customer's page per map key.
        LIB_FX.buildCustomerPageXml = (customerId, filters) => {
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

        // Merges already-built customer pages into one PDF, separated by a page break, in the order given.
        // Extracted out of buildPdf so gts_mr.js's summarize stage can do this same final merge on its own.
        LIB_FX.wrapPagesAsPdf = (pages) => {
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

        // Builds the merged PDF straight from request params - one page per marked customer, in marked order.
        // No longer called from gts_sl.js; kept as a convenience wrapper around buildCustomerPageXml/wrapPagesAsPdf.
        LIB_FX.buildPdf = (params) => {
            const customerIds = helperLib.LIB_FX.parseIdListParam(params && params[_FIELDS.ACTION.CUSTOMER_IDS]);

            const filters = {
                startDate: params && params[_FIELDS.FORM.START_DATE],
                statementDate: params && params[_FIELDS.FORM.STATEMENT_DATE],
                rollup: !(params && params[_FIELDS.FORM.ROLL_PRIOR_CHARGES] === 'F')
            };

            const pages = customerIds.map((customerId) => LIB_FX.buildCustomerPageXml(customerId, filters));
            return LIB_FX.wrapPagesAsPdf(pages);
        }

        return {LIB_FX};
    });
