/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Shared library of field ids and cascading filter helpers used by the
 * Suitelet and its client script.
 *
 * Date        	  Author		        Purpose
 * 08/20/2026     Jared Espineli        Initial Version
 * 08/24/2026     Jared Espineli        Added Export CSV action.
 * 08/27/2026     Jared Espineli        Added getFiltersFromParams() to build the data lib's filters from Suitelet request params.
 * 08/28/2026     Jared Espineli        Fixed As of Date shifting by a day and added required-field validation.
 * 09/02/2026     Jared Espineli        Added, then removed, a printed PDF Charge Date column, still used internally to scope the report.
 * 09/04/2026     Jared Espineli        Fixed formatPrintedTimestamp to correctly read the account-timezone-shifted date.
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/search'],
    /**
     * @param{search} search
     */
    (search) => {

        // PDF report column headers.
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

        // Field/button ids used on the Suitelet form.
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

        // Fields required before a report can be generated.
        _FIELDS.REQUIRED_FIELD_IDS = [
            _FIELDS.FORM.AS_OF_DATE
        ];

        // Labels for required fields, shown in the missing-fields alert.
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

        // Formats the As of Date value for print.
        LIB_FX.formatAsOfDate = (date) =>
            `${pad2(date.getDate())} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;

        // Formats a timestamp for print. Uses UTC getters since the caller already shifts the
        // Date to the account's timezone.
        LIB_FX.formatPrintedTimestamp = (date) => {
            const datePart = `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
            const timePart = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
            return `${datePart} ${timePart}`;
        }

        // Builds the Print PDF/Export CSV button URL from the current filter values and an action flag.
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
                    // As of Date - send its local Y/M/D as-is rather than a full timestamp string,
                    // which would re-parse to the wrong calendar day in the server's timezone.
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

        // Splits a comma-separated request param into an array of id strings.
        LIB_FX.parseIdListParam = (value) => {
            if (value === null || value === undefined || value === '') return [];
            return String(value).split(',').map((id) => id.trim()).filter(Boolean);
        }

        // Builds the data lib's filters object from the Suitelet's request parameters.
        LIB_FX.getFiltersFromParams = (params) => ({
            portfolioIds: LIB_FX.parseIdListParam(params && params[_FIELDS.FORM.PROPERTY_PORTFOLIO]),
            buildingIds: LIB_FX.parseIdListParam(params && params[_FIELDS.FORM.BUILDING]),
            accommTypeIds: LIB_FX.parseIdListParam(params && params[_FIELDS.FORM.ACCOMM_TYPE]),
            blockIds: LIB_FX.parseIdListParam(params && params[_FIELDS.FORM.BLOCK]),
            floorIds: LIB_FX.parseIdListParam(params && params[_FIELDS.FORM.FLOOR]),
            unitIds: LIB_FX.parseIdListParam(params && params[_FIELDS.FORM.UNIT])
        });

        // Returns the labels of any required fields left blank on the form.
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