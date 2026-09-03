/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library that builds the Generate Statement Suitelet form -
 * Start Date/Statement Date/Roll Prior Charges fields, Generate
 * Statement/Print Statement buttons (no actions wired up yet), and a
 * Customer List results sublist. Styled the same as the Tenancy Schedule
 * report's form (bb1_qpg_tschd_report_form_lib.js). Kept separate from
 * bb1_qpg_cstmt_gts_lib_helper.js since it uses the server-only
 * N/ui/serverWidget, N/search, N/runtime and N/url modules, which the
 * client script can't load.
 *
 * Date                 Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release - Start Date/Statement Date/Roll Prior Charges
 *                                          fields, Generate Statement/Print Statement buttons
 * 02-September-2026    Jared Espineli      Added the Customer List results sublist (ID/Customer/Subsidiary/
 *                                          Currency/Balance): loads the saved search whose id is set on the
 *                                          custscript_bb1_qpg_cstmt_cust_list_sea script parameter, applies the
 *                                          Customer/Category filter carried over from the Customer Statement
 *                                          Suitelet's Search Customer button (Customer disregards Category when
 *                                          both are present, per spec) on top of the saved search's own filters,
 *                                          then runs it and renders the results
 * 03-September-2026    Jared Espineli      Customer List is now paginated (helperLib.LIB_FX.PAGE_SIZE - 2 rows
 *                                          per page for now) instead of truncated at 200 rows - uses
 *                                          search.runPaged()/fetch() to load one page at a time, with
 *                                          Previous/Next links that reload the Suitelet at the requested page
 *                                          index while preserving the Customer/Category filter
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/runtime', 'N/url', 'N/log', 'N/ui/serverWidget', './bb1_qpg_cstmt_gts_lib_helper'],
    /**
     * @param{search} search
     * @param{runtime} runtime
     * @param{url} url
     * @param{log} log
     * @param{serverWidget} serverWidget
     * @param{helperLib} helperLib
     */
    (search, runtime, url, log, serverWidget, helperLib) => {

        const _FIELDS = helperLib._FIELDS;
        const PAGE_SIZE = helperLib.LIB_FX.PAGE_SIZE;

        // Same button styling as the Tenancy Schedule report's Print
        // PDF/Export CSV buttons (bb1_qpg_tschd_report_form_lib.js)
        const BUTTON_STYLE = `
            <style>
                #${_FIELDS.FORM.GENERATE_STATEMENT}, #${_FIELDS.FORM.PRINT_STATEMENT} {
                    background-color: #2C5266;
                    border-color: #2C5266;
                    color: #FFFFFF;
                }
            </style>
        `;

        const LIB_FX = {};

        // Loads the saved search set on custscript_bb1_qpg_cstmt_cust_list_sea
        // and layers the Customer/Category filter carried over from the
        // Customer Statement Suitelet on top of its own filters - Customer
        // (if present) is the sole extra filter, Category is disregarded
        // when both are present; Category alone is applied when there's no
        // Customer; neither present runs the saved search as-is. Returns
        // null (logging the reason) if the script parameter is blank or the
        // search can't be loaded.
        const loadCustomerListSearch = (filters) => {
            const searchId = runtime.getCurrentScript().getParameter({name: _FIELDS.SCRIPT_PARAM.CUSTOMER_LIST_SEARCH});

            if (!searchId) {
                log.error('Missing script parameter',
                    `${_FIELDS.SCRIPT_PARAM.CUSTOMER_LIST_SEARCH} is not set on this script deployment`);
                return null;
            }

            try {
                const loadedSearch = search.load({id: searchId});

                if (filters.customerId) {
                    const filterExpression = loadedSearch.filterExpression;
                    filterExpression.push('AND', ['internalid', 'anyof', filters.customerId]);
                    loadedSearch.filterExpression = filterExpression;
                } else if (filters.categoryId) {
                    const filterExpression = loadedSearch.filterExpression;
                    filterExpression.push('AND', ['category', 'anyof', filters.categoryId]);
                    loadedSearch.filterExpression = filterExpression;
                }

                return loadedSearch;
            } catch (e) {
                log.error(`search.load failed for id ${searchId}`, e.message);
                return null;
            }
        }

        // Builds the URL for a given Customer List page index (0-based) -
        // this same Suitelet deployment, with the current Customer/Category
        // filter preserved and the page param set. Server-side only (uses
        // runtime.getCurrentScript() to self-reference this deployment).
        const buildPageUrl = (params, pageIndex) => {
            const pageParams = {};

            if (params && params[_FIELDS.SEARCH_PARAM.CUSTOMER]) {
                pageParams[_FIELDS.SEARCH_PARAM.CUSTOMER] = params[_FIELDS.SEARCH_PARAM.CUSTOMER];
            } else if (params && params[_FIELDS.SEARCH_PARAM.CATEGORY]) {
                pageParams[_FIELDS.SEARCH_PARAM.CATEGORY] = params[_FIELDS.SEARCH_PARAM.CATEGORY];
            }

            pageParams[_FIELDS.PAGE_PARAM] = pageIndex;

            return url.resolveScript({
                scriptId: runtime.getCurrentScript().id,
                deploymentId: runtime.getCurrentScript().deploymentId,
                params: pageParams
            });
        }

        // Builds the Previous/Next pager markup for the given page state -
        // either link is plain text (not a link) when there's no adjacent
        // page in that direction.
        const buildPagerHtml = (params, pageIndex, pageCount) => {
            const hasPrevious = pageIndex > 0;
            const hasNext = pageIndex < pageCount - 1;

            const previousHtml = hasPrevious
                ? `<a href="${buildPageUrl(params, pageIndex - 1)}">&laquo; Previous</a>`
                : '&laquo; Previous';
            const nextHtml = hasNext
                ? `<a href="${buildPageUrl(params, pageIndex + 1)}">Next &raquo;</a>`
                : 'Next &raquo;';

            return `<p>${previousHtml} &nbsp;|&nbsp; Page ${pageIndex + 1} of ${pageCount} &nbsp;|&nbsp; ${nextHtml}</p>`;
        }

        // Adds the Customer List sublist (one page's worth of rows, per
        // helperLib.LIB_FX.PAGE_SIZE) below the fields, plus a
        // Previous/Next pager, populated from the loaded/filtered saved
        // search (see loadCustomerListSearch). If the search couldn't be
        // loaded, an inline message is shown instead so the rest of the
        // form still renders.
        const addResultsSublist = (form, filters, params) => {
            const loadedSearch = loadCustomerListSearch(filters);

            if (!loadedSearch) {
                form.addField({
                    id: _FIELDS.RESULTS.SUBLIST_ID,
                    type: serverWidget.FieldType.INLINEHTML,
                    label: 'Customer List'
                }).defaultValue = '<p>Unable to load the Customer List - check the Customer List Search script parameter.</p>';
                return;
            }

            const pagedData = loadedSearch.runPaged({pageSize: PAGE_SIZE});
            const totalCount = pagedData.count;
            log.debug('customerSearchObj result count', totalCount);

            const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
            const requestedPageIndex = helperLib.LIB_FX.getPageIndexFromParams(params);
            const pageIndex = Math.min(requestedPageIndex, pageCount - 1);

            const rows = totalCount ? pagedData.fetch({index: pageIndex}).data : [];

            const sublist = form.addSublist({
                id: _FIELDS.RESULTS.SUBLIST_ID,
                type: serverWidget.SublistType.LIST,
                label: `Customer List (${totalCount})`
            });

            sublist.addField({id: _FIELDS.RESULTS.ID, type: serverWidget.FieldType.TEXT, label: 'ID'});
            sublist.addField({id: _FIELDS.RESULTS.CUSTOMER, type: serverWidget.FieldType.TEXT, label: 'Customer'});
            sublist.addField({id: _FIELDS.RESULTS.SUBSIDIARY, type: serverWidget.FieldType.TEXT, label: 'Subsidiary'});
            sublist.addField({id: _FIELDS.RESULTS.CURRENCY, type: serverWidget.FieldType.TEXT, label: 'Currency'});
            sublist.addField({id: _FIELDS.RESULTS.BALANCE, type: serverWidget.FieldType.TEXT, label: 'Balance'});

            rows.forEach((result, line) => {
                sublist.setSublistValue({id: _FIELDS.RESULTS.ID, line: line, value: result.id || ''});
                sublist.setSublistValue({id: _FIELDS.RESULTS.CUSTOMER, line: line, value: result.getValue({name: 'altname'}) || ''});
                sublist.setSublistValue({id: _FIELDS.RESULTS.SUBSIDIARY, line: line, value: result.getText({name: 'subsidiary'}) || ''});
                sublist.setSublistValue({id: _FIELDS.RESULTS.CURRENCY, line: line, value: result.getText({name: 'currency'}) || ''});
                sublist.setSublistValue({id: _FIELDS.RESULTS.BALANCE, line: line, value: result.getValue({name: 'balance'}) || ''});
            });

            form.addField({
                id: _FIELDS.RESULTS.PAGER,
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Customer List Pager'
            }).defaultValue = buildPagerHtml(params, pageIndex, pageCount);
        }

        // Builds the Generate Statement Suitelet form
        LIB_FX.buildForm = (params) => {
            const form = serverWidget.createForm({title: 'Generate Statement'});

            form.clientScriptModulePath = './bb1_qpg_cstmt_gts_cs.js';

            form.addField({
                id: _FIELDS.FORM.BUTTON_STYLE,
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Button Style'
            }).defaultValue = BUTTON_STYLE;

            form.addButton({
                id: _FIELDS.FORM.GENERATE_STATEMENT,
                label: 'Generate Statement',
                functionName: 'generateStatement'
            });

            form.addButton({
                id: _FIELDS.FORM.PRINT_STATEMENT,
                label: 'Print Statement',
                functionName: 'printStatement'
            });

            form.addField({
                id: _FIELDS.FORM.START_DATE,
                type: serverWidget.FieldType.DATE,
                label: 'Start Date'
            });

            form.addField({
                id: _FIELDS.FORM.STATEMENT_DATE,
                type: serverWidget.FieldType.DATE,
                label: 'Statement Date'
            });

            form.addField({
                id: _FIELDS.FORM.ROLL_PRIOR_CHARGES,
                type: serverWidget.FieldType.CHECKBOX,
                label: 'Roll Prior Chargers into B/f'
            });

            const filters = helperLib.LIB_FX.getFiltersFromParams(params);
            addResultsSublist(form, filters, params);

            return form;
        }

        return {LIB_FX};
    });
