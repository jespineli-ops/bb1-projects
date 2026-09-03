/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Handles UI logic for the Generate Statement page - renders the Generate
 * Statement Suitelet form (Start Date/Statement Date/Roll Prior Charges
 * fields, Generate Statement/Print Statement buttons, Customer List
 * results). Reached from the Customer Statement Suitelet's Search Customer
 * button, which carries over the Customer/Category selection as request
 * params (see bb1_qpg_cstmt_gts_lib_helper.js's getFiltersFromParams).
 *
 * Date             Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release
 * 02-September-2026    Jared Espineli      Passes request.parameters through to buildForm() so the carried-over
 *                                          Customer/Category filter reaches the Customer List sublist
 * 03-September-2026    Jared Espineli      No script-level change - request.parameters also now carries the
 *                                          Customer List's page index (see gts_lib_helper.js's PAGE_PARAM),
 *                                          already covered by the pass-through above
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
            const {request, response} = scriptContext;

            const form = formLib.LIB_FX.buildForm(request.parameters);
            response.writePage(form);
        }

        return {onRequest}

    });
