/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Pre-Billing - P102843 Quorum NetSuite Implementation
 * Shared library (field ids + cascading filter helpers) used by both the
 * Suitelet and its client script.
 *
 * Date        	  Author		        Purpose
 * 08/26/2026     Jared Espineli        Initial Version
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/search'],
    /**
     * @param{search} search
     */
    (search) => {

        // field/button ids used on the Suitelet form itself
        const _FIELDS = {
            FORM: {
                BUTTON_STYLE:           'custpage_qpg_prebill_button_style',
                PRINT_PDF:              'custpage_qpg_prebill_print_pdf',
                EXPORT_CSV:             'custpage_qpg_prebill_export_csv',
                PROPERTY_PORTFOLIO:     'custpage_qpg_prebill_property_portfolio',
                BUILDING:               'customrecord_cseg_bb1_building',
                ACCOMM_TYPE:            'custpage_qpg_prebill_accomm_type',
                BLOCK:                  'custpage_qpg_prebill_block',
                FLOOR:                  'custpage_qpg_prebill_floor',
                UNIT:                   'custpage_qpg_prebill_unit',
                STATEMENT_DATE:         'custpage_qpg_prebill_statement_date',
                START_DATE:             'custpage_qpg_prebill_start_date'
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
            _FIELDS.FORM.STATEMENT_DATE,
            _FIELDS.FORM.START_DATE
        ];

        //button actions
        _FIELDS.ACTION = {
            PARAM: 'custpage_qpg_prebill_action',
            PRINT_PDF: 'printpdf',
            EXPORT_CSV: 'exportcsv'
        };

        const LIB_FX = {};

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

                params.set(fieldId, Array.isArray(value) ? value.join(',') : value);
            });

            params.set(_FIELDS.ACTION.PARAM, action);

            return `${window.location.pathname}?${params.toString()}`;
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

        return {LIB_FX, _FIELDS};
    });
