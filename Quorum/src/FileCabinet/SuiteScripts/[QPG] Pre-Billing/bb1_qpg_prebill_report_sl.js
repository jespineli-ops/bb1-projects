/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Project: Quorum Pre-Billing - P102843 Quorum NetSuite Implementation
 * Handles UI and backend logic for the Pre-Billing report
 *
 * Date        	  Author		        Purpose
 * 08/26/2026     Jared Espineli        Initial Version - UI scaffold, modelled on the Tenancy Schedule Report Suitelet.
 *                                       Print PDF/Export CSV actions are stubbed - report content not yet scoped.
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['./bb1_qpg_prebill_report_form_lib', './bb1_qpg_prebill_report_lib_helper'],
    /**
     * @param{formLib} formLib
     * @param{helperLib} helperLib
     */
    (formLib, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        /**
         * Defines the Suitelet script trigger point.
         * @param {Object} scriptContext
         * @param {ServerRequest} scriptContext.request - Incoming request
         * @param {ServerResponse} scriptContext.response - Suitelet response
         * @since 2015.2
         */
        const onRequest = (scriptContext) => {
            const {request, response} = scriptContext;

            // TODO: Print PDF/Export CSV report generation not yet built -
            // wire these up to pdf/csv libs once the Pre-Billing report
            // content (columns, groupings, data source) is scoped, the same
            // way bb1_qpg_tschd_report_sl.js does for the Tenancy Schedule.
            if (request.parameters[_FIELDS.ACTION.PARAM] === _FIELDS.ACTION.PRINT_PDF
                || request.parameters[_FIELDS.ACTION.PARAM] === _FIELDS.ACTION.EXPORT_CSV) {
                response.write('Pre-Billing report generation has not been implemented yet.');
                return;
            }

            const form = formLib.LIB_FX.buildForm();
            response.writePage(form);
        }

        return {onRequest}

    });
