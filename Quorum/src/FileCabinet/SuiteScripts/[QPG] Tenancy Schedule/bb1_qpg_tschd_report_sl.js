/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Handles UI and backend logic for the Tenancy Schedule report
 *
 * Date        	  Author		        Purpose
 * 08/19/2026     Jared Espineli        Initial Version
 * 08/20/2026     Jared Espineli        Moved form-building logic to bb1_qpg_tschd_report_lib
 * 08/24/2026     Jared Espineli        Added Export CSV action
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/redirect', 'N/render', 'N/search', './bb1_qpg_tschd_report_form_lib',
        './bb1_qpg_tschd_report_pdf_lib', './bb1_qpg_tschd_report_csv_lib', './bb1_qpg_tschd_report_lib_helper'],
    /**
     * @param{redirect} redirect
     * @param{render} render
     * @param{search} search
     * @param{formLib} formLib
     * @param{pdfLib} pdfLib
     * @param{csvLib} csvLib
     * @param{helperLib} helperLib
     */
    (redirect, render, search, formLib, pdfLib, csvLib, helperLib) => {

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

            if (request.parameters[_FIELDS.ACTION.PARAM] === _FIELDS.ACTION.PRINT_PDF) {
                const pdfFile = pdfLib.LIB_FX.buildPdf(request.parameters);
                response.writeFile({file: pdfFile, isInline: true});
                return;
            }

            if (request.parameters[_FIELDS.ACTION.PARAM] === _FIELDS.ACTION.EXPORT_CSV) {
                const csvFile = csvLib.LIB_FX.buildCsv(request.parameters);
                csvFile.save();
                response.writeFile({file: csvFile, isInline: false});
                return;
            }

            const form = formLib.LIB_FX.buildForm();
            response.writePage(form);
        }

        return {onRequest}

    });