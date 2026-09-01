/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library that builds the Customer List Search Suitelet form.
 * Kept separate from bb1_qpg_cstmt_cls_lib_helper.js since it uses the
 * server-only N/ui/serverWidget module, which the client script can't load.
 *
 * Date             Author              Purpose
 * 01-September-2026    Jared Espineli      Initial Release
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

        const BUTTON_STYLE = `
            <style>
                #${_FIELDS.FORM.SHOW_LIST} {
                    background-color: #2C5266;
                    border-color: #2C5266;
                    color: #FFFFFF;
                }
            </style>
        `;

        const LIB_FX = {};

        // Builds the Customer List Search Suitelet form
        LIB_FX.buildForm = () => {
            const form = serverWidget.createForm({title: 'Customer List Search'});

            // Cascading filters (Building -> Block -> Floor -> Unit) are handled in the client script
            form.clientScriptModulePath = './bb1_qpg_cstmt_cls_cs.js';

            form.addField({
                id: _FIELDS.FORM.BUTTON_STYLE,
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Button Style'
            }).defaultValue = BUTTON_STYLE;

            form.addButton({
                id: _FIELDS.FORM.SHOW_LIST,
                label: 'Show Customer List',
                functionName: 'showCustomerList'
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

            // Right column
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

            return form;
        }

        return {LIB_FX};
    });
