/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Handles UI logic for the Generate Tenant Statements page - reached from
 * the Customer List Search Suitelet's Show Customer List button.
 *
 * TODO: This Suitelet currently only renders the Statement Date/Start Date/
 * Roll Prior Charges fields, per the current requirements. It doesn't yet
 * read the filter params carried over from Customer List Search (see
 * bb1_qpg_cstmt_cls_lib_helper.js's _FIELDS.FILTER_FIELD_IDS), display the
 * matching customer/tenant list, or generate statements - none of that has
 * been scoped yet.
 *
 * Date             Author              Purpose
 * 01-September-2026    Jared Espineli      Initial Release - Statement Date/Start Date/Roll Prior Charges
 *                                          checkbox only, no generation logic yet
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['./bb1_qpg_cstmt_gts_form_lib'],
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
