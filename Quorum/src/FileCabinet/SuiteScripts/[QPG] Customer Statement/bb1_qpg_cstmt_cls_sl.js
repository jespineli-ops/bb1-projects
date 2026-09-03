/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Handles UI logic for the Customer Statement page - renders the Customer
 * Statement Suitelet form (Customer/Category fields, Search Customer
 * button).
 *
 * Date                 Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['./bb1_qpg_cstmt_cls_form_lib'],
    /**
     * @param{formLib} formLib
     */
    (formLib) => {

        /**
         * Defines the Suitelet script trigger point.
         * @param {Object} scriptContext
         * @param {ServerRequest} scriptContext.request - Incoming request
         * @param {ServerResponse} scriptContext.response - Suitelet response
         * @since 2015.2
         */
        const onRequest = (scriptContext) => {
            const form = formLib.LIB_FX.buildForm();
            scriptContext.response.writePage(form);
        }

        return {onRequest}

    });
