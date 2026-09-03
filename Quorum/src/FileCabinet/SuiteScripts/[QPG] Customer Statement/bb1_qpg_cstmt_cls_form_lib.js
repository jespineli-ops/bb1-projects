/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library that builds the Customer Statement Suitelet form -
 * Customer/Category fields plus a Search Customer button (no action wired
 * up yet), styled the same as the Tenancy Schedule report's form
 * (bb1_qpg_tschd_report_form_lib.js). Kept separate from
 * bb1_qpg_cstmt_cls_lib_helper.js since it uses the server-only
 * N/ui/serverWidget module, which the client script can't load.
 *
 * Date                 Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release - Customer/Category fields, Search Customer button
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/ui/serverWidget', './bb1_qpg_cstmt_cls_lib_helper'],
    /**
     * @param{serverWidget} serverWidget
     * @param{helperLib} helperLib
     */
    (serverWidget, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        // Same button styling as the Tenancy Schedule report's Print
        // PDF/Export CSV buttons (bb1_qpg_tschd_report_form_lib.js)
        const BUTTON_STYLE = `
            <style>
                #${_FIELDS.FORM.SEARCH_CUSTOMER} {
                    background-color: #2C5266;
                    border-color: #2C5266;
                    color: #FFFFFF;
                }
            </style>
        `;

        const LIB_FX = {};

        // Builds the Customer Statement Suitelet form
        LIB_FX.buildForm = () => {
            const form = serverWidget.createForm({title: 'Customer Statement'});

            form.clientScriptModulePath = './bb1_qpg_cstmt_cls_cs.js';

            form.addField({
                id: _FIELDS.FORM.BUTTON_STYLE,
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Button Style'
            }).defaultValue = BUTTON_STYLE;

            form.addButton({
                id: _FIELDS.FORM.SEARCH_CUSTOMER,
                label: 'Search Customer',
                functionName: 'searchCustomer'
            });

            // Active customers only - NetSuite's native record-type source
            // on a SELECT field already excludes inactive records.
            form.addField({
                id: _FIELDS.FORM.CUSTOMER,
                type: serverWidget.FieldType.SELECT,
                label: 'Customer',
                source: 'customer'
            });

            form.addField({
                id: _FIELDS.FORM.CATEGORY,
                type: serverWidget.FieldType.SELECT,
                label: 'Category',
                source: 'customercategory'
            });

            return form;
        }

        return {LIB_FX};
    });
