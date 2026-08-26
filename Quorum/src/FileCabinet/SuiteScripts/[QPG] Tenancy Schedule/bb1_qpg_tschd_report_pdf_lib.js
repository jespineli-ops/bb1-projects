/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Server-only helper library that builds the Tenancy Schedule PDF.
 *
 * Date        	  Author		        Purpose
 * 08/21/2026     Jared Espineli        Initial version - header/logo/column scaffold
 * 08/25/2026     Jared Espineli        Data rows sourced from the workbook query
 * 08/26/2026     Jared Espineli        Added bold Accommodation Type subtotal rows with formatted numbers
 * 08/26/2026     Jared Espineli        Added thin vertical borders between columns
 * 08/26/2026     Jared Espineli        Removed grid lines between detail rows/columns to match reference printout
 * 08/26/2026     Jared Espineli        Removed Current Occupied Area note; boxed Property to its own columns only
 * 08/26/2026     Jared Espineli        Property is now its own table above the main table; total row's top border scoped to Tenant-Budget Rate
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/render', './bb1_qpg_tschd_report_lib_helper', './bb1_qpg_tschd_report_data_lib'],
    /**
     * @param{render} render
     * @param{helperLib} helperLib
     * @param{dataLib} dataLib
     */
    (render, helperLib, dataLib) => {

        const _FIELDS = helperLib._FIELDS;
        // Column headers, shared with the CSV export
        const COLUMNS = helperLib.COLUMNS;

        const LOGO_URL = 'https://11536405.app.netsuite.com/core/media/media.nl?id=4007&c=11536405&h=vMOQpihs6u5R5MQswLAA1sZ5a8h-LvBnXfGPuCx39bSKx6gU';

        const LIB_FX = {};

        const escapeXml = (value) => String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

        const buildHeaderMacro = (asOfDate) => {
            const logoCell = `<img src="${escapeXml(LOGO_URL)}" alt="Company Logo" style="height: 70pt; width: 200pt;" />`;
            const printedText = escapeXml(helperLib.LIB_FX.formatPrintedTimestamp(new Date()));
            const asOfDateText = escapeXml(helperLib.LIB_FX.formatAsOfDate(asOfDate));

            return `
                <macro id="header">
                    <table style="width: 100%; border: 0;">
                        <tr>
                            <td style="width: 30%; vertical-align: middle; border: none;">${logoCell}</td>
                            <td style="width: 40%; vertical-align: middle; border: none;">
                                <table style="width: 100%; border: 0;">
                                    <tr>
                                        <td align="center" style="text-align: center; border: none;">
                                            <span style="font-size: 16pt; font-weight: bold;">Tenancy Schedule</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td align="center" style="text-align: center; border: none;">
                                            <span style="font-size: 9pt; font-weight: normal;">as of ${asOfDateText}</span>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                            <td style="width: 30%; text-align: right; vertical-align: middle; font-size: 8pt; border: none;">
                                Printed: ${printedText}<br/>
                                Page: <pagenumber/>
                            </td>
                        </tr>
                    </table>
                </macro>
            `;
        }

        const buildColumnHeaderRow = () => {
            return COLUMNS.map((label) => `<th align="left">${label}</th>`).join('');
        }

        // Small table with just the "Property" label, placed above the main table
        const buildPropertyTable = () => `
            <table class="tschd-property-table">
                <tr><td>Property</td></tr>
            </table>
        `;

        // Columns shown with thousands separators and 2 decimals
        const NUMERIC_COLUMNS = [
            'Area', 'Current Rent', 'Rent Rate', 'Rent Esc%', 'Amount', 'Rate',
            'Gross Income', 'Gross Rate', 'Budget Rate'
        ];
        const NUMERIC_COLUMN_INDEXES = new Set(NUMERIC_COLUMNS.map((label) => COLUMNS.indexOf(label)));

        const PREMISES_COLUMN_INDEX = COLUMNS.indexOf('Premises');
        const AREA_COLUMN_INDEX = COLUMNS.indexOf('Area');
        const TENANT_COLUMN_INDEX = COLUMNS.indexOf('Tenant');
        const CURRENT_RENT_COLUMN_INDEX = COLUMNS.indexOf('Current Rent');
        const RENT_RATE_COLUMN_INDEX = COLUMNS.indexOf('Rent Rate');
        const AMOUNT_COLUMN_INDEX = COLUMNS.indexOf('Amount');
        const RATE_COLUMN_INDEX = COLUMNS.indexOf('Rate');
        const GROSS_INCOME_COLUMN_INDEX = COLUMNS.indexOf('Gross Income');
        const GROSS_RATE_COLUMN_INDEX = COLUMNS.indexOf('Gross Rate');

        const formatAmount = (value) => {
            if (value === null || value === undefined || value === '') return '';
            const num = Number(value);
            return isNaN(num) ? String(value) : num.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        }

        // Renders one row's <td> cells. borderTop/borderBottom box off the
        // total row; borderTopFromIndex skips the top border on the first
        // few columns (Premises/Area/Units-Parking).
        const buildRowCells = (values, options) => {
            const bold = options && options.bold;
            const borderTop = options && options.borderTop;
            const borderTopFromIndex = (options && options.borderTopFromIndex) || 0;
            const borderBottom = options && options.borderBottom;

            return values.map((value, index) => {
                const display = NUMERIC_COLUMN_INDEXES.has(index) ? formatAmount(value) : (value === null || value === undefined ? '' : value);

                const styleParts = [];
                if (bold) styleParts.push('font-weight: bold;');
                if (borderTop && index >= borderTopFromIndex) styleParts.push('border-top: 0.5pt solid #000000;');
                if (borderBottom) styleParts.push('border-bottom: 0.5pt solid #000000;');
                const style = styleParts.length ? ` style="${styleParts.join(' ')}"` : '';

                return `<td${style}>${escapeXml(display)}</td>`;
            }).join('');
        }

        // Builds one Accommodation Type's total row values, in COLUMNS order
        const buildTotalRowValues = (group) => {
            const values = COLUMNS.map(() => '');
            values[PREMISES_COLUMN_INDEX] = group.accommodationType;
            values[AREA_COLUMN_INDEX] = group.totals.area;
            values[CURRENT_RENT_COLUMN_INDEX] = group.totals.currentRent;
            values[RENT_RATE_COLUMN_INDEX] = group.totals.rentRate;
            values[AMOUNT_COLUMN_INDEX] = group.totals.amount;
            values[RATE_COLUMN_INDEX] = group.totals.rate;
            values[GROSS_INCOME_COLUMN_INDEX] = group.totals.grossIncome;
            values[GROSS_RATE_COLUMN_INDEX] = group.totals.grossRate;
            return values;
        }

        // Each Accommodation Type prints its total row first, then its units' charge rows
        const buildDataRows = () => {
            const groups = dataLib.LIB_FX.getAccommodationGroups();

            if (!groups.length) {
                return `
                    <tr>
                        <td colspan="${COLUMNS.length}" style="text-align: center; font-style: italic; color: #666666;">
                            No records found
                        </td>
                    </tr>
                `;
            }

            return groups.map((group) => {
                const totalRow = `<tr>${buildRowCells(buildTotalRowValues(group), {bold: true, borderTop: true, borderTopFromIndex: TENANT_COLUMN_INDEX, borderBottom: true})}</tr>`;
                const detailRows = group.rows.map((row) => `<tr>${buildRowCells(row)}</tr>`).join('');
                return totalRow + detailRows;
            }).join('');
        }

        LIB_FX.buildPdf = (params) => {
            const asOfDateParam = params && params[_FIELDS.FORM.AS_OF_DATE];
            const parsedAsOfDate = asOfDateParam ? new Date(asOfDateParam) : null;
            const asOfDate = (parsedAsOfDate && !isNaN(parsedAsOfDate.getTime())) ? parsedAsOfDate : new Date();

            const xml = `
                <?xml version="1.0"?>
                <!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
                <pdf>
                    <head>
                        <macrolist>
                            ${buildHeaderMacro(asOfDate)}
                        </macrolist>
                        <style>
                            * { font-family: Arial, Helvetica, sans-serif; }
                            table.tschd-property-table {
                                font-size: 6pt;
                                width: 17%;
                                border-collapse: collapse;
                                margin: 0;
                            }
                            table.tschd-property-table td {
                                padding: 3pt;
                                border: 0.5pt solid #000000;
                            }
                            table.tschd-table {
                                font-size: 6pt;
                                width: 100%;
                                border-collapse: collapse;
                                border: 0.5pt solid #000000;
                                margin: 0;
                            }
                            table.tschd-table th {
                                background-color: #FFF9C4;
                                color: #000000;
                                font-weight: bold;
                                padding: 3pt;
                                border-bottom: 0.5pt solid #000000;
                                border-right: 0.5pt solid #000000;
                                text-align: right;
                            }
                            table.tschd-table td {
                                padding: 3pt;
                                border-right: 0.5pt solid #000000;
                            }
                        </style>
                    </head>
                    <body header="header" header-height="70pt" size="A4-landscape" padding="0.4in 0.3in 0.4in 0.3in">
                        ${buildPropertyTable()}
                        <table class="tschd-table">
                            <tr>${buildColumnHeaderRow()}</tr>
                            ${buildDataRows()}
                        </table>
                    </body>
                </pdf>
            `;

            // xml.trim() strips the leading newline/indentation so <?xml ?> is the first character

            return render.xmlToPdf({xmlString: xml.trim()});
        }

        return {LIB_FX};
    });