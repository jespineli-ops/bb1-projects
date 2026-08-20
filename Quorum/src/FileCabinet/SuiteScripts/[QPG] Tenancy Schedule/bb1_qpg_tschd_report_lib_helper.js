/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Shared helper library (field ids + cascading filter helpers) used by both the
 * Tenancy Schedule Suitelet and its client script.
 *
 * Date        	  Author		        Purpose
 * 08/20/2026     Jared Espineli        Initial Version
 * 08/20/2026     Jared Espineli        Split out server-only form building to fix
 *                                      client script load error (N/ui/serverWidget
 *                                      is unavailable client-side)
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

        // the report's filter fields - forwarded from the client script to the
        // Suitelet whenever a report output (PDF/CSV) is requested
        _FIELDS.FILTER_FIELD_IDS = [
            _FIELDS.FORM.PROPERTY_PORTFOLIO,
            _FIELDS.FORM.BUILDING,
            _FIELDS.FORM.ACCOMM_TYPE,
            _FIELDS.FORM.BLOCK,
            _FIELDS.FORM.FLOOR,
            _FIELDS.FORM.UNIT,
            _FIELDS.FORM.AS_OF_DATE
        ];

        // request parameter that tells the Suitelet which output to generate
        _FIELDS.ACTION = {
            PARAM: 'custpage_qpg_action',
            PRINT_PDF: 'printpdf'
        };

        const LIB_FX = {};

        /**
         * clears the value in a multi select field
         */
        LIB_FX.clearFieldOptions = (currentRecord, fieldId) => {
            currentRecord.setValue({fieldId: fieldId, value: [], ignoreFieldChange: true});
            currentRecord.getField({fieldId: fieldId}).removeSelectOption({value: null});
        }

        /**
         * Searches for child records of a parent record type, and populates the
         * multi-select field with the child records' names.'
         */
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