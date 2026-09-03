/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Handles the UI behavior for the Customer Statement page
 *
 * Date                 Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release - Search Customer button stubbed, no action wired
 *                                          up yet per current requirements
 * 02-September-2026    Jared Espineli      Added a pageInit no-op - a SuiteScript 2.1 Client Script must export
 *                                          at least one recognized entry point (searchCustomer alone isn't one),
 *                                          or NetSuite throws SCRIPT_OF_API_VERSION_2X_MUST_IMPLEMENT_A_SCRIPT_TYPE_INTERFACE
 * 02-September-2026    Jared Espineli      Search Customer now redirects to the Generate Statement Suitelet
 *                                          (see bb1_qpg_cstmt_cls_lib_helper.js's buildSearchUrl), carrying over
 *                                          the Customer/Category selection
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

        /**
         * Function to be executed after page is initialized.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.currentRecord - Current form record
         * @param {string} scriptContext.mode - The mode in which the record is being accessed
         * @since 2015.2
         */
        const pageInit = (scriptContext) => {
        }

        /**
         * Function called when the Search Customer button has been clicked
         * - redirects to the Generate Statement Suitelet, carrying over the
         * current Customer/Category selection.
         */
        const searchCustomer = () => {
            const currentRecord = currentRecordModule.get();
            const targetUrl = helperLib.LIB_FX.buildSearchUrl(currentRecord);
            window.location.href = targetUrl;
        }

        return {pageInit, searchCustomer}

    });
