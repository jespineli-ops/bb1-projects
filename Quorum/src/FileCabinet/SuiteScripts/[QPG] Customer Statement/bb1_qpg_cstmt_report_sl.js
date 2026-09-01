/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 * Handles UI and backend logic for the Customer Statement report
 *
 * Date        	  Author		        Purpose
 * 09/01/2026     Jared Espineli        Initial Version - UI scaffold, modelled on the Pre-Billing/Tenancy
 *                                      Schedule Suitelets. Print PDF action is stubbed - report content not
 *                                      yet scoped.
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['./bb1_qpg_cstmt_report_form_lib', './bb1_qpg_cstmt_report_lib_helper'],
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

            // TODO: Print PDF report generation not yet built - wire this up
            // to a pdf lib once the Customer Statement report content
            // (layout, data source) is scoped, the same way
            // bb1_qpg_tschd_report_sl.js does for the Tenancy Schedule.
            if (request.parameters[_FIELDS.ACTION.PARAM] === _FIELDS.ACTION.PRINT_PDF) {
                response.write('Customer Statement report generation has not been implemented yet.');
                return;
            }

            const form = formLib.LIB_FX.buildForm();
            response.writePage(form);
        }

        return {onRequest}

    });
