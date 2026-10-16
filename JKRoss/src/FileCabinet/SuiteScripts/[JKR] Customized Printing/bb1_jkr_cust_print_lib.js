/**
 * Project: J&K Ross - P102821
 *
 * Teamwork task: N/A
 *
 * Customized Printing library - reads the Document Print Setup and queues QZ print jobs
 *
 * Date              Author              Purpose
 * 15-October-2026   Jared Espineli     Initial Release
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/url', 'N/error',
        '/SuiteApps/com.bluebridgeonecouk.qztray/bb1_qz_lib_public'],
    (search, url, error, bb1qz) => {
        const _CONFIG = {
            TRAN_PRINT_SETUP: 'custbody_bb1_jkr_doc_print_setup',
            PRINT_SETUP: {
                REC_ID: 'customrecord_bb1_jkr_doc_print_setup',
                DEVICE: 'custrecord_bb1_jkr_qz_device',
                TEMPLATE_ID: 'custrecord_bb1_jkr_template_id',
                JSON_DATA: 'custrecord_bb1_jkr_doc_json_data',
                DOC_TYPE: 'custrecord_bb1_jkr_doc_type'
            },
            QZ_PLUGIN: 'customscript_bb1_qz_pi_record',
            JOB_DEFAULTS: {
                TYPE: 'RECORD',
                FORMAT: 'PDF'
            }
        };

        const LIB_FX = {};

        //select fields come back from lookupFields as [{value, text}], plain fields as a raw value
        const getLookupValue = (fieldValue) => {
            if (Array.isArray(fieldValue)) {
                return fieldValue.length ? fieldValue[0].value : null;
            }
            return fieldValue || null;
        };

        LIB_FX.getPrintSetup = (printSetupId) => {
            const SETUP = _CONFIG.PRINT_SETUP;

            let setupFields = search.lookupFields({
                type: SETUP.REC_ID,
                id: printSetupId,
                columns: [SETUP.DEVICE, SETUP.TEMPLATE_ID, SETUP.JSON_DATA, SETUP.DOC_TYPE]
            });

            let docType = setupFields[SETUP.DOC_TYPE];

            return {
                id: printSetupId,
                deviceId: getLookupValue(setupFields[SETUP.DEVICE]),
                templateId: getLookupValue(setupFields[SETUP.TEMPLATE_ID]),
                jsonData: setupFields[SETUP.JSON_DATA],
                docTypeText: docType && docType.length ? docType[0].text : ''
            };
        };

        //JSON Data is the base job definition; template and the record being printed are applied on top
        LIB_FX.buildJobData = (printSetup, recordType, recordId) => {
            const DEFAULTS = _CONFIG.JOB_DEFAULTS;
            let jobData = {};

            if (printSetup.jsonData) {
                try {
                    jobData = JSON.parse(printSetup.jsonData);
                } catch (e) {
                    throw error.create({
                        name: 'BB1_AUTOPRINT_INVALID_JSON',
                        message: 'Document Print Setup ' + printSetup.id + ' JSON Data is not valid JSON: ' + e.message
                    });
                }
            }

            jobData.type = jobData.type || DEFAULTS.TYPE;
            jobData.format = jobData.format || DEFAULTS.FORMAT;

            if (printSetup.templateId) {
                jobData.templateid = Number(printSetup.templateId);
            }

            if (jobData.type === DEFAULTS.TYPE) {
                jobData.records = [{type: recordType, id: Number(recordId)}];
            } else {
                jobData.id = Number(recordId);
            }

            return jobData;
        };

        LIB_FX.queuePrintJob = (printSetup, recordType, recordId) => {
            if (!printSetup.deviceId) {
                throw error.create({
                    name: 'BB1_AUTOPRINT_NO_DEVICE',
                    message: 'Document Print Setup ' + printSetup.id + ' has no Printer'
                });
            }

            let jobName = recordType + ' - ' + printSetup.docTypeText;
            let jobData = LIB_FX.buildJobData(printSetup, recordType, recordId);
            log.debug('queuePrintJob', {deviceId: printSetup.deviceId, jobName: jobName, jobData: jobData});

            bb1qz.AddJobToQueue(Number(printSetup.deviceId), _CONFIG.QZ_PLUGIN, jobName, jobData, null);
        };

        //processes the queue, then returns the user to the record
        LIB_FX.processQueue = (recordType, recordId) => {
            let redirectUrl = url.resolveRecord({recordType: recordType, recordId: recordId, isEditMode: false});
            bb1qz.InitiateProcessJobQueue(redirectUrl || null, null, null, false, false, null);
        };

        return {LIB_FX, _CONFIG};
    });
