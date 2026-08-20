/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Handles the UI behavior for Tenancy Schedule Report page
 *
 * Date        	  Author		        Purpose
 * 08/19/2026     Jared Espineli        Initial Version
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/currentRecord', './bb1_qpg_tschd_report_lib_helper'],
    /**
     * @param{currentRecord} currentRecordModule
     * @param{helperLib} helperLib
     */
    (currentRecordModule, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        /**
         * Function to be executed when field is changed.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.fieldId - Field name
         * @since 2015.2
         */
        const fieldChanged = (scriptContext) => {
            const currentRecord = currentRecordModule.get();
            const {fieldId} = scriptContext;

            if (fieldId === _FIELDS.FORM.BUILDING) {
                const buildingIds = currentRecord.getValue({fieldId: _FIELDS.FORM.BUILDING});
                helperLib.LIB_FX.populateChildOptions(
                    currentRecord, _FIELDS.FORM.BLOCK, _FIELDS.BLOCK.REC_ID,
                    _FIELDS.BLOCK.FILTERBY_BUILDING, buildingIds
                );

                //clear values of the dependent fields from a building
                helperLib.LIB_FX.clearFieldOptions(currentRecord, _FIELDS.FORM.FLOOR);
                return;
            }

            if (fieldId === _FIELDS.FORM.BLOCK) {
                const blockIds = currentRecord.getValue({fieldId: _FIELDS.FORM.BLOCK});
                helperLib.LIB_FX.populateChildOptions(
                    currentRecord, _FIELDS.FORM.FLOOR, _FIELDS.FLOOR.REC_ID,
                    _FIELDS.FLOOR.FILTERBY_BLOCK, blockIds
                );

                //clear values of the dependent fields from a block
                helperLib.LIB_FX.clearFieldOptions(currentRecord, _FIELDS.FORM.UNIT);
                return;
            }

            if (fieldId === _FIELDS.FORM.FLOOR) {
                const floorIds = currentRecord.getValue({fieldId: _FIELDS.FORM.FLOOR});
                helperLib.LIB_FX.populateChildOptions(
                    currentRecord, _FIELDS.FORM.UNIT, _FIELDS.UNIT.REC_ID,
                    _FIELDS.UNIT.FILTERBY_FLOOR, floorIds
                );
            }
        }

        /**
         * Triggered by the "Print PDF" button. Re-requests the current Suitelet
         * page with the selected filter values plus an action flag, so the
         * server can generate the PDF instead of re-rendering the form. Opens
         * in a new tab so the filter page itself is left untouched.
         */
        const printPdf = () => {
            const currentRecord = currentRecordModule.get();
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

            params.set(_FIELDS.ACTION.PARAM, _FIELDS.ACTION.PRINT_PDF);

            window.open(`${window.location.pathname}?${params.toString()}`, '_blank');
        }

        return {fieldChanged, printPdf}

    });
