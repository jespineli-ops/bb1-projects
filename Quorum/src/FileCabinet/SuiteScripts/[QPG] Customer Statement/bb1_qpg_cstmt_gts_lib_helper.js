/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Shared library (field ids + request-param helper) used by both the
 * Generate Statement Suitelet and its client script.
 *
 * Date                 Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release - Start Date/Statement Date/Roll Prior Charges
 *                                          fields, Generate Statement/Print Statement buttons
 * 02-September-2026    Jared Espineli      Added the Customer/Category filter param ids (carried over from the
 *                                          Customer Statement Suitelet's Search Customer button), the Customer
 *                                          List Search script parameter id, and the results sublist field ids
 * 03-September-2026    Jared Espineli      Added PAGE_PARAM (the query param carrying the current page index)
 *                                          and PAGE_SIZE (rows per page - set to 2 for now, per current
 *                                          requirements) for Customer List pagination
 * 03-September-2026    Jared Espineli      Added REQUIRED_FIELD_IDS/FIELD_LABELS (Start Date, Statement Date)
 *                                          and getMissingRequiredFields(), so the client script can block
 *                                          Generate/Print Statement and alert the user when either is blank -
 *                                          same pattern as the Tenancy Schedule report's As of Date
 *                                          (bb1_qpg_tschd_report_lib_helper.js)
 * 03-September-2026    Jared Espineli      Added RESULTS.SELECT (leftmost row-select checkbox column id) and
 *                                          FORM.PAGER_STYLE (id for the pager's own INLINEHTML style block) -
 *                                          see gts_form_lib.js for the actual markup/behavior
 * 03-September-2026    Jared Espineli      Added N/url + FORM.BACK_TO_SEARCH and buildBackToSearchUrl(), for a
 *                                          new Back to Search button that returns to the Customer Statement
 *                                          Suitelet (customscript_bb1_qpg_cstmt_cls_sl) - reverse direction of
 *                                          cls_lib_helper.js's own buildSearchUrl()
 * 03-September-2026    Jared Espineli      Renamed FORM.PRINT_STATEMENT to FORM.EMAIL_STATEMENT - printing now
 *                                          happens off the Generate Statement button instead. Added the ACTION
 *                                          param block (PARAM/PRINT_PDF/CUSTOMER_IDS), parseIdListParam(), and
 *                                          getMarkedCustomerIds()/buildPrintUrl() so the client script can
 *                                          collect every customer checked in the Customer List and send it,
 *                                          with the Start Date/Statement Date/Roll Prior Charges values, to
 *                                          this same Suitelet for PDF rendering - same request-param pattern
 *                                          as the Tenancy Schedule report's buildReportUrl
 *                                          (bb1_qpg_tschd_report_lib_helper.js)
 * 03-September-2026    Jared Espineli      Fixed Generate Statement always reporting "no customer marked" even
 *                                          with a row checked - getMarkedCustomerIds()/buildPrintUrl's Roll
 *                                          Prior Charges read only accepted the sublist checkbox value as the
 *                                          string 'T'; on this page's own custpage_ fields (not a record-backed
 *                                          sublist) currentRecord can hand a checkbox back as a plain boolean
 *                                          true instead. New isChecked() accepts both.
 * 04-September-2026    Jared Espineli      Fixed marks not surviving Customer List pagination - getMarkedCustomerIds
 *                                          only ever saw the CURRENT page's checkboxes, so paging away and back (or
 *                                          straight to Generate Statement from a different page) silently dropped
 *                                          anything marked earlier. Added RESULTS.SELECTED_IDS (a hidden field
 *                                          carrying every OTHER page's marks forward - see gts_form_lib.js for how
 *                                          it's populated/pre-checks rows), getSelectedIdsFromParams(), and
 *                                          getAllMarkedCustomerIds() (union of the current page's live marks and
 *                                          that hidden field). buildPrintUrl now uses getAllMarkedCustomerIds
 *                                          instead of getMarkedCustomerIds. Added buildPageNavUrl() so the
 *                                          Previous/Next/page-range pager (now driven by gts_cs.js's goToPage(),
 *                                          not a plain href) carries the merged selection forward on every page
 *                                          change, not just at Generate Statement time
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

        // Script/deployment id of the Customer Statement Suitelet that Back
        // to Search returns to - reverse of cls_lib_helper.js's own
        // TARGET_SCRIPT_ID/TARGET_DEPLOY_ID (which point the other way, cls
        // -> gts), same naming pattern.
        const BACK_SCRIPT_ID = 'customscript_bb1_qpg_cstmt_cls_sl';
        const BACK_DEPLOY_ID = 'customdeploy_bb1_qpg_cstmt_cls_sl';

        // field/button ids used on the Generate Statement Suitelet form
        const _FIELDS = {
            FORM: {
                BUTTON_STYLE:       'custpage_qpg_cstmt_gts_button_style',
                PAGER_STYLE:        'custpage_qpg_cstmt_gts_pager_style',
                BACK_TO_SEARCH:     'custpage_qpg_cstmt_gts_back',
                GENERATE_STATEMENT: 'custpage_qpg_cstmt_gts_generate',
                EMAIL_STATEMENT:    'custpage_qpg_cstmt_gts_email',
                START_DATE:         'custpage_qpg_cstmt_gts_start_date',
                STATEMENT_DATE:     'custpage_qpg_cstmt_gts_statement_date',
                ROLL_PRIOR_CHARGES: 'custpage_qpg_cstmt_gts_roll_prior_charges'
            },
            // Query param keys this Suitelet is reached with, from the
            // Customer Statement Suitelet's Search Customer button - must
            // match bb1_qpg_cstmt_cls_lib_helper.js's _FIELDS.SEARCH_PARAM
            SEARCH_PARAM: {
                CUSTOMER: 'custpage_qpg_cstmt_filter_customer',
                CATEGORY: 'custpage_qpg_cstmt_filter_category'
            },
            // Script parameter id, on this Suitelet's deployment, holding
            // the internal id of the saved Customer List search to load
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
                PAGER:      'custpage_qpg_cstmt_gts_pager',
                // Hidden field carrying forward every marked customer id
                // that belongs to a page OTHER than the one currently
                // rendered - see gts_form_lib.js's addResultsSublist for how
                // it's populated (and how it pre-checks a page's own rows)
                // and getAllMarkedCustomerIds() below for how it's merged
                // back in with the current page's live checkbox state.
                SELECTED_IDS: 'custpage_qpg_cstmt_gts_selected_ids'
            },
            // Query param carrying the Customer List's current page index
            // (0-based) - read back on the next request to render that page
            PAGE_PARAM: 'custpage_qpg_cstmt_gts_page',
            // Generate Statement's print action - request params this
            // Suitelet is reached with from buildPrintUrl() below, read back
            // by gts_pdf_lib.js's buildPdf()
            ACTION: {
                PARAM:         'custpage_qpg_cstmt_gts_action',
                PRINT_PDF:     'printpdf',
                // Comma-separated customer internal ids, from every row
                // checked in the Customer List (see getMarkedCustomerIds) -
                // the sublist selection only exists in the browser, so it
                // has to be carried across as its own param rather than
                // re-read server-side
                CUSTOMER_IDS:  'custpage_qpg_cstmt_gts_customer_ids'
            }
        }

        // Form fields that must have a value before a statement can be
        // generated/printed - same pattern as the Tenancy Schedule report's
        // As of Date (bb1_qpg_tschd_report_lib_helper.js)
        _FIELDS.REQUIRED_FIELD_IDS = [
            _FIELDS.FORM.START_DATE,
            _FIELDS.FORM.STATEMENT_DATE
        ];

        // Human-readable labels for required field ids, used in the missing-fields alert
        _FIELDS.FIELD_LABELS = {
            [_FIELDS.FORM.START_DATE]: 'Start Date',
            [_FIELDS.FORM.STATEMENT_DATE]: 'Statement Date'
        };

        // Customer List rows per page - set to 2 for now, per current
        // requirements. Single source of truth for form_lib's pagination.
        const PAGE_SIZE = 2;

        const LIB_FX = {};

        LIB_FX.PAGE_SIZE = PAGE_SIZE;

        // Builds the customer-list filter object from the Suitelet's
        // request params (see cls's buildSearchUrl) - shared by the
        // Suitelet/form lib.
        LIB_FX.getFiltersFromParams = (params) => ({
            customerId: (params && params[_FIELDS.SEARCH_PARAM.CUSTOMER]) || '',
            categoryId: (params && params[_FIELDS.SEARCH_PARAM.CATEGORY]) || ''
        });

        // Reads the requested Customer List page index (0-based) off the
        // Suitelet's request params - defaults to 0 (first page) when
        // missing/not a valid non-negative integer. Caller (form_lib) still
        // needs to clamp this against the actual page count once the search
        // has run, since the total isn't known yet at this point.
        LIB_FX.getPageIndexFromParams = (params) => {
            const raw = params && params[_FIELDS.PAGE_PARAM];
            const pageIndex = parseInt(raw, 10);
            return isNaN(pageIndex) || pageIndex < 0 ? 0 : pageIndex;
        }

        // Splits a comma-separated request param (as set by buildPrintUrl)
        // back into an array of id strings. '' / null / undefined -> [].
        // Server-side only consumer is gts_pdf_lib.js, but this has no
        // server-only dependencies so it works from the client script too.
        LIB_FX.parseIdListParam = (value) => {
            if (value === null || value === undefined || value === '') return [];
            return String(value).split(',').map((id) => id.trim()).filter(Boolean);
        }

        // Reads the accumulated cross-page selection (RESULTS.SELECTED_IDS)
        // off the Suitelet's request params - the ids marked on every page
        // OTHER than whichever one is about to render. Server-side, used by
        // gts_form_lib.js to pre-check a page's own rows and to work out
        // what to exclude from what it carries forward in the hidden field
        // (see that file's addResultsSublist).
        LIB_FX.getSelectedIdsFromParams = (params) => LIB_FX.parseIdListParam(params && params[_FIELDS.RESULTS.SELECTED_IDS]);

        // A checkbox field on a Suitelet's OWN page (custpage_... fields,
        // not a record-backed sublist) can come back from currentRecord as
        // either the usual 'T'/'F' string or a plain boolean true/false,
        // depending on how the platform renders that particular field/
        // sublist combination - unlike a standard record's checkbox
        // fields, which are consistently 'T'/'F'. Treat both as valid so a
        // genuinely-checked box is never misread as unmarked.
        const isChecked = (value) => value === 'T' || value === true;

        // Returns the internal ids of every customer checked in the
        // Customer List sublist (RESULTS.SELECT) on the CURRENT page only -
        // a marked row on a page the user has since paged away from isn't
        // visible to the browser any more, so it can't be collected here.
        // Client-side only (reads sublist values off the rendered form).
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

        // The full cross-page selection: every id marked on the current
        // page (live checkbox state) plus every id carried forward from
        // other pages (RESULTS.SELECTED_IDS's hidden-field value, set by
        // gts_form_lib.js when this page was rendered). That hidden field
        // never includes ids belonging to the CURRENT page's own rows (see
        // addResultsSublist), so the two sources can't double up on, or
        // fight over, the same row - the current page's live state is
        // always the one that wins for its own rows, which is what lets
        // unchecking a previously-marked row actually stick. De-duplicated
        // via Set purely as a safety net. Client-side only.
        LIB_FX.getAllMarkedCustomerIds = (currentRecord) => {
            const currentPageIds = LIB_FX.getMarkedCustomerIds(currentRecord);
            const carriedIds = LIB_FX.parseIdListParam(currentRecord.getValue({fieldId: _FIELDS.RESULTS.SELECTED_IDS}));

            return Array.from(new Set(carriedIds.concat(currentPageIds)));
        }

        // A DATE field's getValue() returns a Date object - sent as this
        // browser's local Y/M/D ("YYYY-MM-DD"), not the Date's full
        // toString()/timezone text, which would re-parse to the wrong
        // calendar day server-side. Same fix as the Tenancy Schedule
        // report's buildReportUrl (bb1_qpg_tschd_report_lib_helper.js).
        const formatDateParam = (value) => {
            if (!(value instanceof Date)) return value || '';

            const year = value.getFullYear();
            const month = String(value.getMonth() + 1).padStart(2, '0');
            const day = String(value.getDate()).padStart(2, '0');

            return `${year}-${month}-${day}`;
        }

        // Builds the Generate Statement print URL: this same Suitelet
        // deployment, with the FULL cross-page marked customer id set
        // (getAllMarkedCustomerIds - not just this page's own) plus the
        // Start Date/Statement Date/Roll Prior Charges values and the print
        // action flag. Client-side only (uses window.location,
        // currentRecord's sublist values).
        LIB_FX.buildPrintUrl = (currentRecord) => {
            const params = new URLSearchParams(window.location.search);

            params.set(_FIELDS.FORM.START_DATE, formatDateParam(currentRecord.getValue({fieldId: _FIELDS.FORM.START_DATE})));
            params.set(_FIELDS.FORM.STATEMENT_DATE, formatDateParam(currentRecord.getValue({fieldId: _FIELDS.FORM.STATEMENT_DATE})));
            params.set(_FIELDS.FORM.ROLL_PRIOR_CHARGES,
                isChecked(currentRecord.getValue({fieldId: _FIELDS.FORM.ROLL_PRIOR_CHARGES})) ? 'T' : 'F');
            params.set(_FIELDS.ACTION.CUSTOMER_IDS, LIB_FX.getAllMarkedCustomerIds(currentRecord).join(','));
            params.set(_FIELDS.ACTION.PARAM, _FIELDS.ACTION.PRINT_PDF);

            return `${window.location.pathname}?${params.toString()}`;
        }

        // Builds the URL for a Customer List page change (Previous/Next/the
        // page-range dropdown - see gts_cs.js's goToPage()): this same
        // Suitelet, with the Customer/Category filter preserved (it's
        // already in window.location.search), the requested page index,
        // and the full cross-page selection so far (this page's live marks
        // plus every other page's carried-forward ids) so the NEXT page
        // renders with its own rows correctly pre-checked. Explicitly
        // clears ACTION.PARAM in case it was ever present, so a page change
        // never accidentally reaches the print branch. Client-side only.
        LIB_FX.buildPageNavUrl = (currentRecord, pageIndex) => {
            const params = new URLSearchParams(window.location.search);

            params.set(_FIELDS.PAGE_PARAM, pageIndex);
            params.set(_FIELDS.RESULTS.SELECTED_IDS, LIB_FX.getAllMarkedCustomerIds(currentRecord).join(','));
            params.delete(_FIELDS.ACTION.PARAM);

            return `${window.location.pathname}?${params.toString()}`;
        }

        // Returns the labels of any required fields (see _FIELDS.REQUIRED_FIELD_IDS)
        // left blank on the form. Empty array means all required fields are filled in.
        LIB_FX.getMissingRequiredFields = (currentRecord) => {
            return _FIELDS.REQUIRED_FIELD_IDS
                .filter((fieldId) => {
                    const value = currentRecord.getValue({fieldId: fieldId});
                    return value === null || value === '' || (Array.isArray(value) && !value.length);
                })
                .map((fieldId) => _FIELDS.FIELD_LABELS[fieldId] || fieldId);
        }

        // Builds the Customer Statement Suitelet URL that Back to Search
        // returns to - no params, so it always lands on a blank
        // Customer/Category search rather than trying to restore the
        // previous selection (cls's form doesn't read params back in yet -
        // see bb1_qpg_cstmt_cls_form_lib.js's buildForm). Works both
        // server-side (gts_sl.js, though not currently called from there)
        // and client-side (gts_cs.js) - N/url.resolveScript runs in both.
        LIB_FX.buildBackToSearchUrl = () => url.resolveScript({
            scriptId: BACK_SCRIPT_ID,
            deploymentId: BACK_DEPLOY_ID,
            params: {}
        });

        return {LIB_FX, _FIELDS};
    });
