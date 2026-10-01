/**
 * Project: J&K Ross - P102821
 *
 * Teamwork task: P102821 - Production Order
 *
 * Workflow Action Script - queues one Picking Ticket print job per unprinted
 * customrecord_bb1_jkr_ir_pick_data record for the triggering Item Receipt through the QZ print
 * library/plugin, then redirects back to that Item Receipt. Triggered by a SuiteFlow workflow on
 * Item Receipt (CREATE, after record submit) - calls bb1qz directly, no Suitelet/Client Script
 * hop, same approach as [JKR] Print Document's bb1_jkr_prnt_doc_wfa.js (Sales Order auto-print).
 *
 * bb1_jkr_prod_ord_ue.js's afterSubmit still creates the pick-data record(s) this reads - that
 * runs first since workflow after-record-submit actions fire after all User Event afterSubmit
 * scripts complete.
 *
 * Called By: SuiteFlow workflow on Item Receipt (after record submit, CREATE)
 * Calls: bb1_qz_lib_public (SuiteApp com.bluebridgeonecouk.qztray)
 *
 * Date              Author              Purpose
 * 01-October-2026   Jared Espineli     Initial Release
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/url', 'N/runtime',
        '/SuiteApps/com.bluebridgeonecouk.qztray/bb1_qz_lib_public',
        './bb1_jkr_ir_pick_doc_helper_lib'],

    function (record, search, url, runtime, bb1qz, helperLib) {

        var PICK_DATA = helperLib._CONFIG.PICK_DATA;
        var QZ_PRINT_PLUGIN_SCRIPT_ID = 'customscript_bb1_qz_pi_record';

        /**
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - the triggering Item Receipt
         */
        function onAction(scriptContext) {
            var newRecord = scriptContext.newRecord;
            var itemReceiptId = newRecord.id;

            log.debug('bb1_jkr_ir_pick_doc_wfa onAction', 'Item Receipt ' + itemReceiptId);

            try {
                var pickDataIds = getPendingPickDataIds(itemReceiptId);
                log.debug('onAction - pending pick data', pickDataIds);

                if (!pickDataIds.length) {
                    log.debug('onAction', 'No unprinted pick data for Item Receipt ' + itemReceiptId + ' - nothing to print');
                    return;
                }

                var templateId = runtime.getCurrentScript().getParameter({
                    name: helperLib._CONFIG.SCRIPTS.PARAM.PICK_TEMPLATE
                });
                log.debug('onAction - templateId', templateId);

                pickDataIds.forEach(function (pickDataId) {
                    queuePickingTicketPrint(pickDataId, templateId);
                    markPrinted(pickDataId);
                });

                var redirectUrl = url.resolveRecord({
                    recordType: record.Type.ITEM_RECEIPT,
                    recordId: itemReceiptId,
                    isEditMode: false
                });
                log.debug('onAction - redirectUrl', redirectUrl);

                bb1qz.InitiateProcessJobQueue(redirectUrl || null, null, null, false, false, null);
            } catch (e) {
                //logged, not re-thrown - a print-queue failure here shouldn't surface as an error
                //banner on an otherwise successfully created Item Receipt
                log.error('Item Receipt Picking Ticket print failed', e.message);
            }
        }

        //unprinted pick-data child records for this Item Receipt
        function getPendingPickDataIds(itemReceiptId) {
            var ids = [];

            var pickDataSearchObj = search.create({
                type: PICK_DATA.REC_ID,
                filters: [
                    [PICK_DATA.ITEM_RECEIPT, 'anyof', itemReceiptId],
                    'AND',
                    [PICK_DATA.PRINTED, 'is', 'F']
                ],
                columns: ['internalid']
            });

            pickDataSearchObj.run().each(function (result) {
                ids.push(result.id);
                return true;
            });

            return ids;
        }

        //queues the Picking Ticket print job against the pick-data record itself -
        //bb1_jkr_pick_doc_ir.xml reads its JSON field straight off this record (?eval), same
        //technique the Manufacture Document template uses for custrecord_bb1_prjord_l_pdf_data
        function queuePickingTicketPrint(pickDataId, templateId) {
            var jobData = {
                type: 'RECORD',
                templateid: Number(templateId),
                records: [
                    {type: PICK_DATA.REC_ID, id: Number(pickDataId)}
                ],
                format: 'PDF'
            };
            log.debug('queuePickingTicketPrint - jobData', jobData);

            bb1qz.AddJobToQueue(
                5,
                QZ_PRINT_PLUGIN_SCRIPT_ID,
                'Item Receipt Picking Ticket Printing',
                jobData,
                null
            );
        }

        //flips Printed so this pick-data record isn't queued again on a future run
        function markPrinted(pickDataId) {
            try {
                record.submitFields({
                    type: PICK_DATA.REC_ID,
                    id: pickDataId,
                    values: {
                        [PICK_DATA.PRINTED]: true
                    }
                });
                log.debug('markPrinted - success', pickDataId);
            } catch (e) {
                log.error('markPrinted failed for pick data record ' + pickDataId, e.message);
            }
        }

        return {
            onAction: onAction
        };

    });
