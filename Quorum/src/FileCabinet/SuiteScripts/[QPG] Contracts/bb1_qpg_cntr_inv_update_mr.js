/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * Project: Quorum Contracts - P102843 Quorum NetSuite Implementation
 * On-demand: adds newly added utilised charges to whichever invoice already covers their period.
 * Triggered via N/task from bb1_qpg_cntr_inv_ue.js right after a contract edit adds new charge lines,
 * so the heavy invoice load/update/save work happens off the contract save's critical path.
 *
 * Date        	  Author		        Purpose
 * 08/13/2026     Jared Espineli        Initial Version
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/runtime', './bb1_qpg_cntr_helper_lib'],
    (runtime, helperLib) => {
        const THIS_SCRIPT = runtime.getCurrentScript();

        /**
         * single contract id, passed in by the UE script via task.create params
         */
        const getInputData = (inputContext) => {
            try{
                let idContract = THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.UPDATE_CONTRACT);
                return [idContract];
            }catch(e){
                log.error('_getInputData error', e.message);
            }
        }

        const map = (mapContext) => {
            try{
                mapContext.write(mapContext.value, mapContext.value);
            }catch(e){
                log.error('_map error', e.message);
            }
        }

        const reduce = (reduceContext) => {
            try{
                let idContract = reduceContext.values[0];
                log.debug('reduce id contract', idContract);
                let idUtChargeSea = THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.UTIL_CHARGES_SEARCH);

                //by now the contract edit has already committed, so a plain search is safe - no indexing lag to
                //work around, and no need to read the sublist directly
                let allCharges = helperLib.LIB_FX.searchData(idUtChargeSea, 'utilChrgAll', '', '', idContract);
                let uninvoicedCharges = helperLib.LIB_FX.checkUtilisedCharges(allCharges, idContract);

                helperLib.LIB_FX.processUninvoicedCharges(uninvoicedCharges, idContract, idUtChargeSea);
            }catch(e){
                log.error('_reduce error', e.message);
            }
        }

        const summarize = (summaryContext) => {
            try{
                let idContract = THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.UPDATE_CONTRACT);

                //clear the "updating" flag now that this run has actually finished, regardless of whether
                //reduce hit an error - otherwise a failed run would leave the banner showing indefinitely
                helperLib.LIB_FX.clearContractUpdating(idContract);

                summaryContext.reduceSummary.errors.iterator().each((key, error) => {
                    log.error('_reduce error for key ' + key, error);
                    return true;
                });
            }catch(e){
                log.error('_summarize error', e.message);
            }
        }

        return {getInputData, map, reduce, summarize}

    });