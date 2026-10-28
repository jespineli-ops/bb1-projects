/**
 * Project: J&K Ross - P102821
 *
 * Teamwork task: N/A
 *
 * Queues a QZ print job for the transaction using its Document Print Setup
 *
 * Date              Author              Purpose
 * 15-October-2026   Jared Espineli     Initial Release
 * 28-October-2026   Jared Espineli     Print quantity from script parameter custscript_bb1_jkr_print_qty (blank = 1)
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 * @NModuleScope SameAccount
 */
define(['N/runtime', './bb1_jkr_cust_print_lib'],
    (runtime, autoPrintLib) => {
        const {LIB_FX, _CONFIG} = autoPrintLib;

        const onAction = (scriptContext) => {
            let newRecord = scriptContext.newRecord;
            let recordType = newRecord.type;
            let recordId = newRecord.id;

            //record must be saved - run the workflow action after record submit
            if (!recordId) {
                log.error('Auto print skipped', recordType + ' has no internal id yet');
                return;
            }

            let printSetupId = newRecord.getValue({fieldId: _CONFIG.TRAN_PRINT_SETUP});
            if (!printSetupId) {
                log.debug('Auto print skipped', 'No Document Print Setup on ' + recordType + ' ' + recordId);
                return;
            }

            try {
                let printSetup = LIB_FX.getPrintSetup(printSetupId);
                log.debug('printSetup', printSetup);

                //print quantity is set per workflow action - blank defaults to 1 in the library
                let printQty = runtime.getCurrentScript().getParameter({name: _CONFIG.PARAM_PRINT_QTY});
                log.debug('printQty', _CONFIG.PARAM_PRINT_QTY + ': ' + printQty);

                LIB_FX.queuePrintJob(printSetup, recordType, recordId, printQty);
                LIB_FX.processQueue(recordType, recordId);
            } catch (e) {
                //logged, not thrown - a print failure shouldn't block the saved transaction
                log.error('Auto print failed for ' + recordType + ' ' + recordId, e.message);
            }
        };

        return {onAction};
    });
