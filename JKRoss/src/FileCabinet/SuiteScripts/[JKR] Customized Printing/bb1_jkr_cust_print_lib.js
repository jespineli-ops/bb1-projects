/**
 * Project: J&K Ross - P102821
 *
 * Teamwork task: N/A
 *
 * Customized Printing library - reads the Document Print Setup and queues QZ print jobs
 *
 * Date              Author              Purpose
 * 15-October-2026   Jared Espineli     Initial Release
 * 19-October-2026   Jared Espineli     Queue one print job per Copies (custrecord_bb1_jkr_print_copies)
 * 20-October-2026   Jared Espineli     Standard Print Type prints the transaction using Print Form
 * 28-October-2026   Jared Espineli     Print quantity comes from the script parameter, not the setup Copies
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
            PARAM_PRINT_QTY: 'custscript_bb1_jkr_print_qty',
            PRINT_SETUP: {
                REC_ID: 'customrecord_bb1_jkr_doc_print_setup',
                DEVICE: 'custrecord_bb1_jkr_qz_device',
                TEMPLATE_ID: 'custrecord_bb1_jkr_template_id',
                JSON_DATA: 'custrecord_bb1_jkr_doc_json_data',
                DOC_TYPE: 'custrecord_bb1_jkr_doc_type',
                PRINT_TYPE: 'custrecord_bb1_jkr_print_type',
                PRINT_FORM: 'custrecord_bb1_jkr_print_form'
            },
            PRINT_TYPE_STANDARD: 'standard',
            QZ_PLUGIN: 'customscript_bb1_qz_pi_record',
            JOB_DEFAULTS: {
                TYPE: 'RECORD',
                FORMAT: 'PDF',
                STANDARD_TYPE: 'TRANSACTION'
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
                columns: [SETUP.DEVICE, SETUP.TEMPLATE_ID, SETUP.JSON_DATA, SETUP.DOC_TYPE, SETUP.PRINT_TYPE,
                    SETUP.PRINT_FORM]
            });

            let docType = setupFields[SETUP.DOC_TYPE];
            let printType = setupFields[SETUP.PRINT_TYPE];

            return {
                id: printSetupId,
                deviceId: getLookupValue(setupFields[SETUP.DEVICE]),
                templateId: getLookupValue(setupFields[SETUP.TEMPLATE_ID]),
                jsonData: setupFields[SETUP.JSON_DATA],
                docTypeText: docType && docType.length ? docType[0].text : '',
                printTypeText: printType && printType.length ? printType[0].text : '',
                printForm: getLookupValue(setupFields[SETUP.PRINT_FORM])
            };
        };

        //Standard prints the transaction with the Print Form; Custom builds the job from JSON Data / template
        LIB_FX.buildJobData = (printSetup, recordType, recordId) => {
            const DEFAULTS = _CONFIG.JOB_DEFAULTS;

            if (String(printSetup.printTypeText).trim().toLowerCase() === _CONFIG.PRINT_TYPE_STANDARD) {
                if (!printSetup.printForm) {
                    throw error.create({
                        name: 'BB1_AUTOPRINT_NO_PRINT_FORM',
                        message: 'Document Print Setup ' + printSetup.id + ' is Standard but has no Print Form'
                    });
                }

                return {
                    type: DEFAULTS.STANDARD_TYPE,
                    id: Number(recordId),
                    format: DEFAULTS.FORMAT,
                    formnumber: printSetup.printForm
                };
            }

            //Custom: JSON Data is the base job definition; template and the record being printed are applied on top
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

        //blank / invalid print quantity = a single print
        LIB_FX.getPrintQty = (printQty) => {
            let qty = parseInt(printQty, 10);
            return qty > 0 ? qty : 1;
        };

        LIB_FX.queuePrintJob = (printSetup, recordType, recordId, printQty) => {
            if (!printSetup.deviceId) {
                throw error.create({
                    name: 'BB1_AUTOPRINT_NO_DEVICE',
                    message: 'Document Print Setup ' + printSetup.id + ' has no Printer'
                });
            }

            let jobName = recordType + ' - ' + printSetup.docTypeText;
            let jobData = LIB_FX.buildJobData(printSetup, recordType, recordId);
            let copies = LIB_FX.getPrintQty(printQty);
            log.debug('queuePrintJob', {deviceId: printSetup.deviceId, jobName: jobName, jobData: jobData, copies: copies});

            //one queued job per copy
            for (let i = 0; i < copies; i++) {
                bb1qz.AddJobToQueue(Number(printSetup.deviceId), _CONFIG.QZ_PLUGIN, jobName, jobData, null);
            }
        };

        //processes the queue, then returns the user to the record
        LIB_FX.processQueue = (recordType, recordId) => {
            let redirectUrl = url.resolveRecord({recordType: recordType, recordId: recordId, isEditMode: false});
            bb1qz.InitiateProcessJobQueue(redirectUrl || null, null, null, false, false, null);
        };

        return {LIB_FX, _CONFIG};
    });
