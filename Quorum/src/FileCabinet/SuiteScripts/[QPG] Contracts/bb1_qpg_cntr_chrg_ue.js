/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Project: Quorum Contracts - P102843 Quorum NetSuite Implementation
 * Deployed on Utilised Charges. Adds a newly created charge to the existing invoice for its period when the
 * charge is created directly (CSV import, charge form) - those never save the parent contract, so
 * bb1_qpg_cntr_inv_ue.js never sees them.
 *
 * Date        	  Author		        Purpose
 * 10/06/2026     Jared Espineli        Initial Version
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/runtime', './bb1_qpg_cntr_helper_lib'],
    (runtime, helperLib) => {
        const THIS_SCRIPT = runtime.getCurrentScript();

        const afterSubmit = (scriptContext) => {
            try{
                if(scriptContext.type !== scriptContext.UserEventType.CREATE){
                    return;
                }

                let chargeRec = scriptContext.newRecord;

                //voided / already invoiced / no contract - nothing to push onto an invoice
                if(!helperLib.LIB_FX.isChargeInvoiceable(chargeRec)){
                    return;
                }

                //processes every uninvoiced charge on the contract, not just this one - on a multi-row CSV the
                //first row for a contract picks up any earlier rows that failed, later rows find nothing left
                let idContract = helperLib.LIB_FX.getChargeContractId(chargeRec);
                let idUtChargeSea = THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.UTIL_CHARGES_SEARCH);
                helperLib.LIB_FX.invoiceNewCharges(idContract, idUtChargeSea);

                log.debug('_afterSubmit', 'Processed charge ' + chargeRec.id + ' for contract ' + idContract + ' (context: ' + runtime.executionContext + ')');

            }catch (e) {
                log.error('_afterSubmit error:', e.message)
            }
        }

        return {afterSubmit}

    });
