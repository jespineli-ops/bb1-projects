/**
 * Project: J&K Ross - P102821
 *
 * Teamwork task: P102821 - Production Order
 *
 * Client-side handler for the Project Order's Manufacture Document button -
 * opens bb1_jkr_prod_order_print_sl.js for the current Project Order
 *
 * Date                Author              Purpose
 * 29-September-2026   Jared Espineli     Initial Release
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/url', 'N/currentRecord'],

    function (url, currentRecord) {

        //TODO: confirm against the actual Suitelet script/deployment records once created in NetSuite
        var MANUFDOC_SCRIPT_ID = 'customscript_bb1_jkr_prod_order_print_sl';
        var MANUFDOC_DEPLOY_ID = 'customdeploy_bb1_jkr_prod_order_print_sl';

        //request parameter the Suitelet reads the Project Order id from - must match bb1_jkr_prod_order_print_sl.js
        var REQUEST_PARAM_PROJ_ORDER_ID = 'custscript_bb1_jkr_prod_order_print_id_su';

        function pageInit(scriptContext) {
        }

        //Triggered by the Manufacture Document button (see bb1_jkr_prod_order_print_ue.js beforeLoad)
        function openManufactureDocument() {
            var projOrderId = currentRecord.get().id;

            var params = {};
            params[REQUEST_PARAM_PROJ_ORDER_ID] = projOrderId;

            var suiteletUrl = url.resolveScript({
                scriptId: MANUFDOC_SCRIPT_ID,
                deploymentId: MANUFDOC_DEPLOY_ID,
                params: params
            });

            window.open(suiteletUrl, '_self');
        }

        return {
            pageInit: pageInit,
            openManufactureDocument: openManufactureDocument
        };

    });
