/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Shared library (field ids + request-param helper) used by both the
 * Generate Statement Suitelet and its client script.
 *
 * Date                 Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release - adds field ids for the Generate Statement form, its
 *                                          filters, and script parameters.
 * 03-September-2026    Jared Espineli      Added pagination, required-field validation, sublist/pager field ids,
 *                                          and Back to Search.
 * 04-September-2026    Jared Espineli      Added cross-page selection (Select All/Clear All) and reworked
 *                                          Generate Statement onto a background Map/Reduce job with a progress
 *                                          page.
 * 07-September-2026    Jared Espineli      Replaced Previous/Next with a page-range dropdown and added the Email
 *                                          Statement action with its own background job.
 * 08-September-2026    Jared Espineli      Exposed the Back to Search script/deployment ids so other scripts can
 *                                          redirect there server-side.
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
            // Query param keys this Suitelet is reached with, from the Customer List search.
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
                // Sublist toolbar buttons rendered above the Customer List rows.
                SELECT_ALL_BUTTON: 'custpage_qpg_cstmt_gts_res_select_all',
                CLEAR_ALL_BUTTON:  'custpage_qpg_cstmt_gts_res_clear_all',
                // Page-range dropdown ("1-15", "16-30", ...) rendered above the sublist. Changing it navigates
                // to that page.
                PAGE_SELECT:       'custpage_qpg_cstmt_gts_res_page_select',
                // Hidden field carrying forward marked customer ids from other pages.
                SELECTED_IDS: 'custpage_qpg_cstmt_gts_selected_ids',
                // Hidden field holding every customer id matching the current search, across all pages.
                ALL_IDS:    'custpage_qpg_cstmt_gts_all_ids'
            },
            // Query param carrying the Customer List's current page index (0-based).
            PAGE_PARAM: 'custpage_qpg_cstmt_gts_page',
            // Generate Statement's print action, which queues the PDF-merge background job.
            ACTION: {
                PARAM:         'custpage_qpg_cstmt_gts_action',
                PRINT_PDF:     'printpdf',
                // Comma-separated customer ids checked in the Customer List, carried as a request param.
                CUSTOMER_IDS:  'custpage_qpg_cstmt_gts_customer_ids',
                // Status-check endpoint polled by the progress page. Returns JSON.
                STATUS_CHECK:  'statuscheck',
                // Query param carrying the real NetSuite task id, used only for progress polling.
                TASK_ID:       'custpage_qpg_cstmt_gts_task_id',
                // Query param carrying the self-generated run id used as the job's status-cache key.
                RUN_ID:        'custpage_qpg_cstmt_gts_run_id',
                // Action the progress page navigates to once the PDF is ready - streams then deletes the temp file.
                DOWNLOAD_PDF:  'downloadpdf',
                // Query param carrying the temp file's id, read back by the DOWNLOAD_PDF branch.
                FILE_ID:       'custpage_qpg_cstmt_gts_file_id',
                // Email Statement's own action, which queues the email-sending background job.
                EMAIL_STATEMENT: 'emailstatement'
            },
            // The PDF-merge Map/Reduce job's script id, parameters, and status-cache name. Deployment note:
            // created manually in the NetSuite UI, not tracked by this project's SDF source.
            MR: {
                SCRIPT_ID: 'customscript_bb1_qpg_cstmt_gts_mr',
                PARAM: {
                    CUSTOMER_IDS:   'custscript_bb1_qpg_cstmt_mr_customer_ids',
                    START_DATE:     'custscript_bb1_qpg_cstmt_mr_start_date',
                    STATEMENT_DATE: 'custscript_bb1_qpg_cstmt_mr_stmnt_date',
                    ROLLUP:         'custscript_bb1_qpg_cstmt_mr_rollup',
                    // Self-generated run id used as the status-cache key.
                    RUN_ID:         'custscript_bb1_qpg_cstmt_mr_run_id'
                },
                // N/cache key namespace the job writes status to, keyed by RUN_ID.
                STATUS_CACHE_NAME: 'bb1_qpg_cstmt_gts_status'
            },
            // The Email Statement Map/Reduce job's script id and parameters. Deployment note: created manually
            // in the NetSuite UI, not tracked by this project's SDF source.
            EMAIL_MR: {
                SCRIPT_ID: 'customscript_bb1_qpg_cstmt_gts_email_mr',
                PARAM: {
                    CUSTOMER_IDS:   'custscript_bb1_qpg_cstmt_eml_cust_ids',
                    START_DATE:     'custscript_bb1_qpg_cstmt_eml_start_date',
                    STATEMENT_DATE: 'custscript_bb1_qpg_cstmt_eml_stmnt_date',
                    ROLLUP:         'custscript_bb1_qpg_cstmt_eml_rollup',
                    RUN_ID:         'custscript_bb1_qpg_cstmt_eml_run_id',
                    // Internal id of the employee the statement emails are sent as.
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

        // Customer List rows per page.
        const PAGE_SIZE = 15;

        const LIB_FX = {};

        LIB_FX.PAGE_SIZE = PAGE_SIZE;

        // Builds the customer-list filter object from the Suitelet's request params.
        LIB_FX.getFiltersFromParams = (params) => ({
            customerId: (params && params[_FIELDS.SEARCH_PARAM.CUSTOMER]) || '',
            categoryId: (params && params[_FIELDS.SEARCH_PARAM.CATEGORY]) || ''
        });

        // Reads the requested Customer List page index off request params, defaulting to 0 when missing/invalid.
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

        // Reads the accumulated cross-page selection off request params.
        LIB_FX.getSelectedIdsFromParams = (params) => LIB_FX.parseIdListParam(params && params[_FIELDS.RESULTS.SELECTED_IDS]);

        // Returns whether a checkbox value is checked, handling both 'T'/'F' and boolean forms.
        const isChecked = (value) => value === 'T' || value === true;

        // Returns the customer ids checked in the Customer List on the current page only.
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

        // Returns the full cross-page selection - current page marks plus ids carried forward from other pages.
        LIB_FX.getAllMarkedCustomerIds = (currentRecord) => {
            const currentPageIds = LIB_FX.getMarkedCustomerIds(currentRecord);
            const carriedIds = LIB_FX.parseIdListParam(currentRecord.getValue({fieldId: _FIELDS.RESULTS.SELECTED_IDS}));

            return Array.from(new Set(carriedIds.concat(currentPageIds)));
        }

        // Selects every customer across all pages, not just the current page.
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

        // Clears the selection across all pages.
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

        // Formats a Date field's value as a local YYYY-MM-DD string for the request param.
        const formatDateParam = (value) => {
            if (!(value instanceof Date)) return value || '';

            const year = value.getFullYear();
            const month = String(value.getMonth() + 1).padStart(2, '0');
            const day = String(value.getDate()).padStart(2, '0');

            return `${year}-${month}-${day}`;
        }

        // Builds the shared URL used by both buildPrintUrl and buildEmailUrl.
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

        // Builds the Generate Statement print URL, opened in a new tab showing a progress page.
        LIB_FX.buildPrintUrl = (currentRecord) => buildMarkedActionUrl(currentRecord, _FIELDS.ACTION.PRINT_PDF);

        // Builds the Email Statement URL, opened in a new tab showing a progress page.
        LIB_FX.buildEmailUrl = (currentRecord) => buildMarkedActionUrl(currentRecord, _FIELDS.ACTION.EMAIL_STATEMENT);

        // Builds the URL for a Customer List page change, carrying the requested page and current selection.
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

        // Builds the Back to Search URL, landing on a blank Customer/Category search.
        LIB_FX.buildBackToSearchUrl = () => url.resolveScript({
            scriptId: BACK_SCRIPT_ID,
            deploymentId: BACK_DEPLOY_ID,
            params: {}
        });

        // Same Back to Search target as raw script/deployment ids, for a server-side redirect.
        LIB_FX.BACK_TO_SEARCH = {scriptId: BACK_SCRIPT_ID, deploymentId: BACK_DEPLOY_ID};

        return {LIB_FX, _FIELDS};
    });
