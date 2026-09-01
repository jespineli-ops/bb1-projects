/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 *
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 * Handles the UI behavior for the Customer Statement page
 *
 * Date        	  Author		        Purpose
 * 09/01/2026     Jared Espineli        Initial Version
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/currentRecord', './bb1_qpg_cstmt_report_lib_helper'],
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
         * Function called when Print PDF button has been clicked
         */
        const printPdf = () => {
            const currentRecord = currentRecordModule.get();
            const url = helperLib.LIB_FX.buildReportUrl(currentRecord, _FIELDS.ACTION.PRINT_PDF);
            window.open(url, '_blank');
        }

        return {fieldChanged, printPdf}

    });
