/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 *
 * Project: Quorum Contracts - P102843 Quorum NetSuite Implementation
 * Processes on demand update on existing invoice for new charges added to existing contract
 *
 * Date        	  Author		        Purpose
 * 08/10/2026     Jared Espineli        Initial Version
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/record', 'N/runtime', 'N/search', 'N/task', 'N/ui/message', './bb1_qpg_cntr_helper_lib'],
    (record, runtime, search, task, message, helperLib) => {
        const THIS_SCRIPT = runtime.getCurrentScript();

        //shows a "still processing" banner if beforeSubmit flagged this contract as updating - read only,
        //the flag itself gets cleared by the update MR's summarize stage once it actually finishes running
        const beforeLoad = (scriptContext) => {
            try{
                if(scriptContext.type !== scriptContext.UserEventType.VIEW){
                    return;
                }

                let isUpdating = helperLib.LIB_FX.isContractUpdating(scriptContext.newRecord);

                if(!isUpdating){
                    return;
                }

                scriptContext.form.addPageInitMessage({
                    type: message.Type.INFORMATION,
                    title: 'Invoice update in progress',
                    message: 'New utilised charges were added to this contract. Updating the linked invoice is running in the background and may take a few minutes.'
                });

            }catch (e) {
                log.error('_beforeLoad error:', e.message)
            }
        }

        const beforeSubmit = (scriptContext) => {
            try{
                if(scriptContext.type !== scriptContext.UserEventType.EDIT){
                    return;
                }

                let idContract = scriptContext.newRecord.id;
                let hasNewCharges = helperLib.LIB_FX.hasNewUtilisedCharges(scriptContext.oldRecord, scriptContext.newRecord);

                if(!hasNewCharges){
                    return;
                }

                //hand off to the update MR instead of processing here - keeps this save fast regardless of
                //how many historical charge lines the contract already carries
                let mrTask = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: 'customscript_bb1_qpg_cntr_inv_update_mr',
                    params: {
                        [helperLib._CONFIG.SCRIPTS.PARAMETERS.UPDATE_CONTRACT]: idContract
                    }
                });
                mrTask.submit();

                helperLib.LIB_FX.flagContractUpdating(scriptContext.newRecord);

                log.debug('_beforeSubmit', 'Queued update MR for contract ' + idContract);

            }catch (e) {
                log.error('_beforeSubmit error:', e.message)
            }
        }

        const afterSubmit = (scriptContext) => {
        }

        return {beforeLoad, beforeSubmit, afterSubmit}

    });
