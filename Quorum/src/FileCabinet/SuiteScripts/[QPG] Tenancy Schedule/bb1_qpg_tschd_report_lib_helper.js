/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Shared library (field ids + cascading filter helpers) used by both the
 * Suitelet and its client script.
 *
 * Date        	  Author		        Purpose
 * 08/20/2026     Jared Espineli        Initial Version
 * 08/24/2026     Jared Espineli        Added Export CSV action
 * 08/27/2026     Jared Espineli        Added getFiltersFromParams() to turn the Suitelet's request params into the data lib's filter lists
 * 08/28/2026     Jared Espineli        Fixed As of Date shifting by a day on the report: buildReportUrl now sends DATE
 *                                      fields' local Y/M/D as "YYYY-MM-DD" instead of the Date object's full
 *                                      toString()/timezone text, which re-parsed to the wrong calendar day server-side
 * 08/28/2026     Jared Espineli        Added getMissingRequiredFields() so the client script can block Print PDF/
 *                                      Export CSV and alert the user when a required field (As of Date) is blank
 * 09/02/2026     Jared Espineli        Added Charge Date column (between Review and Months Option), sourced from
 *                                      the Utilised Charges record - PDF only, csv_lib.js keeps its own COLUMNS
 * 09/02/2026     Jared Espineli        Removed the Charge Date column from the PDF - Charge Date is still used
 *                                      internally (data_lib's isSameMonth/charge grouping) to scope the report to
 *                                      the As of Date's month, just no longer printed as its own column
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/search'],
    /**
     * @param{search} search
     */
    (search) => {

        // Column headers for the PDF only - csv_lib.js defines its own
        // COLUMNS for the CSV's separate raw-data column set (see its header
        // comment), so a change here doesn't affect the CSV export.
        const COLUMNS = [
            'Premises', 'Area', 'Units / Parking', 'Tenant', 'Starts', 'Expires',
            'Review', 'Months Option', 'Current Rent', 'Rent Rate', 'Rent Esc%',
            'Other Chargings', 'Description', 'Amount', 'Rate', 'Gross Income',
            'Gross Rate', 'Budget Rate'
        ];

        const MONTH_NAMES = [
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];

        // field/button ids used on the Suitelet form itself
        const _FIELDS = {
            FORM: {
                BUTTON_STYLE:           'custpage_qpg_button_style',
                PRINT_PDF:              'custpage_qpg_print_pdf',
                EXPORT_CSV:             'custpage_qpg_export_csv',
                PROPERTY_PORTFOLIO:     'custpage_qpg_property_portfolio',
                BUILDING:               'customrecord_cseg_bb1_building',
                ACCOMM_TYPE:            'custpage_qpg_accomm_type',
                BLOCK:                  'custpage_qpg_block',
                FLOOR:                  'custpage_qpg_floor',
                UNIT:                   'custpage_qpg_unit',
                AS_OF_DATE:             'custpage_qpg_as_of_date'
            },
            BUILDING: {
                REC_ID: 'customrecord_cseg_bb1_building'
            },
            BLOCK: {
                REC_ID: 'customrecord_cseg_bb1_block',
                FILTERBY_BUILDING: 'cseg_bb1_block_filterby_cseg_bb1_building'
            },
            FLOOR: {
                REC_ID: 'customrecord_cseg_bb1_floor',
                FILTERBY_BLOCK: 'cseg_bb1_floor_filterby_cseg_bb1_block'
            },
            UNIT: {
                REC_ID: 'customrecord_cseg_bb1_unit',
                FILTERBY_FLOOR: 'cseg_bb1_unit_filterby_cseg_bb1_floor'
            }
        }

       //UI fields
        _FIELDS.FILTER_FIELD_IDS = [
            _FIELDS.FORM.PROPERTY_PORTFOLIO,
            _FIELDS.FORM.BUILDING,
            _FIELDS.FORM.ACCOMM_TYPE,
            _FIELDS.FORM.BLOCK,
            _FIELDS.FORM.FLOOR,
            _FIELDS.FORM.UNIT,
            _FIELDS.FORM.AS_OF_DATE
        ];

        // Form fields that must have a value before a report can be generated
        _FIELDS.REQUIRED_FIELD_IDS = [
            _FIELDS.FORM.AS_OF_DATE
        ];

        // Human-readable labels for required field ids, used in the missing-fields alert
        _FIELDS.FIELD_LABELS = {
            [_FIELDS.FORM.AS_OF_DATE]: 'As of Date'
        };

        //button actions
        _FIELDS.ACTION = {
            PARAM: 'custpage_qpg_action',
            PRINT_PDF: 'printpdf',
            EXPORT_CSV: 'exportcsv'
        };

        const LIB_FX = {};

        const pad2 = (n) => String(n).padStart(2, '0');

        //formatting of As of Date value
        LIB_FX.formatAsOfDate = (date) =>
            `${pad2(date.getDate())} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;

        //formatting of the printed date time value
        LIB_FX.formatPrintedTimestamp = (date) => {
            const datePart = `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
            const timePart = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
            return `${datePart} ${timePart}`;
        }

        // Builds the URL for the Print PDF/Export CSV buttons: current filter
        // values plus an action flag. Client-side only (uses window.location).
        LIB_FX.buildReportUrl = (currentRecord, action) => {
            const params = new URLSearchParams(window.location.search);

            _FIELDS.FILTER_FIELD_IDS.forEach((fieldId) => {
                const value = currentRecord.getValue({fieldId: fieldId});
                const isEmpty = value === null || value === '' || (Array.isArray(value) && !value.length);

                if (isEmpty) {
                    params.delete(fieldId);
                    return;
                }

                if (value instanceof Date) {
                    // As of Date - getValue() on a DATE field returns a
                    // Date object. Send the calendar date exactly as
                    // displayed (this browser's local Y/M/D), not
                    // String(value)'s full local timestamp+timezone text -
                    // re-parsing that server-side re-derives Y/M/D in the
                    // SERVER's timezone instead, which can land on a
                    // different calendar day than what was picked.
                    const year = value.getFullYear();
                    const month = String(value.getMonth() + 1).padStart(2, '0');
                    const day = String(value.getDate()).padStart(2, '0');
                    params.set(fieldId, `${year}-${month}-${day}`);
                    return;
                }

                params.set(fieldId, Array.isArray(value) ? value.join(',') : value);
            });

            params.set(_FIELDS.ACTION.PARAM, action);

            return `${window.location.pathname}?${params.toString()}`;
        }

        // Splits a comma-separated request param (as set by buildReportUrl)
        // back into an array of id strings. '' /null/undefined -> [].
        LIB_FX.parseIdListParam = (value) => {
            if (value === null || value === undefined || value === '') return [];
            return String(value).split(',').map((id) => id.trim()).filter(Boolean);
        }

        // Builds the data lib's filters object (see data_lib buildQuery) from
        // the Suitelet's request.parameters - shared by the PDF/CSV builders.
        LIB_FX.getFiltersFromParams = (params) => ({
            portfolioIds: LIB_FX.parseIdListParam(params && params[_FIELDS.FORM.PROPERTY_PORTFOLIO]),
            buildingIds: LIB_FX.parseIdListParam(params && params[_FIELDS.FORM.BUILDING]),
            accommTypeIds: LIB_FX.parseIdListParam(params && params[_FIELDS.FORM.ACCOMM_TYPE]),
            blockIds: LIB_FX.parseIdListParam(params && params[_FIELDS.FORM.BLOCK]),
            floorIds: LIB_FX.parseIdListParam(params && params[_FIELDS.FORM.FLOOR]),
            unitIds: LIB_FX.parseIdListParam(params && params[_FIELDS.FORM.UNIT])
        });

        // Returns the labels of any required fields (see _FIELDS.REQUIRED_FIELD_IDS)
        // left blank on the form. Empty array means all required fields are filled in.
        LIB_FX.getMissingRequiredFields = (currentRecord) => {
            return _FIELDS.REQUIRED_FIELD_IDS
                .filter((fieldId) => {
                    const value = currentRecord.getValue({fieldId: fieldId});
                    return value === null || value === '' || (Array.isArray(value) && !value.length);
                })
                .map((fieldId) => _FIELDS.FIELD_LABELS[fieldId] || fieldId);
        }

        // Clears a multi-select field's value and options
        LIB_FX.clearFieldOptions = (currentRecord, fieldId) => {
            currentRecord.setValue({fieldId: fieldId, value: [], ignoreFieldChange: true});
            currentRecord.getField({fieldId: fieldId}).removeSelectOption({value: null});
        }

        // Populates a multi-select field with the child records of the given parent ids
        LIB_FX.populateChildOptions = (currentRecord, fieldId, recordType, filterFieldId, parentIds) => {
            LIB_FX.clearFieldOptions(currentRecord, fieldId);

            if (!parentIds || !parentIds.length) {
                return;
            }

            const field = currentRecord.getField({fieldId: fieldId});
            search.create({
                type: recordType,
                filters: [[filterFieldId, 'anyof', parentIds]],
                columns: ['name']
            }).run().each((result) => {
                field.insertSelectOption({
                    value: result.id,
                    text: result.getValue({name: 'name'})
                });
                return true;
            });
        }

        return {LIB_FX, _FIELDS, COLUMNS};
    });