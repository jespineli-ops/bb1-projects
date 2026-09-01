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
 * 08/26/2026     Jared Espineli        Removed total row's top border - reference printout has no line above Accommodation Type totals
 * 08/26/2026     Jared Espineli        Added grand Property Totals row at the end of the table (Vacancy/Occupancy TBD)
 * 08/26/2026     Jared Espineli        Added top border above Property Totals; added Total Vacancy/Occupancy and boxed Grand Totals blocks (values still blank)
 * 08/26/2026     Jared Espineli        Property Totals block no longer bold; boxed blank rows (double border) around the bold Grand Totals block
 * 08/27/2026     Jared Espineli        Data rows now driven by the Suitelet's Portfolio/Building/Block/Floor/Unit/Accommodation Type filters
 * 08/27/2026     Jared Espineli        Total Vacancy/Total Occupancy rows now computed (were blank placeholders)
 * 08/28/2026     Jared Espineli        Totals rows' Units/Parking column now mirrors their Area column, rounded to a whole number
 * 08/28/2026     Jared Espineli        As of Date now drives per-row lease activity too (was Vacancy/Occupancy totals only) -
 *                                      a unit whose lease isn't active as of that date reads as vacant on its own row. As of
 *                                      Date is now parsed with dataLib's DD/MM/YYYY-aware parser instead of plain new Date()
 * 08/28/2026     Jared Espineli        Updated header logo image
 * 08/28/2026     Jared Espineli        Added N/log module (was referenced without being required, throwing ReferenceError
 *                                      and breaking Print PDF entirely)
 * 08/31/2026     Jared Espineli        Fixed wrapped column header labels rendering with stretched letter spacing (BFO
 *                                      justifies wrapped <th> text by default; header labels now wrap in a left-aligned
 *                                      <p>); shrank header logo so it no longer overlaps the table header
 * 09/01/2026     Jared Espineli        No code change here, but the Gross Income/Gross Rate figures this file prints are
 *                                      now computed per Utilised Date sub-group within a unit, not once for the whole
 *                                      unit - see dataLib's getAccommodationGroups. A unit with charges on 2+ dates now
 *                                      prints 2+ Gross Income/Gross Rate lines (one per date) instead of just one
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/render', 'N/log', './bb1_qpg_tschd_report_lib_helper', './bb1_qpg_tschd_report_data_lib'],
    /**
     * @param{render} render
     * @param{log} log
     * @param{helperLib} helperLib
     * @param{dataLib} dataLib
     */
    (render, log, helperLib, dataLib) => {

        const _FIELDS = helperLib._FIELDS;
        // Column headers, shared with the CSV export
        const COLUMNS = helperLib.COLUMNS;

        const LOGO_URL = 'https://11536405.app.netsuite.com/core/media/media.nl?id=5938&c=11536405&h=o2lyIWhKdtb1Pjd2xEoKj_QwbZPiBE_YLqECGFCBBI2rNiTs';

        const LIB_FX = {};

        const escapeXml = (value) => String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

        const buildHeaderMacro = (asOfDate) => {
            const logoCell = `<img src="${escapeXml(LOGO_URL)}" alt="Company Logo" style="height: 55pt; width: 157pt;" />`;
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

        // BFO (the PDF renderer behind render.xmlToPdf) wraps <th>/<td> content
        // in an internally-justified block by default, so a wrapped header
        // label's non-last line gets stretched to fill the column width -
        // with only one word on that line, the stretch shows as letter
        // spacing (e.g. "G r o s s" above "Income"). Explicitly wrapping the
        // label in its own left-aligned <p> overrides that default.
        const buildColumnHeaderRow = () => {
            return COLUMNS.map((label) => `<th><p style="text-align: left; margin: 0;">${escapeXml(label)}</p></th>`).join('');
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
        const UNITS_PARKING_COLUMN_INDEX = COLUMNS.indexOf('Units / Parking');
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

        // Total rows' Units/Parking column mirrors their Area column, rounded
        // to a whole number (Units/Parking column isn't in NUMERIC_COLUMNS,
        // so this whole-number value prints as-is, with no decimals).
        const toWholeNumber = (value) => {
            if (value === null || value === undefined || value === '') return '';
            const num = Number(value);
            return isNaN(num) ? '' : Math.round(num);
        }

        // Renders one row's <td> cells. borderTop/borderBottom box off total/summary rows.
        const buildRowCells = (values, options) => {
            const bold = options && options.bold;
            const borderTop = options && options.borderTop;
            const borderBottom = options && options.borderBottom;

            return values.map((value, index) => {
                const display = NUMERIC_COLUMN_INDEXES.has(index) ? formatAmount(value) : (value === null || value === undefined ? '' : value);

                const styleParts = [];
                if (bold) styleParts.push('font-weight: bold;');
                if (borderTop) styleParts.push('border-top: 0.5pt solid #000000;');
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
            values[UNITS_PARKING_COLUMN_INDEX] = toWholeNumber(group.totals.area);
            values[CURRENT_RENT_COLUMN_INDEX] = group.totals.currentRent;
            values[RENT_RATE_COLUMN_INDEX] = group.totals.rentRate;
            values[AMOUNT_COLUMN_INDEX] = group.totals.amount;
            values[RATE_COLUMN_INDEX] = group.totals.rate;
            values[GROSS_INCOME_COLUMN_INDEX] = group.totals.grossIncome;
            values[GROSS_RATE_COLUMN_INDEX] = group.totals.grossRate;
            return values;
        }

        // Builds a "Property Totals"/"Grand Totals" row's values, in COLUMNS
        // order. Tenant column defaults to a literal "100%" (not computed).
        const buildTotalsRowValues = (label, propertyTotals) => {
            const values = COLUMNS.map(() => '');
            values[PREMISES_COLUMN_INDEX] = label;
            values[AREA_COLUMN_INDEX] = propertyTotals.area;
            values[UNITS_PARKING_COLUMN_INDEX] = toWholeNumber(propertyTotals.area);
            values[TENANT_COLUMN_INDEX] = '100%';
            values[CURRENT_RENT_COLUMN_INDEX] = propertyTotals.currentRent;
            values[RENT_RATE_COLUMN_INDEX] = propertyTotals.rentRate;
            values[AMOUNT_COLUMN_INDEX] = propertyTotals.amount;
            values[RATE_COLUMN_INDEX] = propertyTotals.rate;
            values[GROSS_INCOME_COLUMN_INDEX] = propertyTotals.grossIncome;
            values[GROSS_RATE_COLUMN_INDEX] = propertyTotals.grossRate;
            return values;
        }

        // Builds the "Total Vacancy" row's values - Area column is the count
        // of units without an active lease contract, Tenant column is that
        // count as a % of Property Totals' Area (rounded to 2 decimals).
        const buildVacancyRowValues = (propertyTotals) => {
            const values = COLUMNS.map(() => '');
            values[PREMISES_COLUMN_INDEX] = 'Total Vacancy';
            values[AREA_COLUMN_INDEX] = propertyTotals.vacancyArea;
            values[UNITS_PARKING_COLUMN_INDEX] = toWholeNumber(propertyTotals.vacancyArea);
            values[TENANT_COLUMN_INDEX] = propertyTotals.vacancyPercent === null ? '' : `${formatAmount(propertyTotals.vacancyPercent)}%`;
            return values;
        }

        // Builds the "Total Occupancy" row's values - Area column is the
        // count of units with an active lease contract, Tenant column is
        // Property Totals' Area minus the Total Vacancy count.
        const buildOccupancyRowValues = (propertyTotals) => {
            const values = COLUMNS.map(() => '');
            values[PREMISES_COLUMN_INDEX] = 'Total Occupancy';
            values[AREA_COLUMN_INDEX] = propertyTotals.occupancyArea;
            values[UNITS_PARKING_COLUMN_INDEX] = toWholeNumber(propertyTotals.occupancyArea);
            values[TENANT_COLUMN_INDEX] = propertyTotals.occupancyTenant;
            return values;
        }

        // Each Accommodation Type prints its total row first, then its units'
        // charge rows. After every group: a Property Totals/Total Vacancy/
        // Total Occupancy block (not bold), a boxed blank row, then a bold
        // Grand Totals/Total Vacancy/Total Occupancy block, then another
        // boxed blank row.
        const buildDataRows = (filters, asOfDate) => {
            const groups = dataLib.LIB_FX.getAccommodationGroups(filters, asOfDate);

            if (!groups.length) {
                return `
                    <tr>
                        <td colspan="${COLUMNS.length}" style="text-align: center; font-style: italic; color: #666666;">
                            No records found
                        </td>
                    </tr>
                `;
            }

            const groupRows = groups.map((group) => {
                const totalRow = `<tr>${buildRowCells(buildTotalRowValues(group), {bold: true, borderBottom: true})}</tr>`;
                const detailRows = group.rows.map((row) => `<tr>${buildRowCells(row)}</tr>`).join('');
                return totalRow + detailRows;
            }).join('');

            const propertyTotals = dataLib.LIB_FX.getPropertyTotals(groups);

            // Blank row with both borders set - reads as a double line, boxing
            // off the Grand Totals block from what's above/below it.
            const boxedBlankRow = `<tr>${buildRowCells(COLUMNS.map(() => ''), {borderTop: true, borderBottom: true})}</tr>`;

            const propertyTotalsRow = `<tr>${buildRowCells(buildTotalsRowValues('Property Totals', propertyTotals), {borderTop: true})}</tr>`;
            const totalVacancyRow = `<tr>${buildRowCells(buildVacancyRowValues(propertyTotals))}</tr>`;
            const totalOccupancyRow = `<tr>${buildRowCells(buildOccupancyRowValues(propertyTotals))}</tr>`;

            const grandTotalsRow = `<tr>${buildRowCells(buildTotalsRowValues('Grand Totals', propertyTotals), {bold: true})}</tr>`;
            const grandTotalVacancyRow = `<tr>${buildRowCells(buildVacancyRowValues(propertyTotals), {bold: true})}</tr>`;
            const grandTotalOccupancyRow = `<tr>${buildRowCells(buildOccupancyRowValues(propertyTotals), {bold: true})}</tr>`;

            return groupRows
                + propertyTotalsRow + totalVacancyRow + totalOccupancyRow
                + boxedBlankRow
                + grandTotalsRow + grandTotalVacancyRow + grandTotalOccupancyRow
                + boxedBlankRow;
        }

        LIB_FX.buildPdf = (params) => {
            const asOfDateParam = params && params[_FIELDS.FORM.AS_OF_DATE];
            log.debug('asOfDateParam', asOfDateParam);
            const asOfDate = dataLib.LIB_FX.toDateOnly(asOfDateParam) || new Date();
            const filters = helperLib.LIB_FX.getFiltersFromParams(params);

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
                                text-align: left;
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
                            ${buildDataRows(filters, asOfDate)}
                        </table>
                    </body>
                </pdf>
            `;

            // xml.trim() strips the leading newline/indentation so <?xml ?> is the first character

            return render.xmlToPdf({xmlString: xml.trim()});
        }

        return {LIB_FX};
    });