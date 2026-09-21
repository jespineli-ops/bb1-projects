/**
 * Project: J&K Ross - Automatic Printing of Documents
 *          Gap 9 - Automated Printing (Sales Order Pick Ticket)
 *
 * Teamwork task: N/A
 *
 * Sets a per-line committed-quantity flag and a header-level aggregate flag
 * on the Sales Order
 *
 * Date              Author              Purpose
 * 18-September-2026  Jared Espineli      Initial Release
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
        var BODY_FIELD_HAS_COMMITTED_LINE = 'custbody_bb1_jkr_has_cmt_qty';
        var COLUMN_FIELD_HAS_COMMITTED_LINE = 'custcol_bb1_jkr_has_cmt_qty';

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
            var lineCount = newRecord.getLineCount({ sublistId: 'item' });
            var hasCommittedLine = false;

            //Mark each line with its own committed-quantity flag, and track
            //whether any line qualifies for the header-level flag
            for (var i = 0; i < lineCount; i++) {
                try {
                    var qtyCommitted = newRecord.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantitycommitted',
                        line: i
                    });

                    var lineHasCommittedQty = (parseFloat(qtyCommitted) || 0) > 0;

                    newRecord.setSublistValue({
                        sublistId: 'item',
                        fieldId: COLUMN_FIELD_HAS_COMMITTED_LINE,
                        line: i,
                        value: lineHasCommittedQty
                    });

                    if (lineHasCommittedQty) {
                        hasCommittedLine = true;
                    }
                } catch (e) {
                    log.error('Failed to evaluate committed quantity on line ' + i, e.message);
                }
            }

            //Header-level flag - this is what the workflow condition checks
            try {
                newRecord.setValue({
                    fieldId: BODY_FIELD_HAS_COMMITTED_LINE,
                    value: hasCommittedLine
                });
            } catch (e) {
                log.error('Failed to set header committed-line flag', e.message);
                throw error.create({
                    name: 'BB1_CMTQTY_HEADER_SET_FAILED',
                    message: 'Could not set ' + BODY_FIELD_HAS_COMMITTED_LINE + ': ' + e.message
                });
            }

            log.debug('Has Committed Line', hasCommittedLine);
        }

        return {
            beforeSubmit: beforeSubmit
        };

    });
