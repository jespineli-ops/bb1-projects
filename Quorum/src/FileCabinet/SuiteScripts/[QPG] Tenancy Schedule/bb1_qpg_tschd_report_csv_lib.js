/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Server-only helper library that builds the Tenancy Schedule CSV.
 *
 * Date        	  Author		        Purpose
 * 08/24/2026     Jared Espineli        Initial version - Export CSV button
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/file', './bb1_qpg_tschd_report_lib_helper'],
    /**
     * @param{file} file
     * @param{helperLib} helperLib
     */
    (file, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        // Column headers, left to right - shared with the PDF export so both
        // outputs mirror each other's layout.
        const COLUMNS = helperLib.COLUMNS;

        //File Cabinet folder where files will be esaved
        const EXPORT_FOLDER_ID = 1541;

        const LIB_FX = {};

        const csvField = (value) => {
            const text = value === null || value === undefined ? '' : String(value);
            return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        }

        const csvRow = (values) => values.map(csvField).join(',');

        // Title row's "Tenancy Schedule as of <date>" text sits in the middle
        // column of the Review..Rent Esc% range (columns 7-11, 1-indexed) so
        // it reads centered above the data table.
        const TITLE_COLUMN_INDEX = 8;

        LIB_FX.buildCsv = (params) => {
            const asOfDateParam = params && params[_FIELDS.FORM.AS_OF_DATE];
            const parsedAsOfDate = asOfDateParam ? new Date(asOfDateParam) : null;
            const asOfDate = (parsedAsOfDate && !isNaN(parsedAsOfDate.getTime())) ? parsedAsOfDate : new Date();

            const asOfDateText = helperLib.LIB_FX.formatAsOfDate(asOfDate);
            const printedText = helperLib.LIB_FX.formatPrintedTimestamp(new Date());

            const titleRow = COLUMNS.map(() => '');
            titleRow[TITLE_COLUMN_INDEX] = `Tenancy Schedule as of ${asOfDateText}`;

            const printedRow = COLUMNS.map(() => '');
            printedRow[TITLE_COLUMN_INDEX] = `Printed: ${printedText}`;

            // Mirrors the PDF's header block, property row, column header row
            // and (currently placeholder) data row.
            const rows = [
                titleRow,
                printedRow,
                [],
                ['Property'],
                COLUMNS,
                COLUMNS.map(() => '')
            ];

            const contents = rows.map(csvRow).join('\n');

            return file.create({
                name: `Tenancy Schedule ${asOfDateText}.csv`,
                fileType: file.Type.CSV,
                contents: contents,
                folder: EXPORT_FOLDER_ID
            });
        }

        return {LIB_FX};
    });
