/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Handles the UI behavior for the Generate Statement page
 *
 * Date             Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release - Generate Statement/Print Statement buttons
 *                                          stubbed, no actions wired up yet per current requirements (Print
 *                                          Statement has since been renamed Email Statement - see below).
 *                                          pageInit exported as a no-op since a SuiteScript 2.1 Client Script
 *                                          referenced via clientScriptModulePath must implement at least one
 *                                          recognized entry point, or NetSuite throws
 *                                          SCRIPT_OF_API_VERSION_2X_MUST_IMPLEMENT_A_SCRIPT_TYPE_INTERFACE
 * 03-September-2026    Jared Espineli      Generate Statement/Print Statement now block and alert
 *                                          (window.alert) if Start Date/Statement Date is blank, via the new
 *                                          blockOnMissingRequiredFields()/gts_lib_helper.js's
 *                                          getMissingRequiredFields() - same pattern as the Tenancy Schedule
 *                                          report's Print PDF/Export CSV (bb1_qpg_tschd_report_cs.js). The
 *                                          generation/print behavior itself is still otherwise unscoped.
 * 03-September-2026    Jared Espineli      Added backToSearch(), for the new Back to Search button - navigates
 *                                          to gts_lib_helper.js's buildBackToSearchUrl() with no missing-fields
 *                                          check (it's a cancel/navigate-away action, not generate/print)
 * 03-September-2026    Jared Espineli      Renamed printStatement() to emailStatement() (still a stub - see
 *                                          gts_form_lib.js's rename of the button itself). generateStatement()
 *                                          now does the printing: also blocks/alerts if no customer is checked
 *                                          in the Customer List, then opens gts_lib_helper.js's buildPrintUrl()
 *                                          in a new tab - one merged PDF, one window, covering every marked
 *                                          customer - same window.open(url, '_blank') pattern as the Tenancy
 *                                          Schedule report's Print PDF (bb1_qpg_tschd_report_cs.js)
 * 04-September-2026    Jared Espineli      Fixed marks not surviving Customer List pagination - generateStatement's
 *                                          no-customer-marked check and buildPrintUrl now go through
 *                                          gts_lib_helper.js's new getAllMarkedCustomerIds() (current page + every
 *                                          other page's carried-forward marks) instead of getMarkedCustomerIds()
 *                                          (current page only). Added goToPage(), which the Customer List pager
 *                                          now calls instead of using plain hrefs (see gts_form_lib.js's
 *                                          buildPagerHtml) - navigates via gts_lib_helper.js's buildPageNavUrl(),
 *                                          which merges this page's live marks in before moving to the next page
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/currentRecord', './bb1_qpg_cstmt_gts_lib_helper'],
    /**
     * @param{currentRecord} currentRecordModule
     * @param{helperLib} helperLib
     */
    (currentRecordModule, helperLib) => {

        // Alerts and returns true when a required field (Start Date/Statement
        // Date) is blank, so callers can bail out before generating/printing.
        // window.alert, not N/ui/dialogs - N/ui/dialogs isn't available on
        // Suitelet-rendered pages (only on standard record forms) and fails
        // to load, same reason as the Tenancy Schedule report's cs.js.
        const blockOnMissingRequiredFields = (currentRecord) => {
            const missingLabels = helperLib.LIB_FX.getMissingRequiredFields(currentRecord);

            if (!missingLabels.length) {
                return false;
            }

            window.alert(`Please fill in the following required field(s) before continuing: ${missingLabels.join(', ')}.`);

            return true;
        }

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
         * Function called when the Generate Statement button has been
         * clicked. Blocks and alerts if Start Date/Statement Date is blank,
         * or if no customer is checked in the Customer List; otherwise opens
         * the merged statement PDF for every marked customer in a new tab -
         * one window, one statement per customer.
         */
        const generateStatement = () => {
            const currentRecord = currentRecordModule.get();
            if (blockOnMissingRequiredFields(currentRecord)) return;

            // getAllMarkedCustomerIds, not getMarkedCustomerIds - a mark
            // made on a page the user has since navigated away from still
            // counts (see gts_lib_helper.js).
            if (!helperLib.LIB_FX.getAllMarkedCustomerIds(currentRecord).length) {
                window.alert('Please mark at least one customer in the Customer List before generating a statement.');
                return;
            }

            window.open(helperLib.LIB_FX.buildPrintUrl(currentRecord), '_blank');
        }

        /**
         * Function called when the Customer List's Previous/Next links or
         * page-range dropdown are used (see gts_form_lib.js's
         * buildPagerHtml) - merges this page's live marks into the
         * cross-page selection before navigating, so nothing checked here
         * is lost when the next page renders.
         * @param {number|string} pageIndex - the page to navigate to (0-based)
         */
        const goToPage = (pageIndex) => {
            const currentRecord = currentRecordModule.get();
            window.location.href = helperLib.LIB_FX.buildPageNavUrl(currentRecord, pageIndex);
        }

        /**
         * Function called when the Email Statement button has been clicked.
         * Blocks and alerts if Start Date/Statement Date is blank; the email
         * behavior itself is still a no-op until scoped.
         */
        const emailStatement = () => {
            const currentRecord = currentRecordModule.get();
            if (blockOnMissingRequiredFields(currentRecord)) return;
        }

        /**
         * Function called when the Back to Search button has been clicked -
         * returns to the Customer Statement Suitelet (no missing-fields
         * check - this is a cancel/navigate-away action, not a generate/
         * print one).
         */
        const backToSearch = () => {
            window.location.href = helperLib.LIB_FX.buildBackToSearchUrl();
        }

        return {pageInit, generateStatement, emailStatement, backToSearch, goToPage}

    });
