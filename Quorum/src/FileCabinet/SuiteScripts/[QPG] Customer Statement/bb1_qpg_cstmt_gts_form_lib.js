/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library that builds the Generate Statement Suitelet form -
 * Start Date/Statement Date/Roll Prior Charges fields, Generate Statement/
 * Email Statement buttons, and a Customer List results sublist. Kept
 * separate from bb1_qpg_cstmt_gts_lib_helper.js since it uses the
 * server-only N/ui/serverWidget, N/search and N/runtime modules.
 *
 * Date                 Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release - Start/Statement Date/Roll Prior Charges fields,
 *                                          Generate/Email Statement buttons, and the Customer List results
 *                                          sublist (loads the saved search, applies the Customer/Category
 *                                          filter).
 * 03-September-2026    Jared Espineli      Added Customer List pagination and its styled pager, mandatory
 *                                          Start/Statement Date with Roll Prior Charges defaulting on, the
 *                                          row-select checkbox column, a Back to Search button, and renamed
 *                                          Print Statement to Email Statement.
 * 04-September-2026    Jared Espineli      Fixed marks not surviving pagination and Mark All only reaching the
 *                                          current page by adding cross-page selection tracking and Select
 *                                          All/Clear All, then moved Select All/Clear All/Previous/Next onto the
 *                                          Customer List sublist's own toolbar for visibility.
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

        // Same button styling as the Tenancy Schedule report's Print PDF/Export CSV buttons.
        const BUTTON_STYLE = `
            <style>
                #${_FIELDS.FORM.GENERATE_STATEMENT}, #${_FIELDS.FORM.EMAIL_STATEMENT} {
                    background-color: #2C5266;
                    border-color: #2C5266;
                    color: #FFFFFF;
                }
            </style>
        `;

        const LIB_FX = {};

        // Loads the saved search set on custscript_bb1_qpg_cstmt_cust_list_sea and layers the Customer/Category
        // filter on top - Customer wins when both are present. Returns null (logging why) if unavailable.
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

        // Builds the Customer List sublist's own label, folding in the current page's "X to Y of Z" range.
        const buildSublistRangeLabel = (pageIndex, totalCount) => {
            if (!totalCount) return 'Customer List (0)';

            const rangeStart = (pageIndex * PAGE_SIZE) + 1;
            const rangeEnd = Math.min((pageIndex + 1) * PAGE_SIZE, totalCount);

            return `Customer List - Showing ${rangeStart} to ${rangeEnd} of ${totalCount}`;
        }

        // Returns the internal ids of EVERY row matching the given search (all pages), used to back Select All.
        // search.run().getRange() caps at 1000 rows per call, so this pages through in 1000-row chunks.
        const getAllResultIds = (loadedSearch, totalCount) => {
            const ids = [];
            let start = 0;

            while (start < totalCount) {
                const end = Math.min(start + 1000, totalCount);
                loadedSearch.run().getRange({start: start, end: end}).forEach((result) => {
                    ids.push(String(result.id));
                });
                start = end;
            }

            return ids;
        }

        // Adds the Select All/Clear All/Previous/Next controls directly onto the Customer List sublist's own
        // toolbar via sublist.addButton() - Previous/Next are greyed out (Button.isDisabled) rather than omitted
        // when there's no adjacent page, so their position never shifts.
        const addSublistToolbarButtons = (sublist, totalCount, pageIndex, pageCount) => {
            if (totalCount) {
                sublist.addButton({
                    id: _FIELDS.RESULTS.SELECT_ALL_BUTTON,
                    label: `Select All (${totalCount})`,
                    functionName: 'selectAllPages'
                });
                sublist.addButton({
                    id: _FIELDS.RESULTS.CLEAR_ALL_BUTTON,
                    label: 'Clear All',
                    functionName: 'clearAllPages'
                });
            }

            const previousButton = sublist.addButton({
                id: _FIELDS.RESULTS.PREVIOUS_BUTTON,
                label: '« Previous',
                functionName: 'goToPreviousPage'
            });
            previousButton.isDisabled = pageIndex <= 0;

            const nextButton = sublist.addButton({
                id: _FIELDS.RESULTS.NEXT_BUTTON,
                label: 'Next »',
                functionName: 'goToNextPage'
            });
            nextButton.isDisabled = pageIndex >= pageCount - 1;
        }

        // Adds the Customer List sublist (one page's worth of rows, per helperLib.LIB_FX.PAGE_SIZE) below the fields
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

            // Every id marked so far, from this page or any other, carried forward via RESULTS.SELECTED_IDS.
            const selectedIds = helperLib.LIB_FX.getSelectedIdsFromParams(params);

            // Every id matching the search, across all pages - backs the Select All button (RESULTS.ALL_IDS below).
            const allIds = getAllResultIds(loadedSearch, totalCount);

            const sublist = form.addSublist({
                id: _FIELDS.RESULTS.SUBLIST_ID,
                type: serverWidget.SublistType.LIST,
                label: buildSublistRangeLabel(pageIndex, totalCount)
            });

            addSublistToolbarButtons(sublist, totalCount, pageIndex, pageCount);

            sublist.addField({id: _FIELDS.RESULTS.SELECT, type: serverWidget.FieldType.CHECKBOX, label: ' '});

            sublist.addField({id: _FIELDS.RESULTS.ID, type: serverWidget.FieldType.TEXT, label: 'ID'});
            sublist.addField({id: _FIELDS.RESULTS.CUSTOMER, type: serverWidget.FieldType.TEXT, label: 'Customer'});
            sublist.addField({id: _FIELDS.RESULTS.SUBSIDIARY, type: serverWidget.FieldType.TEXT, label: 'Subsidiary'});
            sublist.addField({id: _FIELDS.RESULTS.CURRENCY, type: serverWidget.FieldType.TEXT, label: 'Currency'});
            sublist.addField({id: _FIELDS.RESULTS.BALANCE, type: serverWidget.FieldType.TEXT, label: 'Balance'});

            rows.forEach((result, line) => {
                // Restores a mark made on an earlier visit to THIS page.
                const wasMarked = selectedIds.indexOf(String(result.id)) !== -1;
                sublist.setSublistValue({id: _FIELDS.RESULTS.SELECT, line: line, value: wasMarked ? 'T' : 'F'});
                sublist.setSublistValue({id: _FIELDS.RESULTS.ID, line: line, value: result.id || ''});
                sublist.setSublistValue({id: _FIELDS.RESULTS.CUSTOMER, line: line, value: result.getValue({name: 'altname'}) || ''});
                sublist.setSublistValue({id: _FIELDS.RESULTS.SUBSIDIARY, line: line, value: result.getText({name: 'subsidiary'}) || ''});
                sublist.setSublistValue({id: _FIELDS.RESULTS.CURRENCY, line: line, value: result.getText({name: 'currency'}) || ''});
                sublist.setSublistValue({id: _FIELDS.RESULTS.BALANCE, line: line, value: result.getValue({name: 'balance'}) || ''});
            });

            // Carries forward every marked id that does NOT belong to this page - this page's own ids are
            // represented live by the checkboxes just set above, so unchecking a row here actually sticks.
            const thisPageIds = rows.map((result) => String(result.id));
            const otherPageIds = selectedIds.filter((id) => thisPageIds.indexOf(id) === -1);

            const selectedIdsField = form.addField({
                id: _FIELDS.RESULTS.SELECTED_IDS,
                type: serverWidget.FieldType.LONGTEXT,
                label: 'Selected Customer Ids'
            });
            selectedIdsField.updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN});
            selectedIdsField.defaultValue = otherPageIds.join(',');

            // Carries the full server-computed result set forward for selectAllPages() to read.
            const allIdsField = form.addField({
                id: _FIELDS.RESULTS.ALL_IDS,
                type: serverWidget.FieldType.LONGTEXT,
                label: 'All Customer Ids'
            });
            allIdsField.updateDisplayType({displayType: serverWidget.FieldDisplayType.HIDDEN});
            allIdsField.defaultValue = allIds.join(',');
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

            // Left unstyled so it reads as the secondary/navigation action next to the two primary buttons
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
            // Defaults to checked - matches gts_data_lib.js's buildStatementData rollup default
            rollupField.defaultValue = 'T';

            const filters = helperLib.LIB_FX.getFiltersFromParams(params);
            addResultsSublist(form, filters, params);

            return form;
        }

        return {LIB_FX};
    });
