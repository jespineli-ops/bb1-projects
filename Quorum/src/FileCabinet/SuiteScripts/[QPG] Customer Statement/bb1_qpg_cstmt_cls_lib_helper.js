/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Shared library (field ids + cascading filter helpers) used by both the
 * Customer List Search Suitelet and its client script. Also builds the
 * redirect URL to the Generate Tenant Statements Suitelet, carrying over
 * the current filter selections.
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
define(['N/search', 'N/url'],
    /**
     * @param{search} search
     * @param{url} url
     */
    (search, url) => {

        // Script/Deployment id of the Generate Tenant Statements Suitelet -
        // update these to match the actual script/deployment records once
        // that Suitelet is created and deployed in NetSuite.
        const TARGET_SCRIPT_ID = 'customscript_bb1_qpg_cstmt_gts_su';
        const TARGET_DEPLOY_ID = 'customdeploy_bb1_qpg_cstmt_gts_su';

        // field/button ids used on the Customer List Search Suitelet form
        const _FIELDS = {
            FORM: {
                BUTTON_STYLE:       'custpage_qpg_cstmt_button_style',
                SHOW_LIST:          'custpage_qpg_cstmt_show_list',
                PROPERTY_PORTFOLIO: 'custpage_qpg_cstmt_property_portfolio',
                BUILDING:           'customrecord_cseg_bb1_building',
                ACCOMM_TYPE:        'custpage_qpg_cstmt_accomm_type',
                BLOCK:              'custpage_qpg_cstmt_block',
                FLOOR:              'custpage_qpg_cstmt_floor',
                UNIT:               'custpage_qpg_cstmt_unit'
            },
            BUILDING: {
                REC_ID: 'customrecord_cseg_bb1_building'
            },
            BLOCK: {
                REC_ID: 'customrecord_cseg_bb1_block',
                FILTERBY_BUILDING: 'cseg_bb1_block_filterby_cseg_bb1_building'
            },
            FLOOR: {
                REC_ID: 'customrecord_cseg_bb1_floor',
                FILTERBY_BLOCK: 'cseg_bb1_floor_filterby_cseg_bb1_block'
            },
            UNIT: {
                REC_ID: 'customrecord_cseg_bb1_unit',
                FILTERBY_FLOOR: 'cseg_bb1_unit_filterby_cseg_bb1_floor'
            }
        }

        // UI fields whose selections are carried over to the Generate Tenant
        // Statements Suitelet when Show Customer List is clicked
        _FIELDS.FILTER_FIELD_IDS = [
            _FIELDS.FORM.PROPERTY_PORTFOLIO,
            _FIELDS.FORM.BUILDING,
            _FIELDS.FORM.ACCOMM_TYPE,
            _FIELDS.FORM.BLOCK,
            _FIELDS.FORM.FLOOR,
            _FIELDS.FORM.UNIT
        ];

        const LIB_FX = {};

        // Clears a multi-select field's value and options
        LIB_FX.clearFieldOptions = (currentRecord, fieldId) => {
            currentRecord.setValue({fieldId: fieldId, value: [], ignoreFieldChange: true});
            currentRecord.getField({fieldId: fieldId}).removeSelectOption({value: null});
        }

        // Populates a multi-select field with the child records of the given parent ids
        LIB_FX.populateChildOptions = (currentRecord, fieldId, recordType, filterFieldId, parentIds) => {
            LIB_FX.clearFieldOptions(currentRecord, fieldId);

            if (!parentIds || !parentIds.length) {
                return;
            }

            const field = currentRecord.getField({fieldId: fieldId});
            search.create({
                type: recordType,
                filters: [[filterFieldId, 'anyof', parentIds]],
                columns: ['name']
            }).run().each((result) => {
                field.insertSelectOption({
                    value: result.id,
                    text: result.getValue({name: 'name'})
                });
                return true;
            });
        }

        // Builds the Generate Tenant Statements Suitelet URL, carrying over
        // the current filter selections (see _FIELDS.FILTER_FIELD_IDS) as
        // query params. Client-side only (currentRecord is the on-page form).
        LIB_FX.buildCustomerListUrl = (currentRecord) => {
            const params = {};

            _FIELDS.FILTER_FIELD_IDS.forEach((fieldId) => {
                const value = currentRecord.getValue({fieldId: fieldId});
                const isEmpty = value === null || value === '' || (Array.isArray(value) && !value.length);

                if (isEmpty) return;

                params[fieldId] = Array.isArray(value) ? value.join(',') : value;
            });

            return url.resolveScript({
                scriptId: TARGET_SCRIPT_ID,
                deploymentId: TARGET_DEPLOY_ID,
                params: params
            });
        }

        return {LIB_FX, _FIELDS};
    });
