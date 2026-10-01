/**
 * Project: J&K Ross - P102821
 *
 * Teamwork task: P102821 - Production Order
 *
 * Date                Author              Purpose
 * 23-September-2026   Jared Espineli     Initial Release
 * 01-October-2026      Jared Espineli     Added Item Receipt Picking Ticket logic - afterSubmit
 *                                         creates the pick-data records printed by the
 *                                         bb1_jkr_ir_pick_doc_wfa.js Workflow Action Script (see
 *                                         bb1_jkr_ir_pick_doc_helper_lib.js)
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/runtime', 'N/error', './bb1_jkr_prod_ord_helper_lib',
        '../[JKR] Item Receipt Documents/bb1_jkr_ir_pick_doc_helper_lib'],

    function (record, runtime, error, helperLib, irPickDocLib) {

        /**
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord
         * @param {string} scriptContext.type
         */
        function afterSubmit(scriptContext) {
            log.debug('afterSubmit has been triggered. Context type: ' + scriptContext.type);

            if (scriptContext.type === scriptContext.UserEventType.DELETE) {
                return;
            }

            var newRecord = scriptContext.newRecord;

            //-----------------------------------------------
            //Item Receipt - own try/catch so a failure here is never reported under the Sales
            //Order flow's PROJ_ORDER_CREATION_FAILED error name below. CREATE only - an edit to
            //an existing Item Receipt shouldn't re-run this and create duplicate pick-data
            //records for commitments already handled.
            //-----------------------------------------------
            if (newRecord.type === record.Type.ITEM_RECEIPT) {
                log.debug('afterSubmit - Item Receipt', {itemReceiptId: newRecord.id, type: scriptContext.type});

                if (scriptContext.type !== scriptContext.UserEventType.CREATE) {
                    log.debug('afterSubmit - Item Receipt', 'Not CREATE - skipping');
                    return;
                }

                try {
                    var loadedItemReceipt = record.load({
                        type: newRecord.type,
                        id: newRecord.id,
                        isDynamic: false
                    });
                    log.debug('afterSubmit - Item Receipt loaded', loadedItemReceipt.id);

                    var idCommitSearch = runtime.getCurrentScript().getParameter({
                        name: irPickDocLib._CONFIG.SCRIPTS.PARAM.COMMIT_SEARCH
                    });
                    log.debug('afterSubmit - Item Receipt', 'idCommitSearch param = ' + idCommitSearch);

                    irPickDocLib.LIB_FX.processItemReceiptPickTickets(loadedItemReceipt, newRecord.id, idCommitSearch);
                    log.debug('afterSubmit - Item Receipt', 'processItemReceiptPickTickets completed for ' + newRecord.id);
                } catch (e) {
                    log.error('Item Receipt pick ticket processing failed', e.message);
                    throw error.create({
                        name: 'BB1_IR_PICKTICKET_PROCESSING_FAILED',
                        message: 'Could not create Picking Ticket pick-data for Item Receipt ' + newRecord.id + ': ' + e.message
                    });
                }

                return;
            }

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

                log.debug('SO Conditions', {
                    isPendingFulfillment: isPendingFulfillment,
                    hasCreateWoLine: hasCreateWoLine,
                    hasWorkOrderLink: hasWorkOrderLink
                });

                if (isPendingFulfillment && hasCreateWoLine && hasWorkOrderLink) {
                    var idWoSearch = runtime.getCurrentScript().getParameter({
                        name: helperLib._CONFIG.SCRIPTS.PARAM.WO_SEARCH
                    });

                    log.debug('All conditions met - creating Project Order');
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
