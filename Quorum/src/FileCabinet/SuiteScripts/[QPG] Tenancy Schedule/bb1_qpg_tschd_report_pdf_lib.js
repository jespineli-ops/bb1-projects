/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Server-only helper library that builds the Tenancy Schedule PDF - header/logo, column layout,
 * data rows, subtotals, totals rows, and styling.
 *
 * Date        	  Author		        Purpose
 * 08/21/2026     Jared Espineli        Initial version - header/logo/column scaffold.
 * 08/25/2026     Jared Espineli        Data rows sourced from the workbook query.
 * 08/26/2026     Jared Espineli        Added Accommodation Type subtotals and a Grand/Property Totals/Vacancy/Occupancy block, matching the reference printout.
 * 08/27/2026     Jared Espineli        Data rows now driven by the Suitelet's filters, with Total Vacancy/Occupancy now computed instead of blank.
 * 08/28/2026     Jared Espineli        Totals rows' Units/Parking now mirrors Area, As of Date drives lease activity, the header logo was updated, and a missing N/log import was fixed.
 * 08/31/2026     Jared Espineli        Fixed wrapped header labels' stretched letter spacing and shrank the header logo.
 * 09/02/2026     Jared Espineli        Added, then removed, a Charge Date column (no code changes either time).
 * 09/03/2026     Jared Espineli        Fixed Total Occupancy's Tenant column printing a placeholder instead of a percentage.
 * 09/04/2026     Jared Espineli        Rent Esc% now prints correctly, "Printed:" reflects the account's timezone, the header row repeats per page, and each Building now prints its own name row and Totals/Vacancy/Occupancy block.
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

        // South Africa Standard Time offset (UTC+2, no daylight saving).
        const SAST_OFFSET_MINUTES = 120;

        // Shifts a date to South African time.
        const toSouthAfricanTime = (date) => new Date(date.getTime() + (SAST_OFFSET_MINUTES * 60000));

        // Column headers.
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
            const printedText = escapeXml(helperLib.LIB_FX.formatPrintedTimestamp(toSouthAfricanTime(new Date())));
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

        // Builds the table's column header row.
        const buildColumnHeaderRow = () => {
            return COLUMNS.map((label) => `<th><p style="text-align: left; margin: 0;">${escapeXml(label)}</p></th>`).join('');
        }

        // Fallback label for a Unit not linked to a Floor/Block/Building.
        const UNASSIGNED_BUILDING_LABEL = '(No Building)';

        // Builds a Building's name row, printed above its Accommodation Types.
        const buildBuildingHeaderRow = (buildingName) => {
            const values = COLUMNS.map(() => '');
            values[PREMISES_COLUMN_INDEX] = buildingName || UNASSIGNED_BUILDING_LABEL;
            return `<tr>${buildRowCells(values, {bold: true})}</tr>`;
        }

        // Columns shown with thousands separators and 2 decimals.
        const NUMERIC_COLUMNS = [
            'Area', 'Current Rent', 'Rent Rate', 'Amount', 'Rate',
            'Gross Income', 'Gross Rate', 'Budget Rate'
        ];
        const NUMERIC_COLUMN_INDEXES = new Set(NUMERIC_COLUMNS.map((label) => COLUMNS.indexOf(label)));

        const PREMISES_COLUMN_INDEX = COLUMNS.indexOf('Premises');
        const AREA_COLUMN_INDEX = COLUMNS.indexOf('Area');
        const UNITS_PARKING_COLUMN_INDEX = COLUMNS.indexOf('Units / Parking');
        const TENANT_COLUMN_INDEX = COLUMNS.indexOf('Tenant');
        const CURRENT_RENT_COLUMN_INDEX = COLUMNS.indexOf('Current Rent');
        const RENT_RATE_COLUMN_INDEX = COLUMNS.indexOf('Rent Rate');
        const RENT_ESC_COLUMN_INDEX = COLUMNS.indexOf('Rent Esc%');
        const AMOUNT_COLUMN_INDEX = COLUMNS.indexOf('Amount');
        const RATE_COLUMN_INDEX = COLUMNS.indexOf('Rate');
        const GROSS_INCOME_COLUMN_INDEX = COLUMNS.indexOf('Gross Income');
        const GROSS_RATE_COLUMN_INDEX = COLUMNS.indexOf('Gross Rate');

        const formatAmount = (value) => {
            if (value === null || value === undefined || value === '') return '';
            const num = Number(value);
            return isNaN(num) ? String(value) : num.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        }

        // Formats a fraction as a percentage string (e.g. "8.00%").
        const formatPercent = (value) => {
            if (value === null || value === undefined || value === '') return '';
            const num = Number(value);
            if (isNaN(num)) return '';
            const formatted = formatAmount(num * 100);
            return formatted === '' ? '' : `${formatted}%`;
        }

        // Rounds a number to the nearest whole number.
        const toWholeNumber = (value) => {
            if (value === null || value === undefined || value === '') return '';
            const num = Number(value);
            return isNaN(num) ? '' : Math.round(num);
        }

        // Renders one row's <td> cells.
        const buildRowCells = (values, options) => {
            const bold = options && options.bold;
            const borderTop = options && options.borderTop;
            const borderBottom = options && options.borderBottom;

            return values.map((value, index) => {
                const display = index === RENT_ESC_COLUMN_INDEX ? formatPercent(value)
                    : NUMERIC_COLUMN_INDEXES.has(index) ? formatAmount(value)
                    : (value === null || value === undefined ? '' : value);

                const styleParts = [];
                if (bold) styleParts.push('font-weight: bold;');
                if (borderTop) styleParts.push('border-top: 0.5pt solid #000000;');
                if (borderBottom) styleParts.push('border-bottom: 0.5pt solid #000000;');
                const style = styleParts.length ? ` style="${styleParts.join(' ')}"` : '';

                return `<td${style}>${escapeXml(display)}</td>`;
            }).join('');
        }

        // Builds one Accommodation Type's total row values.
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

        // Builds a "Property Totals"/"Grand Totals" row's values.
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

        // Builds the "Total Vacancy" row's values.
        const buildVacancyRowValues = (propertyTotals) => {
            const values = COLUMNS.map(() => '');
            values[PREMISES_COLUMN_INDEX] = 'Total Vacancy';
            values[AREA_COLUMN_INDEX] = propertyTotals.vacancyArea;
            values[UNITS_PARKING_COLUMN_INDEX] = toWholeNumber(propertyTotals.vacancyArea);
            values[TENANT_COLUMN_INDEX] = propertyTotals.vacancyPercent === null ? '' : `${formatAmount(propertyTotals.vacancyPercent)}%`;
            return values;
        }

        // Builds the "Total Occupancy" row's values.
        const buildOccupancyRowValues = (propertyTotals) => {
            const values = COLUMNS.map(() => '');
            values[PREMISES_COLUMN_INDEX] = 'Total Occupancy';
            values[AREA_COLUMN_INDEX] = propertyTotals.occupancyArea;
            values[UNITS_PARKING_COLUMN_INDEX] = toWholeNumber(propertyTotals.occupancyArea);
            values[TENANT_COLUMN_INDEX] = propertyTotals.occupancyPercent === null ? '' : `${formatAmount(propertyTotals.occupancyPercent)}%`;
            return values;
        }

        // Builds all data rows: each Building's sections, then the Grand Totals block.
        const buildDataRows = (filters, asOfDate) => {
            const propertyGroups = dataLib.LIB_FX.getPropertyGroups(filters, asOfDate);

            if (!propertyGroups.length) {
                return `
                    <tr>
                        <td colspan="${COLUMNS.length}" style="text-align: center; font-style: italic; color: #666666;">
                            No records found
                        </td>
                    </tr>
                `;
            }

            // Blank boxed row separating totals blocks.
            const boxedBlankRow = `<tr>${buildRowCells(COLUMNS.map(() => ''), {borderTop: true, borderBottom: true})}</tr>`;

            const buildingSections = propertyGroups.map((property) => {
                const buildingHeaderRow = buildBuildingHeaderRow(property.building);

                const groupRows = property.accommodationGroups.map((group) => {
                    const totalRow = `<tr>${buildRowCells(buildTotalRowValues(group), {bold: true, borderBottom: true})}</tr>`;
                    const detailRows = group.rows.map((row) => `<tr>${buildRowCells(row)}</tr>`).join('');
                    return totalRow + detailRows;
                }).join('');

                const propertyTotalsRow = `<tr>${buildRowCells(buildTotalsRowValues('Property Totals', property.totals), {borderTop: true})}</tr>`;
                const totalVacancyRow = `<tr>${buildRowCells(buildVacancyRowValues(property.totals))}</tr>`;
                const totalOccupancyRow = `<tr>${buildRowCells(buildOccupancyRowValues(property.totals))}</tr>`;

                return buildingHeaderRow + groupRows + propertyTotalsRow + totalVacancyRow + totalOccupancyRow;
            }).join('');

            const grandTotals = dataLib.LIB_FX.getPropertyTotals(propertyGroups);

            const grandTotalsRow = `<tr>${buildRowCells(buildTotalsRowValues('Grand Totals', grandTotals), {bold: true})}</tr>`;
            const grandTotalVacancyRow = `<tr>${buildRowCells(buildVacancyRowValues(grandTotals), {bold: true})}</tr>`;
            const grandTotalOccupancyRow = `<tr>${buildRowCells(buildOccupancyRowValues(grandTotals), {bold: true})}</tr>`;

            return buildingSections
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
                        <table class="tschd-table">
                            <thead>
                                <tr>${buildColumnHeaderRow()}</tr>
                            </thead>
                            <tbody>
                                ${buildDataRows(filters, asOfDate)}
                            </tbody>
                        </table>
                    </body>
                </pdf>
            `;

            // Trim so <?xml ?> is the first character.
            return render.xmlToPdf({xmlString: xml.trim()});
        }

        return {LIB_FX};
    });