/**
 * Project: J&K Ross - P102821
 *
 * Teamwork task: P102821 - Production Order
 *
 * Date              Author              Purpose
 * 23-September-2026  Jared Espineli     Initial Release
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/runtime', 'N/error', './bb1_jkr_prod_ord_helper_lib'],

    function (record, runtime, error, helperLib) {

        /**
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord
         * @param {string} scriptContext.type
         */
        function afterSubmit(scriptContext) {
            log.debug('BB1 WF Trigger Test', 'afterSubmit has been triggered. Context type: ' + scriptContext.type);

            if (scriptContext.type === scriptContext.UserEventType.DELETE) {
                return;
            }

            var newRecord = scriptContext.newRecord;

            try {
                var loadedRecord = record.load({
                    type: newRecord.type,
                    id: newRecord.id,
                    isDynamic: false
                });

                if (helperLib.LIB_FX.hasProjOrder(loadedRecord)) {
                    log.debug('Sales Order already linked to a Project Order - skipping');
                    return;
                }

                var isPendingFulfillment = helperLib.LIB_FX.isPendingFulfillment(loadedRecord);
                var hasCreateWoLine = helperLib.LIB_FX.hasCreateWoLine(loadedRecord);
                var hasWorkOrderLink = helperLib.LIB_FX.hasWorkOrderLink(loadedRecord);

                log.debug('BB1 WF Trigger Test - conditions', {
                    isPendingFulfillment: isPendingFulfillment,
                    hasCreateWoLine: hasCreateWoLine,
                    hasWorkOrderLink: hasWorkOrderLink
                });

                if (isPendingFulfillment && hasCreateWoLine && hasWorkOrderLink) {
                    var idWoSearch = runtime.getCurrentScript().getParameter({
                        name: helperLib._CONFIG.SCRIPTS.PARAM.WO_SEARCH
                    });

                    log.debug('BB1 WF Trigger Test', 'All conditions met - creating Project Order');
                    helperLib.LIB_FX.createProjOrder(loadedRecord, newRecord.id, idWoSearch);
                }
            } catch (e) {
                log.error('Check failed', e.message);
                throw error.create({
                    name: 'PROJ_ORDER_CREATION_FAILED',
                    message: 'Could not evaluate Production Order conditions: ' + e.message
                });
            }
        }

        return {
            afterSubmit: afterSubmit
        };

    });
