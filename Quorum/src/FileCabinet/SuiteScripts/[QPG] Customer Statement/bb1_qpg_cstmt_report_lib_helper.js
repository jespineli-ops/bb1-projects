/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 * Shared library (field ids + cascading filter helpers) used by both the
 * Suitelet and its client script.
 *
 * Date        	  Author		        Purpose
 * 09/01/2026     Jared Espineli        Initial Version - UI scaffold, modelled on the Pre-Billing/Tenancy
 *                                      Schedule Suitelets. Print PDF action is stubbed - report content not
 *                                      yet scoped.
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
                BUTTON_STYLE:           'custpage_qpg_cstmt_button_style',
                PRINT_PDF:              'custpage_qpg_cstmt_print_pdf',
                PROPERTY_PORTFOLIO:     'custpage_qpg_cstmt_property_portfolio',
                BUILDING:               'customrecord_cseg_bb1_building',
                ACCOMM_TYPE:            'custpage_qpg_cstmt_accomm_type',
                BLOCK:                  'custpage_qpg_cstmt_block',
                FLOOR:                  'custpage_qpg_cstmt_floor',
                UNIT:                   'custpage_qpg_cstmt_unit',
                STATEMENT_DATE:         'custpage_qpg_cstmt_statement_date',
                START_DATE:             'custpage_qpg_cstmt_start_date',
                FOR_MONTH:              'custpage_qpg_cstmt_for_month'
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
            _FIELDS.FORM.START_DATE,
            _FIELDS.FORM.FOR_MONTH
        ];

        //button actions
        _FIELDS.ACTION = {
            PARAM: 'custpage_qpg_cstmt_action',
            PRINT_PDF: 'printpdf'
        };

        const LIB_FX = {};

        // Builds the URL for the Print PDF button: current filter values plus
        // an action flag. Client-side only (uses window.location).
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
                    // Statement Date/Start Date - getValue() on a DATE field
                    // returns a Date object. Send the calendar date exactly
                    // as displayed (this browser's local Y/M/D), not
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
