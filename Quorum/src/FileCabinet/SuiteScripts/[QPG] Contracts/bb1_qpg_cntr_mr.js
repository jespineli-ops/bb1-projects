/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * Project: Quorum Contracts - P102843 Quorum NetSuite Implementation
 * Adds utilized charges in contract lease record for the current month
 *
 * Date        	  Author		        Purpose
 * 08/05/2026     Jared Espineli        Initial Version
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 *
 */
define(['N/record', 'N/runtime', 'N/search', './bb1_qpg_cntr_helper_lib'],
    (record, runtime, search, helperLib) => {
        const THIS_SCRIPT = runtime.getCurrentScript();

        /**
         *  Retrieves all active contracts where utilized charges are to be added
         *
         */
        const getInputData = (inputContext) => {
            try{
                let idContractSea = THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.CONTRACT_SEARCH);
                let activeContracts;
                activeContracts = helperLib.LIB_FX.searchData(idContractSea);

                    return activeContracts;
            }catch(e){
                log.error('_getInput error', e.message);
            }
        }

        const map = (mapContext) => {
            try{
                log.debug('_map stage');
                let mapValue = JSON.parse(mapContext.value);

                log.debug('mapValue', mapValue);

                mapContext.write(
                    mapValue.id,
                    JSON.stringify(mapValue)
                )
            }catch(e){
                log.error('_map error', e.message);
            }
        }

        const reduce = (reduceContext) => {
            try{
                let idFxChargeSea = THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.FIXED_CHARGES_SEARCH);
                let idUtChargeSea = THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.UTIL_CHARGES_SEARCH);
                let isManualRun = THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.IS_MANUAL);

                //manual runs bill for the configured period; scheduled runs always bill the current date
                let periodDate = isManualRun
                    ? THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.UTIL_PERIOD)
                    : new Date();

                //loop through all active contracts and retrieve all linked utilized charges
                reduceContext.values.forEach((strValue) => {
                    let value = JSON.parse(strValue);
                    let idContract = value.id;
                    let idBuilding = helperLib.LIB_FX.getListValue(value.values.cseg_bb1_building);

                    log.debug('reduce values', value);

                    //call search function to get all fixed charges for the current month
                    let fixedCharges = helperLib.LIB_FX.searchData(idFxChargeSea, 'fixedChrg', periodDate, idBuilding);

                    helperLib.LIB_FX.addChargeLines(idContract, fixedCharges, value.values, isManualRun, periodDate, idUtChargeSea);
                })
            }catch(e){
                log.error('_reduce error', e.message);
            }
        }


        const summarize = (summaryContext) => {

        }

        return {getInputData, map, reduce, summarize}

    });
