/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Handles the UI behavior for the Generate Statement page
 *
 * Date             Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release - Generate Statement/Print Statement buttons
 *                                          stubbed, with a no-op pageInit (a SuiteScript 2.1 Client Script must
 *                                          export a recognized entry point).
 * 03-September-2026    Jared Espineli      Added blank Start/Statement Date blocking with an alert, a Back to
 *                                          Search button, and wired Generate Statement to open the merged PDF
 *                                          for every marked customer in a new tab.
 * 04-September-2026    Jared Espineli      Fixed marks not surviving pagination and Mark All only reaching the
 *                                          current page, moved Select All/Clear All/Previous/Next to the sublist
 *                                          toolbar (goToPreviousPage/goToNextPage replacing goToPage), and
 *                                          reworked Generate Statement's tab to show a background-job progress
 *                                          page instead of streaming the PDF directly.
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

        // Alerts and returns true when a required field is blank, so callers can bail out before generating/
        // printing. Uses window.alert, not N/ui/dialogs, which isn't available on Suitelet-rendered pages.
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
         * Blocks and alerts if Start Date/Statement Date is blank, or if no customer is checked; otherwise opens
         * a new tab that generates the merged statement PDF in the background and opens it in that tab once ready.
         */
        const generateStatement = () => {
            const currentRecord = currentRecordModule.get();
            if (blockOnMissingRequiredFields(currentRecord)) return;

            // getAllMarkedCustomerIds, not getMarkedCustomerIds - a mark made on a page the user has since
            // navigated away from still counts (see gts_lib_helper.js).
            if (!helperLib.LIB_FX.getAllMarkedCustomerIds(currentRecord).length) {
                window.alert('Please mark at least one customer in the Customer List before generating a statement.');
                return;
            }

            window.open(helperLib.LIB_FX.buildPrintUrl(currentRecord), '_blank');
        }

        // Navigates the Customer List to the given page, merging this page's live marks into the cross-page
        // selection first. Shared by goToPreviousPage/goToNextPage below.
        const goToPage = (pageIndex) => {
            const currentRecord = currentRecordModule.get();
            window.location.href = helperLib.LIB_FX.buildPageNavUrl(currentRecord, pageIndex);
        }

        /**
         * Called when the Customer List sublist's Previous button is clicked. Sublist buttons take no
         * arguments, so the page being left is read off the URL via getCurrentPageIndexFromLocation().
         */
        const goToPreviousPage = () => {
            goToPage(helperLib.LIB_FX.getCurrentPageIndexFromLocation() - 1);
        }

        /**
         * Called when the Customer List sublist's Next button has been clicked - see goToPreviousPage above.
         */
        const goToNextPage = () => {
            goToPage(helperLib.LIB_FX.getCurrentPageIndexFromLocation() + 1);
        }

        /**
         * Called when the Customer List sublist's Select All button is clicked - marks every customer matching
         * the current search, not just this page's rows.
         */
        const selectAllPages = () => {
            const currentRecord = currentRecordModule.get();
            helperLib.LIB_FX.selectAllPages(currentRecord);
        }

        /**
         * Called when the Customer List sublist's Clear All button is clicked - unmarks every customer, current
         * page and every other page's carried-forward marks alike.
         */
        const clearAllPages = () => {
            const currentRecord = currentRecordModule.get();
            helperLib.LIB_FX.clearAllPages(currentRecord);
        }

        /**
         * Called when the Email Statement button is clicked. Blocks and alerts if Start Date/Statement Date is
         * blank; the email behavior itself is still a no-op until scoped.
         */
        const emailStatement = () => {
            const currentRecord = currentRecordModule.get();
            if (blockOnMissingRequiredFields(currentRecord)) return;
        }

        /**
         * Called when the Back to Search button is clicked - returns to the Customer Statement Suitelet, no
         * missing-fields check.
         */
        const backToSearch = () => {
            window.location.href = helperLib.LIB_FX.buildBackToSearchUrl();
        }

        return {
            pageInit, generateStatement, emailStatement, backToSearch,
            goToPreviousPage, goToNextPage, selectAllPages, clearAllPages
        }

    });
