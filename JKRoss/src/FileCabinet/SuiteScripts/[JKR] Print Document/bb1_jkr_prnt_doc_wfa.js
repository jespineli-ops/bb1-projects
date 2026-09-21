/**
 * @NApiVersion 2.1
 * @NScriptType WorkflowActionScript
 *
 * Project: JK Ross - Automatic Printing of Documents
 *
 * Date        	  Author		        Purpose
 * 09/18/2026     Jared Espineli        Initial Version
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/url', '/SuiteApps/com.bluebridgeonecouk.qztray/bb1_qz_lib_public'],
    /**
 * @param{url} url
 * @param{bb1qz} bb1qz
 */
    (url, bb1qz) => {
        /**
         * Defines the WorkflowAction script trigger point.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {Record} scriptContext.oldRecord - Old record
         * @param {string} scriptContext.workflowId - Internal ID of workflow which triggered this action
         * @param {string} scriptContext.type - Event type
         * @param {Form} scriptContext.form - Current form that the script uses to interact with the record
         * @since 2016.1
         */
        const onAction = (scriptContext) => {
            var newRecord = scriptContext.newRecord;

            var recordType = newRecord.type;
            var recordId = newRecord.id;

            log.debug('Record Type', recordType);
            log.debug('Record Id', recordId);

            var redirectUrl = url.resolveRecord({
                recordType: recordType,
                recordId: recordId,
                isEditMode: false
            });

            log.debug('Redirect Url', redirectUrl);

            var formNumber = newRecord.getValue({fieldId: 'customform'});

            log.debug('Form Number', formNumber);

            let jobData = {
                "type": "TRANSACTION",
                "id": recordId,
                "format": "PDF",
                "formnumber": formNumber
            }

            bb1qz.AddJobToQueue(
                5,
                'customscript_bb1_qz_record_plugin',
                'Document Printing',
                jobData,
                null
            );

            bb1qz.InitiateProcessJobQueue(
                redirectUrl || null,
                null,
                null,
                false,
                false,
                null
            );
        }

        return {onAction};
    });
