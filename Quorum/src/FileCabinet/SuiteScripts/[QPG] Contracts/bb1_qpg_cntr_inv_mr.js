/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 *
 * Project: Quorum Contracts - P102843 Quorum NetSuite Implementation
 * Processes the monthtly invoicing for lease contracts
 *
 * Date        	  Author		        Purpose
 * 08/06/2026     Jared Espineli        Initial Version
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 *
 */
define(['N/record', 'N/runtime', 'N/search', './bb1_qpg_cntr_helper_lib'],
    (record, runtime, search, helperLib) => {

        const THIS_SCRIPT = runtime.getCurrentScript();

        /**
         *  Retrieves all active contracts where utilized charges are to be invoiced
         *
         */
        const getInputData = (inputContext) => {
            try{
                let idContractSea = THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.CONTRACT_SEARCH);
                let periodDate = THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.INV_PERIOD);

                //an explicit INV_PERIOD means this is a manual run for that period; left blank, this is the
                //automatic monthly run and always means "the current month". Resolved once here, at the
                //very start of the job (getInputData only ever runs once), and carried through map/reduce
                //below so every reduce key uses the exact same month regardless of how long the job takes.
                let effectivePeriodDate = periodDate || new Date();

                let activeContracts = helperLib.LIB_FX.searchData(idContractSea);

                return activeContracts.map((row) => ({periodDate: effectivePeriodDate, row: row}));
            }catch(e){
                log.error('_getInput error', e.message);
            }
        }

        const map = (mapContext) => {
            try{
                log.debug('_map stage');
                let mapData = JSON.parse(mapContext.value);
                let mapValue = mapData.row;

                log.debug('mapValue', mapValue);

                //group the contract based in linked SO
                let linkedSalesOrder = mapValue.values.custrecord_bb1_lease_linked_sales_order;
                let idSalesOrder = (linkedSalesOrder && linkedSalesOrder.length > 0) ? linkedSalesOrder[0].value : '';

                if(!idSalesOrder){
                    log.debug('_map skipped', 'Contract ' + mapValue.id + ' has no linked sales order');
                    return;
                }

                mapContext.write(
                    idSalesOrder,
                    JSON.stringify({periodDate: mapData.periodDate, row: mapValue})
                )
            }catch(e){
                log.error('_map error', e.message);
            }
        }

        const reduce = (reduceContext) => {
            try{
                let idUtChargeSea = THIS_SCRIPT.getParameter(helperLib._CONFIG.SCRIPTS.PARAMETERS.UTIL_CHARGES_SEARCH);
                let idSalesOrder = reduceContext.key; //map() grouped every contract in this reduce by its linked SO

                let entries = reduceContext.values.map((strValue) => JSON.parse(strValue));
                let periodDate = new Date(entries[0].periodDate); //resolved once in getInputData - identical for every entry in this job
                let contracts = entries.map((entry) => entry.row);

                //get utilised for the current period being processed (monthly or date specific if manually triggered)
                let getPeriodChargeList = (idContract) => helperLib.LIB_FX.searchData(idUtChargeSea, 'utilChrgPeriod', periodDate, '', idContract);

                //rent and parking contracts linked to the same SO land on a single invoice: whichever
                //contract is processed first creates (or finds) that invoice from the SO, every contract
                //after that just adds its own utilised charges as lines onto the invoice already resolved
                //for the group
                let idInvoice;

                contracts.forEach((value) => {
                    let periodCharges = getPeriodChargeList(value.id);
                    log.debug('periodCharges', periodCharges);

                    let uninvoicedCharges = helperLib.LIB_FX.checkUtilisedCharges(periodCharges, value.id);
                    if(!uninvoicedCharges.length){
                        return;
                    }

                    if(!idInvoice){
                        idInvoice = helperLib.LIB_FX.createOrUpdateInvoice(idSalesOrder, periodCharges, value.id);
                    } else {
                        helperLib.LIB_FX.addChargesToInvoice(idInvoice, uninvoicedCharges);
                    }
                });
            }catch(e){
                log.error('_reduce error', e.message);
            }
        }


        const summarize = (summaryContext) => {

        }

        return {getInputData, map, reduce, summarize}

    });