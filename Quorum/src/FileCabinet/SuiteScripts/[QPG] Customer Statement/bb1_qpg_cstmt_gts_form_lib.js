/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library that builds the Generate Statement Suitelet form -
 * Start Date/Statement Date/Roll Prior Charges fields, Generate
 * Statement/Email Statement buttons, and a Customer List results sublist.
 * Styled the same as the Tenancy Schedule
 * report's form (bb1_qpg_tschd_report_form_lib.js). Kept separate from
 * bb1_qpg_cstmt_gts_lib_helper.js since it uses the server-only
 * N/ui/serverWidget, N/search and N/runtime modules, which the client
 * script can't load.
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
 * 03-September-2026    Jared Espineli      Start Date/Statement Date marked mandatory (isMandatory - the visual
 *                                          asterisk; the blank-on-click alert lives in the client script, see
 *                                          gts_cs.js/gts_lib_helper.js); Roll Prior Charges into B/f now defaults
 *                                          to checked
 * 03-September-2026    Jared Espineli      Customer List pager restyled (PAGER_STYLE) to look like NetSuite's
 *                                          native list pagination - Previous/Next now render as styled blue
 *                                          links (greyed out, not plain text, when disabled) and a "X to Y of Z"
 *                                          page-range dropdown replaces the old "Page N of M" text; both were
 *                                          already correctly non-clickable in the reported case since a single
 *                                          matching customer with PAGE_SIZE 2 is genuinely only 1 page - this
 *                                          doesn't change that, just how a real 1-vs-many-page state looks/reads.
 *                                          Also added a leftmost row-select checkbox column (RESULTS.SELECT) with
 *                                          a header "select all" (addMarkAllButtons()), matching the native list
 *                                          view's own checkbox column - not yet wired into Generate/Print
 *                                          Statement, which are still otherwise unscoped
 * 03-September-2026    Jared Espineli      Fixed SSS_MISSING_REQD_ARGUMENT on the checkbox column - Sublist.
 *                                          addField treats label: '' as a missing argument; a single space
 *                                          satisfies it while still rendering blank
 * 03-September-2026    Jared Espineli      Added a Back to Search button, before Generate Statement, that
 *                                          returns to the Customer Statement Suitelet via the new
 *                                          gts_lib_helper.js buildBackToSearchUrl()
 * 03-September-2026    Jared Espineli      Renamed the Print Statement button to Email Statement
 *                                          (FORM.PRINT_STATEMENT -> FORM.EMAIL_STATEMENT, functionName
 *                                          printStatement -> emailStatement) - printing now happens off
 *                                          Generate Statement instead (see gts_cs.js)
 * 04-September-2026    Jared Espineli      Fixed marks not surviving pagination: Previous/Next/the page-range
 *                                          dropdown were plain hrefs, so they never saw what was checked on the
 *                                          page being left. buildPageUrl removed; the pager now emits page
 *                                          indices that call gts_cs.js's goToPage() (onclick), which merges the
 *                                          live selection in via gts_lib_helper.js's new buildPageNavUrl before
 *                                          navigating. addResultsSublist now reads that carried-forward
 *                                          selection (getSelectedIdsFromParams) to pre-check a page's own rows,
 *                                          and writes a hidden RESULTS.SELECTED_IDS field holding every OTHER
 *                                          page's marks (this page's own ids are deliberately excluded from it -
 *                                          they're represented by this page's live checkboxes instead, which is
 *                                          what lets unchecking a previously-marked row actually stick)
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/runtime', 'N/log', 'N/ui/serverWidget', './bb1_qpg_cstmt_gts_lib_helper'],
    /**
     * @param{search} search
     * @param{runtime} runtime
     * @param{log} log
     * @param{serverWidget} serverWidget
     * @param{helperLib} helperLib
     */
    (search, runtime, log, serverWidget, helperLib) => {

        const _FIELDS = helperLib._FIELDS;
        const PAGE_SIZE = helperLib.LIB_FX.PAGE_SIZE;

        // Same button styling as the Tenancy Schedule report's Print
        // PDF/Export CSV buttons (bb1_qpg_tschd_report_form_lib.js)
        const BUTTON_STYLE = `
            <style>
                #${_FIELDS.FORM.GENERATE_STATEMENT}, #${_FIELDS.FORM.EMAIL_STATEMENT} {
                    background-color: #2C5266;
                    border-color: #2C5266;
                    color: #FFFFFF;
                }
            </style>
        `;

        // Styles the Previous/Next pager + page-range dropdown to read like
        // NetSuite's own native list pagination (blue clickable links,
        // greyed-out disabled state) instead of plain unstyled text - see
        // buildPagerHtml below for the markup this targets.
        const PAGER_STYLE = `
            <style>
                .bb1-cstmt-pager { font-size: 11px; }
                .bb1-cstmt-pager a { color: #1975FA; text-decoration: none; font-weight: bold; }
                .bb1-cstmt-pager a:hover { text-decoration: underline; }
                .bb1-cstmt-pager .bb1-cstmt-pager-disabled { color: #999999; font-weight: bold; }
                .bb1-cstmt-pager select { margin: 0 6px; }
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

        // Builds the Previous/Next + page-range dropdown pager markup,
        // styled (see PAGER_STYLE) to read like NetSuite's own native list
        // pagination ("X to Y of Z" range selector, blue clickable links)
        // rather than plain text. Previous/Next render as greyed-out
        // (non-link) text when there's no adjacent page in that direction -
        // with a single page, both are always greyed out and the dropdown
        // is skipped in favour of a plain "Showing X of X" summary, since
        // there's nowhere else to navigate to. Each control calls gts_cs.js's
        // goToPage(pageIndex) (NetSuite exposes a clientScriptModulePath
        // export as a plain global function, same mechanism form.addButton's
        // functionName uses) rather than linking to a precomputed URL, so
        // the CURRENT page's live checkbox state is read and merged in at
        // the moment of navigating away - not baked in at render time,
        // which is what let marks made after this page rendered go missing.
        const buildPagerHtml = (pageIndex, pageCount, totalCount) => {
            const hasPrevious = pageIndex > 0;
            const hasNext = pageIndex < pageCount - 1;

            const previousHtml = hasPrevious
                ? `<a href="javascript:void(0);" onclick="goToPage(${pageIndex - 1}); return false;">&laquo; Previous</a>`
                : '<span class="bb1-cstmt-pager-disabled">&laquo; Previous</span>';
            const nextHtml = hasNext
                ? `<a href="javascript:void(0);" onclick="goToPage(${pageIndex + 1}); return false;">Next &raquo;</a>`
                : '<span class="bb1-cstmt-pager-disabled">Next &raquo;</span>';

            if (pageCount <= 1) {
                return `<div class="bb1-cstmt-pager">${previousHtml} &nbsp; Showing ${totalCount} of ${totalCount} &nbsp; ${nextHtml}</div>`;
            }

            let rangeOptions = '';
            for (let p = 0; p < pageCount; p++) {
                const rangeStart = (p * PAGE_SIZE) + 1;
                const rangeEnd = Math.min((p + 1) * PAGE_SIZE, totalCount);
                const selectedAttr = p === pageIndex ? ' selected' : '';
                rangeOptions += `<option value="${p}"${selectedAttr}>${rangeStart} to ${rangeEnd} of ${totalCount}</option>`;
            }

            return `<div class="bb1-cstmt-pager">${previousHtml} ` +
                `&nbsp;<select onchange="if (this.value !== '') goToPage(this.value);">${rangeOptions}</select>&nbsp; ` +
                `${nextHtml}</div>`;
        }

        // Adds the Customer List sublist (one page's worth of rows, per
        // helperLib.LIB_FX.PAGE_SIZE) below the fields
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

            // Every id marked so far, from this page or any other, carried
            // forward via RESULTS.SELECTED_IDS (see gts_lib_helper.js's
            // buildPageNavUrl) - used below both to pre-check this page's
            // own rows and to work out what to exclude from what this page
            // itself carries forward.
            const selectedIds = helperLib.LIB_FX.getSelectedIdsFromParams(params);

            const sublist = form.addSublist({
                id: _FIELDS.RESULTS.SUBLIST_ID,
                type: serverWidget.SublistType.LIST,
                label: `Customer List (${totalCount})`
            });

            sublist.addField({id: _FIELDS.RESULTS.SELECT, type: serverWidget.FieldType.CHECKBOX, label: ' '});
            sublist.addMarkAllButtons();

            sublist.addField({id: _FIELDS.RESULTS.ID, type: serverWidget.FieldType.TEXT, label: 'ID'});
            sublist.addField({id: _FIELDS.RESULTS.CUSTOMER, type: serverWidget.FieldType.TEXT, label: 'Customer'});
            sublist.addField({id: _FIELDS.RESULTS.SUBSIDIARY, type: serverWidget.FieldType.TEXT, label: 'Subsidiary'});
            sublist.addField({id: _FIELDS.RESULTS.CURRENCY, type: serverWidget.FieldType.TEXT, label: 'Currency'});
            sublist.addField({id: _FIELDS.RESULTS.BALANCE, type: serverWidget.FieldType.TEXT, label: 'Balance'});

            rows.forEach((result, line) => {
                // Restores a mark made on an earlier visit to THIS page -
                // e.g. the user marked it, paged away, then paged back.
                const wasMarked = selectedIds.indexOf(String(result.id)) !== -1;
                sublist.setSublistValue({id: _FIELDS.RESULTS.SELECT, line: line, value: wasMarked ? 'T' : 'F'});
                sublist.setSublistValue({id: _FIELDS.RESULTS.ID, line: line, value: result.id || ''});
                sublist.setSublistValue({id: _FIELDS.RESULTS.CUSTOMER, line: line, value: result.getValue({name: 'altname'}) || ''});
                sublist.setSublistValue({id: _FIELDS.RESULTS.SUBSIDIARY, line: line, value: result.getText({name: 'subsidiary'}) || ''});
                sublist.setSublistValue({id: _FIELDS.RESULTS.CURRENCY, line: line, value: result.getText({name: 'currency'}) || ''});
                sublist.setSublistValue({id: _FIELDS.RESULTS.BALANCE, line: line, value: result.getValue({name: 'balance'}) || ''});
            });

            // Carries forward every marked id that does NOT belong to this
            // page - this page's own ids are deliberately left out, since
            // they're represented live by the checkboxes just set above.
            // Without excluding them, unchecking a previously-marked row on
            // a page the user returns to could never actually stick - the
            // hidden field would keep re-adding it back in on every merge.
            const thisPageIds = rows.map((result) => String(result.id));
            const otherPageIds = selectedIds.filter((id) => thisPageIds.indexOf(id) === -1);

            const selectedIdsField = form.addField({
                id: _FIELDS.RESULTS.SELECTED_IDS,
                type: serverWidget.FieldType.LONGTEXT,
                label: 'Selected Customer Ids'
            });
            selectedIdsField.updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN});
            selectedIdsField.defaultValue = otherPageIds.join(',');

            form.addField({
                id: _FIELDS.FORM.PAGER_STYLE,
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Pager Style'
            }).defaultValue = PAGER_STYLE;

            form.addField({
                id: _FIELDS.RESULTS.PAGER,
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Customer List Pager'
            }).defaultValue = buildPagerHtml(pageIndex, pageCount, totalCount);
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

            // Left unstyled (not part of BUTTON_STYLE's selector) so it
            // reads as the secondary/navigation action next to the two
            // primary teal buttons
            form.addButton({
                id: _FIELDS.FORM.BACK_TO_SEARCH,
                label: 'Back to Search',
                functionName: 'backToSearch'
            });

            form.addButton({
                id: _FIELDS.FORM.GENERATE_STATEMENT,
                label: 'Generate Statement',
                functionName: 'generateStatement'
            });

            form.addButton({
                id: _FIELDS.FORM.EMAIL_STATEMENT,
                label: 'Email Statement',
                functionName: 'emailStatement'
            });

            const startDateField = form.addField({
                id: _FIELDS.FORM.START_DATE,
                type: serverWidget.FieldType.DATE,
                label: 'Start Date'
            });
            startDateField.isMandatory = true;

            const statementDateField = form.addField({
                id: _FIELDS.FORM.STATEMENT_DATE,
                type: serverWidget.FieldType.DATE,
                label: 'Statement Date'
            });
            statementDateField.isMandatory = true;

            const rollupField = form.addField({
                id: _FIELDS.FORM.ROLL_PRIOR_CHARGES,
                type: serverWidget.FieldType.CHECKBOX,
                label: 'Roll Prior Chargers into B/f'
            });
            // Defaults to checked - matches the roll-up default in
            // bb1_qpg_cstmt_gts_data_lib.js's buildStatementData (rollup
            // defaults on unless explicitly turned off)
            rollupField.defaultValue = 'T';

            const filters = helperLib.LIB_FX.getFiltersFromParams(params);
            addResultsSublist(form, filters, params);

            return form;
        }

        return {LIB_FX};
    });
