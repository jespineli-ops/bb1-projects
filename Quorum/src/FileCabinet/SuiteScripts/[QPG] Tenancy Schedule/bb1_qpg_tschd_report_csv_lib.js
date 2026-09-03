/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Server-only helper library that builds the Tenancy Schedule CSV.
 *
 * Date        	  Author		        Purpose
 * 08/24/2026     Jared Espineli        Initial version - Export CSV button
 * 08/26/2026     Jared Espineli        Sources real data via bb1_qpg_tschd_report_data_lib (getFlatRows), matching the PDF's columns
 * 08/26/2026     Jared Espineli        Amount columns are now fixed to exactly 2 decimal places
 * 08/27/2026     Jared Espineli        Data rows now driven by the Suitelet's Portfolio/Building/Block/Floor/Unit/Accommodation Type filters
 * 08/28/2026     Jared Espineli        Rebuilt around the updated CSV workbook (data lib's getCsvRows/CSV_ROW_COLUMNS) - raw
 *                                      data, one row per Unit, own column set (Building/Tenant address, Occupancy, Bed, etc.),
 *                                      no longer shares COLUMNS with the PDF. Title/printed rows unchanged.
 * 08/28/2026     Jared Espineli        As of Date now drives per-row lease activity, same as the PDF - a unit whose lease
 *                                      isn't active as of that date reads as vacant on its row. As of Date is now parsed
 *                                      with dataLib's DD/MM/YYYY-aware parser instead of plain new Date()
 * 08/28/2026     Jared Espineli        Added 3 new columns from the updated workbook - Future Lease, Tenant ID, Group Tenant
 * 08/28/2026     Jared Espineli        Merged the title row and printed-timestamp row into a single title row (was two
 *                                      separate rows, read as two titles)
 * 09/03/2026     Jared Espineli        Renamed headers: Unit Counter -> Property Rentable Unit Area, Unit Area -> m2,
 *                                      Unit Status -> Status. Building State/Country, Status, Property Portfolio and
 *                                      Accommodation Type now come through as display text, not internal ids (see
 *                                      BUILTIN.DF() additions in data_lib's buildCsvQuery)
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/file', './bb1_qpg_tschd_report_lib_helper', './bb1_qpg_tschd_report_data_lib'],
    /**
     * @param{file} file
     * @param{helperLib} helperLib
     * @param{dataLib} dataLib
     */
    (file, helperLib, dataLib) => {

        const _FIELDS = helperLib._FIELDS;

        // CSV column headers, in dataLib.CSV_ROW_COLUMNS order - the CSV's
        // own raw-data column set (own workbook query), not shared with the
        // PDF's grouped/subtotaled COLUMNS from lib_helper.
        const COLUMNS = [
            'Building', 'Building Address 1', 'Building Address 2', 'Building Zip', 'Building City',
            'Building State', 'Building Country',
            'Property Rentable Unit Area', 'm2', 'Status', 'Property Portfolio', 'Accommodation Type', 'Unit',
            'Occupancy', 'Bed', 'Lease',
            'Future Lease', 'Tenant ID',
            'Tenant', 'Group Tenant', 'Tenant Email', 'Tenant Phone', 'Tenant Address', 'Tenant Address 1', 'Tenant Address 2',
            'Tenant Zip', 'Tenant City', 'Tenant State', 'Tenant Country',
            'Starts', 'Expires', 'Review', 'Months Option', 'Rent Esc%',
            'Current Rent', 'Rent Rate', 'Rate Area Excl VAT', 'Amount', 'Rate', 'Amount Incl VAT',
            'Gross Income', 'Gross Rate', 'Budget Rate'
        ];

        // File Cabinet folder where exported CSVs are saved
        const EXPORT_FOLDER_ID = 1541;

        const LIB_FX = {};

        const csvField = (value) => {
            const text = value === null || value === undefined ? '' : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        }

        const csvRow = (values) => values.map(csvField).join(',');

        // Money columns - kept as plain numbers with exactly 2 decimals (no
        // thousands separator/symbol) so they stay usable as numbers in Excel/Sheets
        const AMOUNT_COLUMNS = [
            'Current Rent', 'Rent Rate', 'Rate Area Excl VAT', 'Amount', 'Rate', 'Amount Incl VAT',
            'Gross Income', 'Gross Rate', 'Budget Rate'
        ];
        const AMOUNT_COLUMN_INDEXES = new Set(AMOUNT_COLUMNS.map((label) => COLUMNS.indexOf(label)));

        const formatDataRow = (values) => values.map((value, index) => {
            if (!AMOUNT_COLUMN_INDEXES.has(index) || value === null || value === undefined || value === '') return value;
            const num = Number(value);
            return isNaN(num) ? value : num.toFixed(2);
        });

        // Column the title/printed text sits in, so it reads centered above the table
        const TITLE_COLUMN_INDEX = Math.floor(COLUMNS.length / 2);

        LIB_FX.buildCsv = (params) => {
            const asOfDateParam = params && params[_FIELDS.FORM.AS_OF_DATE];
            const asOfDate = dataLib.LIB_FX.toDateOnly(asOfDateParam) || new Date();

            const asOfDateText = helperLib.LIB_FX.formatAsOfDate(asOfDate);
            const printedText = helperLib.LIB_FX.formatPrintedTimestamp(new Date());
            const filters = helperLib.LIB_FX.getFiltersFromParams(params);

            const titleRow = COLUMNS.map(() => '');
            titleRow[TITLE_COLUMN_INDEX] = `Tenancy Schedule as of ${asOfDateText} - Printed: ${printedText}`;

            const dataRows = dataLib.LIB_FX.getCsvRows(filters, asOfDate).map(formatDataRow);

            // Single title row (as of date + printed timestamp), then a
            // blank row, column headers, then the raw data rows - one row
            // per Unit, no Property row, no Accommodation Type subtotal rows.
            const rows = [
                titleRow,
                [],
                COLUMNS,
                ...dataRows
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