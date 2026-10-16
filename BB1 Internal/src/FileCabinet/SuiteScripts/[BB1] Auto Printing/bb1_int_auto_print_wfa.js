/**
 * Project: BlueBridge One - Internal (Auto Printing)
 *
 * Teamwork task: N/A
 *
 * Queues a QZ print job for the transaction using its Document Print Setup
 *
 * Date              Author              Purpose
 * 15-October-2026   Jared Espineli     Initial Release
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 * @NModuleScope SameAccount
 */
define(['./bb1_int_auto_print_lib'],
    (autoPrintLib) => {
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

                LIB_FX.queuePrintJob(printSetup, recordType, recordId);
                LIB_FX.processQueue(recordType, recordId);
            } catch (e) {
                //logged, not thrown - a print failure shouldn't block the saved transaction
                log.error('Auto print failed for ' + recordType + ' ' + recordId, e.message);
            }
        };

        return {onAction};
    });
