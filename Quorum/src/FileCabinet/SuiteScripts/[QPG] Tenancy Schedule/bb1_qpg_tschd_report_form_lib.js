/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Server-only library that builds the Tenancy Schedule Suitelet form. Kept
 * separate from bb1_qpg_tschd_report_lib_helper.js since it uses the
 * server-only N/ui/serverWidget module, which the client script can't load.
 *
 * Date        	  Author		        Purpose
 * 08/20/2026     Jared Espineli        Initial version
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/ui/serverWidget', './bb1_qpg_tschd_report_lib_helper'],
    /**
     * @param{serverWidget} serverWidget
     * @param{helperLib} helperLib
     */
    (serverWidget, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        const BUTTON_STYLE = `
            <style>
                #${_FIELDS.FORM.PRINT_PDF}, #${_FIELDS.FORM.EXPORT_CSV} {
                    background-color: #2C5266;
                    border-color: #2C5266;
                    color: #FFFFFF;
                }
            </style>
        `;

        const LIB_FX = {};

        // Builds the Tenancy Schedule Suitelet form
        LIB_FX.buildForm = () => {
            const form = serverWidget.createForm({title: 'Tenancy Schedule Report'});

            // Cascading filters (Building -> Block -> Floor) are handled in the client script
            form.clientScriptModulePath = './bb1_qpg_tschd_report_cs.js';

            form.addField({
                id: _FIELDS.FORM.BUTTON_STYLE,
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Button Style'
            }).defaultValue = BUTTON_STYLE;

            form.addButton({
                id: _FIELDS.FORM.PRINT_PDF,
                label: 'Print PDF',
                functionName: 'printPdf'
            });

            form.addButton({
                id: _FIELDS.FORM.EXPORT_CSV,
                label: 'Export CSV',
                functionName: 'exportCsv'
            });

            // Left column
            form.addField({
                id: _FIELDS.FORM.PROPERTY_PORTFOLIO,
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Property Portfolio',
                source: 'customlist_bb1_building_prop_portfolio'
            });

            form.addField({
                id: _FIELDS.FORM.BUILDING,
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Building/s',
                source: _FIELDS.BUILDING.REC_ID
            });

            form.addField({
                id: _FIELDS.FORM.ACCOMM_TYPE,
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Accommodation Type/s',
                source: 'customlist_bb1_building_accommoda_type'
            });

            const blockField = form.addField({
                id: _FIELDS.FORM.BLOCK,
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Block/s'
            });
            blockField.updateBreakType({breakType: serverWidget.FieldBreakType.STARTCOL});

            form.addField({
                id: _FIELDS.FORM.FLOOR,
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Floor/s'
            });

            form.addField({
                id: _FIELDS.FORM.UNIT,
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Unit/s'
            });

            form.addField({
                id: _FIELDS.FORM.AS_OF_DATE,
                type: serverWidget.FieldType.DATE,
                label: 'As of Date'
            });

            return form;
        }

        return {LIB_FX};
    });