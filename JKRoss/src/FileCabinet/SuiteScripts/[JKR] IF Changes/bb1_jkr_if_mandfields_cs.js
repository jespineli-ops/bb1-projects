/**
 * Project: J&K Ross - IF Changes
 *
 * Teamwork task: P102821
 *
 * Blocks saving an Item Fulfillment with status Shipped unless Shipping
 * Method and Boxes are both populated.
 *
 * Date                Author              Purpose
 * 28-September-2026   Jared Espineli      Initial Release
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define(['N/ui/message', 'N/log'],

    function (message, log) {

        var STATUS_SHIPPED = 'Shipped';

        var FIELD = {
            STATUS: 'shipstatus',
            SHIP_METHOD: 'shipmethod',
            BOXES: 'custbody_bb1_boxes'
        };

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

        return {
            saveRecord: saveRecord
        };

    });
