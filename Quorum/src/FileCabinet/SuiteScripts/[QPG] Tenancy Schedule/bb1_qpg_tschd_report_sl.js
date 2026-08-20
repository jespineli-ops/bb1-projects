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
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/redirect', 'N/render', 'N/search', './bb1_qpg_tschd_report_lib'],
    /**
     * @param{redirect} redirect
     * @param{render} render
     * @param{search} search
     * @param{helperLib} helperLib
     */
    (redirect, render, search, helperLib) => {

        /**
         * Defines the Suitelet script trigger point.
         * @param {Object} scriptContext
         * @param {ServerRequest} scriptContext.request - Incoming request
         * @param {ServerResponse} scriptContext.response - Suitelet response
         * @since 2015.2
         */
        const onRequest = (scriptContext) => {
            const form = helperLib.LIB_FX.buildForm();
            scriptContext.response.writePage(form);
        }

        return {onRequest}

    });