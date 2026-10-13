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
 * Also adds the Print Label button (view mode) - passes the label template id
 * (custscript_bb1_jkr_if_label_tmplt) to bb1_jkr_if_mandfields_cs.js, which opens
 * bb1_jkr_if_print_label_sl.js in a new window
 *
 * Date                Author              Purpose
 * 28-September-2026   Jared Espineli      Initial Release
 * 13-October-2026     Jared Espineli      Added Print Label button
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/error', 'N/runtime'],

    function (error, runtime) {

        var STATUS_SHIPPED = 'Shipped';

        var FIELD = {
            STATUS: 'shipstatus',
            SHIP_METHOD: 'shipmethod',
            BOXES: 'custbody_bb1_boxes'
        };

        //deployment script parameter holding bb1_jkr_if_mailing_label_pdf.xml's internal id
        var SCRIPT_PARAM_LABEL_TEMPLATE_ID = 'custscript_bb1_jkr_if_label_tmplt';

        /**
         * @param {Object} scriptContext
         * @param {Form} scriptContext.form
         * @param {string} scriptContext.type
         */
        function beforeLoad(scriptContext) {
            log.debug('beforeLoad triggered', {
                type: scriptContext.type,
                recordId: scriptContext.newRecord.id,
                hasForm: !!scriptContext.form
            });

            if (scriptContext.type !== scriptContext.UserEventType.VIEW) {
                log.debug('beforeLoad skipped', 'Not view mode: ' + scriptContext.type);
                return;
            }

            var form = scriptContext.form;

            try {
                //view mode only - in edit mode this client script is already attached by its own deployment
                form.clientScriptModulePath = './bb1_jkr_if_mandfields_cs.js';
                log.debug('beforeLoad client script set', form.clientScriptModulePath);

                var templateId = runtime.getCurrentScript().getParameter({name: SCRIPT_PARAM_LABEL_TEMPLATE_ID});
                log.debug('beforeLoad label template', templateId);

                var button = form.addButton({
                    id: 'custpage_bb1_jkr_if_printlabel_btn',
                    label: 'Print Label',
                    //single quotes - functionName is written into the button's onclick attribute
                    functionName: "printLabel('" + String(templateId || '').replace(/\D/g, '') + "')"
                });
                log.debug('beforeLoad button added', {id: button && button.id, label: button && button.label});
            } catch (e) {
                log.error('beforeLoad failed', {name: e.name, message: e.message});
            }
        }

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
            beforeLoad: beforeLoad,
            beforeSubmit: beforeSubmit
        };

    });
