/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Shared library (field ids + redirect-URL helper) used by both the
 * Customer Statement Suitelet and its client script. Search Customer
 * redirects to the Generate Statement Suitelet
 * (customscript_bb1_qpg_cstmt_gts_sl), carrying over the Customer/Category
 * selection as the query params in _FIELDS.SEARCH_PARAM - the Generate
 * Statement Suitelet's own lib_helper reads the same param names (see
 * bb1_qpg_cstmt_gts_lib_helper.js).
 *
 * Date             Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release - Customer/Category fields, Search Customer button
 * 02-September-2026    Jared Espineli      Search Customer now redirects to the Generate Statement Suitelet:
 *                                          Customer (if selected) is sent as the sole filter, Category is
 *                                          disregarded when a Customer is also selected; Category alone is sent
 *                                          when no Customer is selected
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

        // Script/deployment id of the Generate Statement Suitelet that
        // Search Customer redirects to.
        const TARGET_SCRIPT_ID = 'customscript_bb1_qpg_cstmt_gts_sl';
        const TARGET_DEPLOY_ID = 'customdeploy_bb1_qpg_cstmt_gts_sl';

        // field/button ids used on the Customer Statement Suitelet form
        const _FIELDS = {
            FORM: {
                BUTTON_STYLE:    'custpage_qpg_cstmt_button_style',
                SEARCH_CUSTOMER: 'custpage_qpg_cstmt_search_customer',
                CUSTOMER:        'custpage_qpg_cstmt_customer',
                CATEGORY:        'custpage_qpg_cstmt_category'
            }
        }

        // Query param keys sent to the Generate Statement Suitelet - must
        // match bb1_qpg_cstmt_gts_lib_helper.js's _FIELDS.SEARCH_PARAM
        _FIELDS.SEARCH_PARAM = {
            CUSTOMER: 'custpage_qpg_cstmt_filter_customer',
            CATEGORY: 'custpage_qpg_cstmt_filter_category'
        };

        const LIB_FX = {};

        // Builds the Generate Statement Suitelet URL for the current
        // Customer/Category selection. Customer (if selected) is the sole
        // filter sent - Category is disregarded in that case. Otherwise,
        // if Category alone is selected, that's sent instead. If neither is
        // selected, no filter param is sent. Client-side only (currentRecord
        // is the on-page form).
        LIB_FX.buildSearchUrl = (currentRecord) => {
            const customerId = currentRecord.getValue({fieldId: _FIELDS.FORM.CUSTOMER});
            const categoryId = currentRecord.getValue({fieldId: _FIELDS.FORM.CATEGORY});

            const params = {};
            if (customerId) {
                params[_FIELDS.SEARCH_PARAM.CUSTOMER] = customerId;
            } else if (categoryId) {
                params[_FIELDS.SEARCH_PARAM.CATEGORY] = categoryId;
            }

            return url.resolveScript({
                scriptId: TARGET_SCRIPT_ID,
                deploymentId: TARGET_DEPLOY_ID,
                params: params
            });
        }

        return {LIB_FX, _FIELDS};
    });
