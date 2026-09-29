/**
 * Project: J&K Ross - IF Changes
 *
 * Teamwork task: P102821
 *
 * Blocks submitting an Item Fulfillment with status Shipped unless Shipping
 * Method and Boxes are both populated. Server-side enforcement so the rule
 * holds regardless of how the record is saved (standard UI save, the Mark
 * Shipped quick action, CSV import, mass update, or script).
 *
 * Date                Author              Purpose
 * 28-September-2026   Jared Espineli      Initial Release
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/error'],

    function (error) {

        var STATUS_SHIPPED = 'Shipped';

        var FIELD = {
            STATUS: 'shipstatus',
            SHIP_METHOD: 'shipmethod',
            BOXES: 'custbody_bb1_boxes'
        };

        /**
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord
         * @param {string} scriptContext.type
         */
        function beforeSubmit(scriptContext) {
            if (scriptContext.type === scriptContext.UserEventType.DELETE) {
                return;
            }

            var newRecord = scriptContext.newRecord;

            log.debug('beforeSubmit triggered', 'Context type: ' + scriptContext.type);

            //-----------------------------------------------
            //Require Shipping Method and Boxes when Shipped
            //-----------------------------------------------
            var status = newRecord.getText({fieldId: FIELD.STATUS});

            if (status !== STATUS_SHIPPED) {
                return;
            }

            var shipMethod = newRecord.getValue({fieldId: FIELD.SHIP_METHOD});
            var boxes = newRecord.getValue({fieldId: FIELD.BOXES});

            log.debug('Shipped conditions', {shipMethod: shipMethod, boxes: boxes});

            if (!shipMethod || !boxes) {
                throw error.create({
                    name: 'BB1_IF_MISSING_REQUIRED_FIELDS',
                    message: 'Shipping Method and Boxes must not be empty when the Item Fulfillment status is Shipped.'
                });
            }
        }

        return {
            beforeSubmit: beforeSubmit
        };

    });
