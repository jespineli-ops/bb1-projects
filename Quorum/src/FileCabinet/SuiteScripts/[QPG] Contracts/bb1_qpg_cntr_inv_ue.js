/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * Project: Quorum Contracts - P102843 Quorum NetSuite Implementation
 * Processes on demand update on existing invoice for new charges added to existing contract
 *
 * Date        	  Author		        Purpose
 * 08/10/2026     Jared Espineli        Initial Version
 * 10/06/2026     Jared Espineli        Update invoice inline in afterSubmit instead of via the update MR - the MR's
 *                                      flag write-back on the contract caused "record has been changed" on user saves
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/runtime', './bb1_qpg_cntr_helper_lib'],
    (runtime, helperLib) => {
        const THIS_SCRIPT = runtime.getCurrentScript();

        //runs after the contract is committed and never writes back to the contract, so a user holding the
        //contract open can't hit "record has been changed" because of this script
        const afterSubmit = (scriptContext) => {
            try{
                if(scriptContext.type !== scriptContext.UserEventType.EDIT){
                    return;
                }

                let idContract = scriptContext.newRecord.id;
                let hasNewCharges = helperLib.LIB_FX.hasNewUtilisedCharges(scriptContext.oldRecord, scriptContext.newRecord);

                if(!hasNewCharges){
                    return;
                }

                let idUtChargeSea = THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.UTIL_CHARGES_SEARCH);
                helperLib.LIB_FX.invoiceNewCharges(idContract, idUtChargeSea);

                log.debug('_afterSubmit', 'Processed new utilised charges for contract ' + idContract);

            }catch (e) {
                log.error('_afterSubmit error:', e.message)
            }
        }

        return {afterSubmit}

    });
