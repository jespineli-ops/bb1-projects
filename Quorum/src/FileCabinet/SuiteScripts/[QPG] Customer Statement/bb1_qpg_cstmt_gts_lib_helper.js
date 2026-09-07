/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Shared library (field ids + request-param helper) used by both the
 * Generate Statement Suitelet and its client script.
 *
 * Date                 Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release - field ids for Start/Statement Date, Roll Prior
 *                                          Charges, Generate/Email Statement, and the Customer/Category filter
 *                                          + Customer List Search script parameters.
 * 03-September-2026    Jared Espineli      Added pagination, required-field validation, sublist/pager field ids,
 *                                          Back to Search, and the print-action URL-building for Generate
 *                                          Statement.
 * 04-September-2026    Jared Espineli      Added cross-page selection tracking and Select All/Clear All (fixing
 *                                          Mark All only reaching the current page), moved those plus Previous/
 *                                          Next onto the sublist toolbar, reworked Generate Statement onto a
 *                                          background Map/Reduce job with a polling progress page so a large
 *                                          selection no longer crashes the Suitelet, then fixed that job
 *                                          erroring on every run (runtime.getCurrentTask() isn't a real API -
 *                                          added RUN_ID, a self-generated id passed in as a script parameter
 *                                          instead) and two invalid search.lookupFields columns that were
 *                                          failing for every customer.
 * 07-September-2026    Jared Espineli      Replaced Previous/Next with a page-range SELECT dropdown (e.g.
 *                                          "1-15", "16-30") and raised PAGE_SIZE from 2 to 15.
 * 07-September-2026    Jared Espineli      Added the Email Statement action + EMAIL_MR field ids (mirrors MR,
 *                                          its own background job - see gts_email_mr.js) and factored
 *                                          buildPrintUrl/the new buildEmailUrl onto one shared builder.
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/url'],
    /**
     * @param{url} url
     */
    (url) => {

        // Script/deployment id of the Customer Statement Suitelet that Back to Search returns to.
        const BACK_SCRIPT_ID = 'customscript_bb1_qpg_cstmt_cls_sl';
        const BACK_DEPLOY_ID = 'customdeploy_bb1_qpg_cstmt_cls_sl';

        // field/button ids used on the Generate Statement Suitelet form
        const _FIELDS = {
            FORM: {
                BUTTON_STYLE:       'custpage_qpg_cstmt_gts_button_style',
                BACK_TO_SEARCH:     'custpage_qpg_cstmt_gts_back',
                GENERATE_STATEMENT: 'custpage_qpg_cstmt_gts_generate',
                EMAIL_STATEMENT:    'custpage_qpg_cstmt_gts_email',
                START_DATE:         'custpage_qpg_cstmt_gts_start_date',
                STATEMENT_DATE:     'custpage_qpg_cstmt_gts_statement_date',
                ROLL_PRIOR_CHARGES: 'custpage_qpg_cstmt_gts_roll_prior_charges'
            },
            // Query param keys this Suitelet is reached with, from the Customer Statement Suitelet's Search
            // Customer button - must match bb1_qpg_cstmt_cls_lib_helper.js's _FIELDS.SEARCH_PARAM.
            SEARCH_PARAM: {
                CUSTOMER: 'custpage_qpg_cstmt_filter_customer',
                CATEGORY: 'custpage_qpg_cstmt_filter_category'
            },
            // Script parameter id holding the internal id of the saved Customer List search to load.
            SCRIPT_PARAM: {
                CUSTOMER_LIST_SEARCH: 'custscript_bb1_qpg_cstmt_cust_list_sea'
            },
            RESULTS: {
                SUBLIST_ID: 'custpage_qpg_cstmt_gts_results',
                SELECT:     'custpage_qpg_cstmt_gts_res_select',
                ID:         'custpage_qpg_cstmt_gts_res_id',
                CUSTOMER:   'custpage_qpg_cstmt_gts_res_customer',
                SUBSIDIARY: 'custpage_qpg_cstmt_gts_res_subsidiary',
                CURRENCY:   'custpage_qpg_cstmt_gts_res_currency',
                BALANCE:    'custpage_qpg_cstmt_gts_res_balance',
                // Sublist toolbar buttons, rendered via sublist.addButton() so they sit directly above the
                // Customer List rows (see gts_form_lib.js's addResultsSublist).
                SELECT_ALL_BUTTON: 'custpage_qpg_cstmt_gts_res_select_all',
                CLEAR_ALL_BUTTON:  'custpage_qpg_cstmt_gts_res_clear_all',
                // Page-range dropdown ("1-15", "16-30", ...) rendered as a native form field directly above the
                // sublist - not a sublist toolbar button, since serverWidget.Sublist has no dropdown control, only
                // addButton(). Changing it fires fieldChanged in gts_cs.js, which navigates like Previous/Next did.
                PAGE_SELECT:       'custpage_qpg_cstmt_gts_res_page_select',
                // Hidden field carrying forward every marked customer id from a page OTHER than the one being
                // rendered - see gts_form_lib.js's addResultsSublist and getAllMarkedCustomerIds below.
                SELECTED_IDS: 'custpage_qpg_cstmt_gts_selected_ids',
                // Hidden field holding EVERY customer id matching the current search, across all pages -
                // computed server-side at render time so selectAllPages() can select the full result set.
                ALL_IDS:    'custpage_qpg_cstmt_gts_all_ids'
            },
            // Query param carrying the Customer List's current page index (0-based).
            PAGE_PARAM: 'custpage_qpg_cstmt_gts_page',
            // Generate Statement's print action - queues gts_mr.js via gts_task_lib.js (see gts_sl.js).
            ACTION: {
                PARAM:         'custpage_qpg_cstmt_gts_action',
                PRINT_PDF:     'printpdf',
                // Comma-separated customer internal ids checked in the Customer List, carried as a param since
                // the selection only exists in the browser.
                CUSTOMER_IDS:  'custpage_qpg_cstmt_gts_customer_ids',
                // Polled by the progress page's own script once PRINT_PDF has queued gts_mr.js - returns JSON.
                STATUS_CHECK:  'statuscheck',
                // Query param carrying the REAL NetSuite task id (from task.create().submit()), used only for
                // task.checkStatus() progress polling - gts_mr.js itself never sees this value.
                TASK_ID:       'custpage_qpg_cstmt_gts_task_id',
                // Query param carrying the self-generated run id (see gts_task_lib.js) that IS passed into
                // gts_mr.js as MR.PARAM.RUN_ID - used as the N/cache status key, since the real task id isn't
                // knowable until after submit() returns, too late to hand to the job as a script parameter.
                RUN_ID:        'custpage_qpg_cstmt_gts_run_id',
                // What the progress page navigates to once ready - streams the temp PDF gts_mr.js saved, then
                // deletes it.
                DOWNLOAD_PDF:  'downloadpdf',
                // Query param carrying the temp file's id, read back by the DOWNLOAD_PDF branch.
                FILE_ID:       'custpage_qpg_cstmt_gts_file_id',
                // Email Statement's own action - queues gts_email_mr.js via gts_task_lib.js, same as PRINT_PDF
                // does for gts_mr.js. Shares CUSTOMER_IDS/STATUS_CHECK/RUN_ID/TASK_ID above; has no download
                // step of its own since nothing is streamed back - the progress page just shows a send summary.
                EMAIL_STATEMENT: 'emailstatement'
            },
            // gts_mr.js's own script id + parameters, and the N/cache name its summarize stage reports through -
            // shared so gts_task_lib.js and gts_mr.js can't drift apart. Deployment note: this MapReduceScript
            // record/deployment and its Free-Form Text parameters must be created manually in the NetSuite UI
            // (this project's SDF source doesn't track Script/ScriptDeployment objects).
            MR: {
                SCRIPT_ID: 'customscript_bb1_qpg_cstmt_gts_mr',
                PARAM: {
                    CUSTOMER_IDS:   'custscript_bb1_qpg_cstmt_mr_customer_ids',
                    START_DATE:     'custscript_bb1_qpg_cstmt_mr_start_date',
                    STATEMENT_DATE: 'custscript_bb1_qpg_cstmt_mr_stmnt_date',
                    ROLLUP:         'custscript_bb1_qpg_cstmt_mr_rollup',
                    // Self-generated run id (see gts_task_lib.js) - there is no N/runtime API to read a Map/
                    // Reduce job's own real task id from inside itself, so this stands in as the status-cache key.
                    RUN_ID:         'custscript_bb1_qpg_cstmt_mr_run_id'
                },
                // N/cache key namespace gts_mr.js writes results to (keyed by RUN_ID) and gts_task_lib.js polls.
                STATUS_CACHE_NAME: 'bb1_qpg_cstmt_gts_status'
            },
            // gts_email_mr.js's own script id + parameters - mirrors MR above but for the Email Statement job
            // (one email per marked customer, own single-page PDF attached, no merge/download step). Shares
            // MR.STATUS_CACHE_NAME (unique per RUN_ID regardless of which job wrote it). Deployment note: same
            // as MR - this MapReduceScript record/deployment and its Free-Form Text parameters must be created
            // manually in the NetSuite UI (this project's SDF source doesn't track Script/ScriptDeployment
            // objects).
            EMAIL_MR: {
                SCRIPT_ID: 'customscript_bb1_qpg_cstmt_gts_email_mr',
                PARAM: {
                    CUSTOMER_IDS:   'custscript_bb1_qpg_cstmt_eml_cust_ids',
                    START_DATE:     'custscript_bb1_qpg_cstmt_eml_start_date',
                    STATEMENT_DATE: 'custscript_bb1_qpg_cstmt_eml_stmnt_date',
                    ROLLUP:         'custscript_bb1_qpg_cstmt_eml_rollup',
                    RUN_ID:         'custscript_bb1_qpg_cstmt_eml_run_id',
                    // Internal id of the employee to send as (resolved once, at submission time, from
                    // gts_email_lib.js's static FROM_EMAIL_ADDRESS - N/email.send's author must be an employee
                    // id, not a raw address) - see gts_task_lib.js's submitEmailStatementTask.
                    AUTHOR_ID:      'custscript_bb1_qpg_cstmt_eml_author_id'
                }
            }
        }

        // Form fields that must have a value before a statement can be generated/printed.
        _FIELDS.REQUIRED_FIELD_IDS = [
            _FIELDS.FORM.START_DATE,
            _FIELDS.FORM.STATEMENT_DATE
        ];

        // Human-readable labels for required field ids, used in the missing-fields alert
        _FIELDS.FIELD_LABELS = {
            [_FIELDS.FORM.START_DATE]: 'Start Date',
            [_FIELDS.FORM.STATEMENT_DATE]: 'Statement Date'
        };

        // Customer List rows per page - single source of truth for form_lib's pagination.
        const PAGE_SIZE = 15;

        const LIB_FX = {};

        LIB_FX.PAGE_SIZE = PAGE_SIZE;

        // Builds the customer-list filter object from the Suitelet's request params - shared by the
        // Suitelet/form lib.
        LIB_FX.getFiltersFromParams = (params) => ({
            customerId: (params && params[_FIELDS.SEARCH_PARAM.CUSTOMER]) || '',
            categoryId: (params && params[_FIELDS.SEARCH_PARAM.CATEGORY]) || ''
        });

        // Reads the requested Customer List page index (0-based) off request params, defaulting to 0 when
        // missing/invalid. form_lib still clamps this against the actual page count once the search has run.
        LIB_FX.getPageIndexFromParams = (params) => {
            const raw = params && params[_FIELDS.PAGE_PARAM];
            const pageIndex = parseInt(raw, 10);
            return isNaN(pageIndex) || pageIndex < 0 ? 0 : pageIndex;
        }

        // Splits a comma-separated request param back into an array of id strings ('' / null / undefined -> []).
        LIB_FX.parseIdListParam = (value) => {
            if (value === null || value === undefined || value === '') return [];
            return String(value).split(',').map((id) => id.trim()).filter(Boolean);
        }

        // Reads the accumulated cross-page selection off request params - ids marked on every page OTHER than
        // the one about to render.
        LIB_FX.getSelectedIdsFromParams = (params) => LIB_FX.parseIdListParam(params && params[_FIELDS.RESULTS.SELECTED_IDS]);

        // A checkbox on this Suitelet's own page can come back as 'T'/'F' or a plain boolean, depending on the
        // field/sublist combination - treat both as valid.
        const isChecked = (value) => value === 'T' || value === true;

        // Returns the internal ids of every customer checked in the Customer List on the CURRENT page only - a
        // mark on a page since paged away from isn't visible here. Client-side only.
        LIB_FX.getMarkedCustomerIds = (currentRecord) => {
            const lineCount = currentRecord.getLineCount({sublistId: _FIELDS.RESULTS.SUBLIST_ID});
            const customerIds = [];

            for (let line = 0; line < lineCount; line++) {
                const isMarked = isChecked(currentRecord.getSublistValue({
                    sublistId: _FIELDS.RESULTS.SUBLIST_ID, fieldId: _FIELDS.RESULTS.SELECT, line: line
                }));

                if (!isMarked) continue;

                const customerId = currentRecord.getSublistValue({
                    sublistId: _FIELDS.RESULTS.SUBLIST_ID, fieldId: _FIELDS.RESULTS.ID, line: line
                });

                if (customerId) customerIds.push(customerId);
            }

            return customerIds;
        }

        // The full cross-page selection: ids marked on the current page plus every id carried forward from other
        // pages (RESULTS.SELECTED_IDS). De-duplicated via Set; client-side only.
        LIB_FX.getAllMarkedCustomerIds = (currentRecord) => {
            const currentPageIds = LIB_FX.getMarkedCustomerIds(currentRecord);
            const carriedIds = LIB_FX.parseIdListParam(currentRecord.getValue({fieldId: _FIELDS.RESULTS.SELECTED_IDS}));

            return Array.from(new Set(carriedIds.concat(currentPageIds)));
        }

        // Checks every row on the current page and folds every other known id (RESULTS.ALL_IDS) into
        // RESULTS.SELECTED_IDS, completing the full cross-page selection with no page reload - unlike NetSuite's
        // native Mark All, which only reaches rendered rows.
        LIB_FX.selectAllPages = (currentRecord) => {
            const lineCount = currentRecord.getLineCount({sublistId: _FIELDS.RESULTS.SUBLIST_ID});
            const thisPageIds = [];

            for (let line = 0; line < lineCount; line++) {
                currentRecord.selectLine({sublistId: _FIELDS.RESULTS.SUBLIST_ID, line: line});
                currentRecord.setCurrentSublistValue({
                    sublistId: _FIELDS.RESULTS.SUBLIST_ID, fieldId: _FIELDS.RESULTS.SELECT, value: true
                });
                currentRecord.commitLine({sublistId: _FIELDS.RESULTS.SUBLIST_ID});

                thisPageIds.push(String(currentRecord.getSublistValue({
                    sublistId: _FIELDS.RESULTS.SUBLIST_ID, fieldId: _FIELDS.RESULTS.ID, line: line
                })));
            }

            const allIds = LIB_FX.parseIdListParam(currentRecord.getValue({fieldId: _FIELDS.RESULTS.ALL_IDS}));
            // This page's own ids are represented live by the checkboxes just set above.
            const otherPageIds = allIds.filter((id) => thisPageIds.indexOf(id) === -1);
            currentRecord.setValue({fieldId: _FIELDS.RESULTS.SELECTED_IDS, value: otherPageIds.join(',')});
        }

        // Reverse of selectAllPages - unchecks every row on the current page and drops every other page's
        // carried-forward marks, so Clear All means none selected.
        LIB_FX.clearAllPages = (currentRecord) => {
            const lineCount = currentRecord.getLineCount({sublistId: _FIELDS.RESULTS.SUBLIST_ID});

            for (let line = 0; line < lineCount; line++) {
                currentRecord.selectLine({sublistId: _FIELDS.RESULTS.SUBLIST_ID, line: line});
                currentRecord.setCurrentSublistValue({
                    sublistId: _FIELDS.RESULTS.SUBLIST_ID, fieldId: _FIELDS.RESULTS.SELECT, value: false
                });
                currentRecord.commitLine({sublistId: _FIELDS.RESULTS.SUBLIST_ID});
            }

            currentRecord.setValue({fieldId: _FIELDS.RESULTS.SELECTED_IDS, value: ''});
        }

        // A DATE field's getValue() returns a Date object - sent as this browser's local Y/M/D ("YYYY-MM-DD"),
        // not a full timestamp, which would re-parse to the wrong calendar day server-side.
        const formatDateParam = (value) => {
            if (!(value instanceof Date)) return value || '';

            const year = value.getFullYear();
            const month = String(value.getMonth() + 1).padStart(2, '0');
            const day = String(value.getDate()).padStart(2, '0');

            return `${year}-${month}-${day}`;
        }

        // Shared by buildPrintUrl/buildEmailUrl below - both carry the same full cross-page marked customer id
        // set and date/rollup values, differing only in which action they trigger. Client-side only.
        const buildMarkedActionUrl = (currentRecord, actionValue) => {
            const params = new URLSearchParams(window.location.search);

            params.set(_FIELDS.FORM.START_DATE, formatDateParam(currentRecord.getValue({fieldId: _FIELDS.FORM.START_DATE})));
            params.set(_FIELDS.FORM.STATEMENT_DATE, formatDateParam(currentRecord.getValue({fieldId: _FIELDS.FORM.STATEMENT_DATE})));
            params.set(_FIELDS.FORM.ROLL_PRIOR_CHARGES,
                isChecked(currentRecord.getValue({fieldId: _FIELDS.FORM.ROLL_PRIOR_CHARGES})) ? 'T' : 'F');
            params.set(_FIELDS.ACTION.CUSTOMER_IDS, LIB_FX.getAllMarkedCustomerIds(currentRecord).join(','));
            params.set(_FIELDS.ACTION.PARAM, actionValue);

            return `${window.location.pathname}?${params.toString()}`;
        }

        // Builds the Generate Statement print URL - opened in a new tab that shows a progress page until the
        // merged PDF is ready (see gts_task_lib.js's buildConfirmationForm).
        LIB_FX.buildPrintUrl = (currentRecord) => buildMarkedActionUrl(currentRecord, _FIELDS.ACTION.PRINT_PDF);

        // Builds the Email Statement URL - opened in a new tab that shows a progress page until every marked
        // customer's email has been sent (see gts_task_lib.js's buildEmailConfirmationForm).
        LIB_FX.buildEmailUrl = (currentRecord) => buildMarkedActionUrl(currentRecord, _FIELDS.ACTION.EMAIL_STATEMENT);

        // Builds the URL for a Customer List page change, carrying the requested page index and the full
        // cross-page selection so the next page renders pre-checked. Clears ACTION.PARAM so a page change never
        // reaches the print branch.
        LIB_FX.buildPageNavUrl = (currentRecord, pageIndex) => {
            const params = new URLSearchParams(window.location.search);

            params.set(_FIELDS.PAGE_PARAM, pageIndex);
            params.set(_FIELDS.RESULTS.SELECTED_IDS, LIB_FX.getAllMarkedCustomerIds(currentRecord).join(','));
            params.delete(_FIELDS.ACTION.PARAM);

            return `${window.location.pathname}?${params.toString()}`;
        }

        // Returns the labels of any required fields left blank on the form. Empty array means all are filled in.
        LIB_FX.getMissingRequiredFields = (currentRecord) => {
            return _FIELDS.REQUIRED_FIELD_IDS
                .filter((fieldId) => {
                    const value = currentRecord.getValue({fieldId: fieldId});
                    return value === null || value === '' || (Array.isArray(value) && !value.length);
                })
                .map((fieldId) => _FIELDS.FIELD_LABELS[fieldId] || fieldId);
        }

        // Builds the Customer Statement Suitelet URL Back to Search returns to - no params, so it always lands
        // on a blank Customer/Category search.
        LIB_FX.buildBackToSearchUrl = () => url.resolveScript({
            scriptId: BACK_SCRIPT_ID,
            deploymentId: BACK_DEPLOY_ID,
            params: {}
        });

        return {LIB_FX, _FIELDS};
    });
