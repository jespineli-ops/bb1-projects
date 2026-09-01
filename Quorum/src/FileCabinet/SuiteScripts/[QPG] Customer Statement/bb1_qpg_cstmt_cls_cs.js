/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Handles the UI behavior for the Customer List Search page
 *
 * Date             Author              Purpose
 * 01-September-2026    Jared Espineli      Initial Release
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/currentRecord', './bb1_qpg_cstmt_cls_lib_helper'],
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
         * Function called when Show Customer List button has been clicked -
         * redirects to the Generate Tenant Statements Suitelet, carrying
         * over the current filter selections.
         */
        const showCustomerList = () => {
            const currentRecord = currentRecordModule.get();
            const targetUrl = helperLib.LIB_FX.buildCustomerListUrl(currentRecord);
            window.location.href = targetUrl;
        }

        return {fieldChanged, showCustomerList}

    });
