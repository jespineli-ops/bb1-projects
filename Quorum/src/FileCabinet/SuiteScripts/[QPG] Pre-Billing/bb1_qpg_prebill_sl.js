/**
 * Project: Quorum (Q Holdings) - P102843
 *
 * Teamwork task: [TEAMWORK TASK LINK OR N/A - confirm before deployment]
 *
 * Suitelet for the MRI-style Pre-Billing Check tenant billing history report.
 * Form field setup and dispatch only - see bb1_qpg_prebill_lib.js for the
 * data assembly, classification and rendering.
 *
 * Date              Author              Purpose
 * 16-September-2026 Jared Espineli      Initial Release
 * 18-September-2026 Jared Espineli      Added screen pagination (Previous/Next), ported from
 *                                       Andile's bb1_qhold_billhist_su.js POC. Cleared the
 *                                       Latest Billing Period/Number Of Periods defaults so the
 *                                       selection form loads blank.
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */

define(['N/ui/serverWidget', 'N/log', './bb1_qpg_prebill_lib'],

    function (serverWidget, log, prebillLib) {

        var LIB_FX = prebillLib.LIB_FX;
        var _CONST = prebillLib._CONST;

        // Bump on every upload - written to the execution log and shown on error
        var SCRIPT_VERSION = 'v2-2026-09-18';

        //-----------------------------------------------
        //Main entry point
        //-----------------------------------------------
        function onRequest(context) {

            try {

                log.debug('Pre-Billing Suitelet version', SCRIPT_VERSION);

                var request  = context.request;
                var response = context.response;

                var filters = LIB_FX.readFilters(request);

                // Property Portfolio can stand in for a single Property; Accommodation
                // Type alone never can, since it isn't bounded to a property set
                if (!filters.propertyId && !filters.customerId && !filters.portfolioIds.length) {
                    response.writePage({ pageObject: buildSelectionForm(filters) });
                    return;
                }

                var data = LIB_FX.buildHistory(filters);

                log.debug('Tenants assembled', data.tenants.length);

                if (filters.mode === 'pdf') {
                    LIB_FX.renderPdf(response, data);
                    return;
                }

                if (filters.mode === 'csv') {
                    LIB_FX.renderCsv(response, data);
                    return;
                }

                renderScreen(response, data);

            } catch (e) {
                log.error('Billing history generation failed', e);
                context.response.write({
                    output: '[' + SCRIPT_VERSION + '] The billing history could not be produced: ' + e.message
                });
            }
        }

        //-----------------------------------------------
        //Criteria form
        //-----------------------------------------------
        function buildSelectionForm(filters) {

            var form = serverWidget.createForm({ title: 'BB1 ' + _CONST.REPORT_TITLE });

            form.addFieldGroup({ id: 'custpage_grp_criteria', label: 'Selection' });

            var portfolioField = form.addField({
                id:        'custparam_portfolio',
                type:      serverWidget.FieldType.MULTISELECT,
                label:     'Property Portfolio',
                source:    _CONST.PORTFOLIO_LIST,
                container: 'custpage_grp_criteria'
            });
            portfolioField.setHelpText({
                help: 'Reports every tenant across every property in the selected ' +
                      'portfolio(s). Can be used on its own, or together with Property, ' +
                      'Accommodation Type or Tenant to narrow the run further.'
            });

            var propertyField = form.addField({
                id:        'custparam_property',
                type:      serverWidget.FieldType.SELECT,
                label:     'Property',
                source:    _CONST.BUILDING_RECORD,
                container: 'custpage_grp_criteria'
            });
            propertyField.setHelpText({
                help: 'Choose a single property to report every tenant in it. One of ' +
                      'Property, Property Portfolio or Tenant is required - an unfiltered ' +
                      'run across the whole portfolio is not permitted. Can be combined ' +
                      'with Portfolio, Accommodation Type or Tenant to narrow further.'
            });

            var accommTypeField = form.addField({
                id:        'custparam_accommtype',
                type:      serverWidget.FieldType.MULTISELECT,
                label:     'Accommodation Type',
                source:    _CONST.ACCOMM_TYPE_LIST,
                container: 'custpage_grp_criteria'
            });
            accommTypeField.setHelpText({
                help: 'Optional. Further narrows the tenants reported to those whose unit ' +
                      'is one of the selected accommodation type(s). Combine with Property, ' +
                      'Property Portfolio or Tenant.'
            });

            var customerField = form.addField({
                id:        'custparam_customer',
                type:      serverWidget.FieldType.SELECT,
                label:     'Tenant',
                source:    'customer',
                container: 'custpage_grp_criteria'
            });
            customerField.setHelpText({
                help: 'Choose a single tenant to report that tenant alone. Combine with ' +
                      'Property, Property Portfolio or Accommodation Type to further narrow ' +
                      'which of that tenant’s units and invoices are included.'
            });

            var toPeriodField = form.addField({
                id:        'custparam_toperiod',
                type:      serverWidget.FieldType.DATE,
                label:     'Latest Billing Period',
                container: 'custpage_grp_criteria'
            });
            toPeriodField.setHelpText({
                help: 'The most recent billing month to show. Pick any day within that ' +
                      'month - only the month and year are used, the day is ignored. ' +
                      'Defaults to the month currently being billed.'
            });

            var periodsField = form.addField({
                id:        'custparam_periods',
                type:      serverWidget.FieldType.INTEGER,
                label:     'Number Of Periods',
                container: 'custpage_grp_criteria'
            });
            periodsField.setHelpText({
                help: 'How many billing periods to show, counting back from the latest. ' +
                      'The MRI pre-billing check shows 4. Maximum ' + _CONST.MAX_PERIOD_COUNT + '.'
            });

            form.addFieldGroup({ id: 'custpage_grp_options', label: 'Options' });

            var linesField = form.addField({
                id:        'custparam_lines',
                type:      serverWidget.FieldType.CHECKBOX,
                label:     'Itemise Invoice Lines',
                container: 'custpage_grp_options'
            });
            linesField.defaultValue = 'T';
            linesField.setHelpText({
                help: 'Ticked: invoices are replaced by their item lines, as MRI prints ' +
                      'them. Unticked: each invoice shows as a single line.'
            });

            var analysisField = form.addField({
                id:        'custparam_analysis',
                type:      serverWidget.FieldType.CHECKBOX,
                label:     'Show Movement Analysis',
                container: 'custpage_grp_options'
            });
            analysisField.defaultValue = 'T';
            analysisField.setHelpText({
                help: 'Adds the per-tenant breakdown of charges, receipts, credits, ' +
                      'bad debt written off and bad debt recovered.'
            });

            var zeroField = form.addField({
                id:        'custparam_showzero',
                type:      serverWidget.FieldType.CHECKBOX,
                label:     'Include Tenants With No Activity',
                container: 'custpage_grp_options'
            });
            zeroField.defaultValue = 'F';

            form.addSubmitButton({ label: 'Run Report' });

            return form;
        }

        //-----------------------------------------------
        //Result form shell - report markup itself comes
        //from LIB_FX.buildReportHtml
        //-----------------------------------------------
        function renderScreen(response, data) {

            var form = serverWidget.createForm({ title: 'BB1 ' + _CONST.REPORT_TITLE });

            form.addButton({
                id:           'custpage_btn_criteria',
                label:        'New Selection',
                functionName: navigateTo(LIB_FX.suiteletUrl({}))
            });

            form.addButton({
                id:           'custpage_btn_pdf',
                label:        'Download PDF',
                functionName: "window.open('" + LIB_FX.suiteletUrl(LIB_FX.overrideMode(data.filters, 'pdf')) + "')"
            });

            form.addButton({
                id:           'custpage_btn_csv',
                label:        'Download CSV',
                functionName: "window.open('" + LIB_FX.suiteletUrl(LIB_FX.overrideMode(data.filters, 'csv')) + "')"
            });

            // Paging runs in the same tab, so it uses the same navigation as New
            // Selection - a call rather than an assignment
            if (data.page > 1) {
                form.addButton({
                    id:           'custpage_btn_prev',
                    label:        'Previous',
                    functionName: navigateTo(pageUrl(data.filters, data.page - 1))
                });
            }

            if (data.page < data.pageCount) {
                form.addButton({
                    id:           'custpage_btn_next',
                    label:        'Next',
                    functionName: navigateTo(pageUrl(data.filters, data.page + 1))
                });
            }

            var htmlField = form.addField({
                id:    'custpage_report',
                type:  serverWidget.FieldType.INLINEHTML,
                label: 'Report'
            });

            htmlField.defaultValue = LIB_FX.buildReportHtml(data);

            response.writePage({ pageObject: form });
        }

        // Same-tab navigation. An assignment such as window.location.href='...'
        // evaluates its right-hand side first, so anything NetSuite appends to the
        // handler fails before navigation ever happens and the button does nothing
        // at all. A call navigates before that can bite. setWindowChanged suppresses
        // the unsaved-changes prompt the form would otherwise raise on the way out.
        function navigateTo(target) {
            return "if(typeof setWindowChanged==='function'){setWindowChanged(window,false);}" +
                   "window.location.assign('" + target + "')";
        }

        // The current criteria with a different page number
        function pageUrl(filters, page) {

            var parameters = LIB_FX.overrideMode(filters, 'screen');

            parameters.custparam_page = page;

            return LIB_FX.suiteletUrl(parameters);
        }

        return {
            onRequest: onRequest
        };

    });
