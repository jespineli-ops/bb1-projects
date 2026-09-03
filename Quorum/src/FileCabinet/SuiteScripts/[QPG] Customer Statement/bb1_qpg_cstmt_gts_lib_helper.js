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
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define([],
    () => {

        // field/button ids used on the Generate Statement Suitelet form
        const _FIELDS = {
            FORM: {
                BUTTON_STYLE:       'custpage_qpg_cstmt_gts_button_style',
                GENERATE_STATEMENT: 'custpage_qpg_cstmt_gts_generate',
                PRINT_STATEMENT:    'custpage_qpg_cstmt_gts_print',
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
                ID:         'custpage_qpg_cstmt_gts_res_id',
                CUSTOMER:   'custpage_qpg_cstmt_gts_res_customer',
                SUBSIDIARY: 'custpage_qpg_cstmt_gts_res_subsidiary',
                CURRENCY:   'custpage_qpg_cstmt_gts_res_currency',
                BALANCE:    'custpage_qpg_cstmt_gts_res_balance',
                PAGER:      'custpage_qpg_cstmt_gts_pager'
            },
            // Query param carrying the Customer List's current page index
            // (0-based) - read back on the next request to render that page
            PAGE_PARAM: 'custpage_qpg_cstmt_gts_page'
        }

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

        return {LIB_FX, _FIELDS};
    });
