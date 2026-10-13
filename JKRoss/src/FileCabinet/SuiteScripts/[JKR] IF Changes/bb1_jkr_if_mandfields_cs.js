/**
 * Project: J&K Ross - IF Changes
 *
 * Teamwork task: P102821
 *
 * Blocks saving an Item Fulfillment with status Shipped unless Shipping
 * Method and Boxes are both populated.
 *
 * Also handles the Print Label button (added by bb1_jkr_if_mandfields_ue.js beforeLoad) -
 * opens bb1_jkr_if_print_label_sl.js in a new window to render the label PDF
 *
 * Date                Author              Purpose
 * 28-September-2026   Jared Espineli      Initial Release
 * 13-October-2026     Jared Espineli      Added Print Label button handler
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/ui/message', 'N/log', 'N/url', 'N/currentRecord'],

    function (message, log, url, currentRecord) {

        var STATUS_SHIPPED = 'Shipped';

        var FIELD = {
            STATUS: 'shipstatus',
            SHIP_METHOD: 'shipmethod',
            BOXES: 'custbody_bb1_boxes'
        };

        //TODO: confirm against the actual Suitelet script/deployment records once created in NetSuite
        var PRINT_LABEL_SCRIPT_ID = 'customscript_bb1_jkr_if_print_label_sl';
        var PRINT_LABEL_DEPLOY_ID = 'customdeploy_bb1_jkr_if_print_label_sl';

        //request parameters the Suitelet reads - must match bb1_jkr_if_print_label_sl.js
        var REQUEST_PARAM_IF_ID = 'custscript_bb1_jkr_if_print_label_id_su';
        var REQUEST_PARAM_TEMPLATE_ID = 'custscript_bb1_jkr_if_print_label_tmpl_su';

        /**
         * @param {Object} scriptContext
         * @param {CurrentRecord} scriptContext.currentRecord
         * @returns {boolean}
         */
        function saveRecord(scriptContext) {
            var currentRecord = scriptContext.currentRecord;

            //-----------------------------------------------
            //Require Shipping Method and Boxes when Shipped
            //-----------------------------------------------
            var status = currentRecord.getText({fieldId: FIELD.STATUS});

            if (status !== STATUS_SHIPPED) {
                return true;
            }

            var shipMethod = currentRecord.getValue({fieldId: FIELD.SHIP_METHOD});
            var boxes = currentRecord.getValue({fieldId: FIELD.BOXES});

            log.debug('Shipped conditions', {shipMethod: shipMethod, boxes: boxes});

            if (!shipMethod || !boxes) {
                message.create({
                    title: 'Missing Required Fields',
                    message: 'Shipping Method and Boxes must not be empty when the Item Fulfillment status is Shipped.',
                    type: message.Type.ERROR
                }).show({duration: 8000});

                return false;
            }

            return true;
        }

        //Triggered by the Print Label button (see bb1_jkr_if_mandfields_ue.js beforeLoad)
        function printLabel(templateId) {
            if (!templateId) {
                message.create({
                    title: 'Print Label',
                    message: 'No label template is set on the script deployment (custscript_bb1_jkr_if_label_tmplt).',
                    type: message.Type.ERROR
                }).show({duration: 8000});
                return;
            }

            var params = {};
            params[REQUEST_PARAM_IF_ID] = currentRecord.get().id;
            params[REQUEST_PARAM_TEMPLATE_ID] = templateId;

            var suiteletUrl = url.resolveScript({
                scriptId: PRINT_LABEL_SCRIPT_ID,
                deploymentId: PRINT_LABEL_DEPLOY_ID,
                params: params
            });

            window.open(suiteletUrl, '_blank');
        }

        return {
            saveRecord: saveRecord,
            printLabel: printLabel
        };

    });
