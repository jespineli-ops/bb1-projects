/**
 * Project: J&K Ross - P102821
 *
 * Teamwork task: P102821 - Production Order
 *
 * Builds the Manufacture Document PDF data source for a Project Order (from
 * its linked Sales Order/Work Orders), stores it on the Project Order, and
 * queues the QZ print job that renders bb1_jkr_manuf_doc_proj_order.xml
 *
 * Called By: bb1_jkr_prod_order_print_ue.js (Manufacture Document button)
 * Calls: bb1_qz_lib_public (SuiteApp com.bluebridgeonecouk.qztray)
 *
 * Date                Author              Purpose
 * 29-September-2026   Jared Espineli     Initial Release
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/runtime', 'N/url', 'N/error',
        '/SuiteApps/com.bluebridgeonecouk.qztray/bb1_qz_lib_public',
        './bb1_jkr_prod_ord_helper_lib'],

    function (record, search, runtime, url, error, bb1qz, helperLib) {

        var PROJ_ORDER = helperLib._CONFIG.PROJ_ORDER;

        //request parameter carrying the Project Order internal id (built into the button URL)
        var REQUEST_PARAM_PROJ_ORDER_ID = 'custscript_bb1_jkr_prod_order_print_id_su';

        //deployment script parameter holding bb1_jkr_manuf_doc_proj_order.xml's internal id
        var SCRIPT_PARAM_TEMPLATE_ID = 'custscript_bb1_jkr_prod_order_print_tmpl_su';

        var QZ_PRINT_PLUGIN_SCRIPT_ID = 'customscript_bb1_qz_pi_record';

        /**
         * @param {Object} scriptContext
         * @param {ServerRequest} scriptContext.request
         * @param {ServerResponse} scriptContext.response
         */
        function onRequest(scriptContext) {
            if (scriptContext.request.method !== 'GET') {
                return;
            }

            var request = scriptContext.request;
            var projOrderId = request.parameters[REQUEST_PARAM_PROJ_ORDER_ID];
            var templateId = runtime.getCurrentScript().getParameter({name: SCRIPT_PARAM_TEMPLATE_ID});

            log.debug('Manufacture Document requested', {projOrderId: projOrderId, templateId: templateId});

            try {
                var salesOrderId = getSalesOrderId(projOrderId);
                var pdfDataSource = buildPdfDataSource(salesOrderId);

                storePdfDataSource(projOrderId, pdfDataSource);
                queueManufactureDocumentPrint(projOrderId, templateId);

                var redirectUrl = url.resolveRecord({
                    recordType: PROJ_ORDER.REC_ID,
                    recordId: projOrderId,
                    isEditMode: false
                });

                bb1qz.InitiateProcessJobQueue(redirectUrl || null, null, null, false, false, null);
            } catch (e) {
                log.error('Manufacture Document print failed', e.message);
                throw error.create({
                    name: 'BB1_MANUFDOC_PRINT_FAILED',
                    message: 'Could not queue the Manufacture Document for Project Order ' + projOrderId + ': ' + e.message
                });
            }
        }

        //Sales Order internal id linked to the Project Order (custrecord_bb1_prjord_so)
        function getSalesOrderId(projOrderId) {
            var projOrderFields = search.lookupFields({
                type: PROJ_ORDER.REC_ID,
                id: projOrderId,
                columns: [PROJ_ORDER.HEADER.SALES_ORDER]
            });

            var salesOrder = projOrderFields[PROJ_ORDER.HEADER.SALES_ORDER];
            return salesOrder && salesOrder.length ? salesOrder[0].value : null;
        }

        //-----------------------------------------------
        //Builds {salesorders: [...]} from the Sales Order's Work Order links -
        //same shape the bb1_jkr_manuf_doc_proj_order.xml template expects as custPDFdata
        //-----------------------------------------------
        function buildPdfDataSource(salesOrderId) {
            var salesOrderObj = {
                trandate: '',
                salesorderid: '',
                customer: '',
                customername: '',
                workorders: []
            };

            var transactionSearchObj = search.create({
                type: 'transaction',
                filters: [
                    ['mainline', 'is', 'F'],
                    'AND',
                    ['cogs', 'is', 'F'],
                    'AND',
                    ['taxline', 'is', 'F'],
                    'AND',
                    ['shipping', 'is', 'F'],
                    'AND',
                    ['internalid', 'anyof', salesOrderId]
                ],
                columns: [
                    search.createColumn({name: 'tranid', label: 'Document Number'}),
                    search.createColumn({name: 'trandate', label: 'Date'}),
                    search.createColumn({name: 'altname', join: 'customer', label: 'Name'}),
                    search.createColumn({name: 'companyname', join: 'customer', label: 'Company Name'}),
                    search.createColumn({name: 'custcol_bb1_logo_location', label: 'Logo Location'}),
                    search.createColumn({name: 'custcol_bb1_name_to_print', label: 'Name to Print'}),
                    search.createColumn({name: 'custcol_bb1_font', label: 'Font'}),
                    search.createColumn({name: 'name', join: 'CUSTCOL_BB1_LOGO_CODE', label: 'Logo Code'}),
                    search.createColumn({
                        name: 'custrecord_bb1_logo_decription',
                        join: 'CUSTCOL_BB1_LOGO_CODE',
                        label: 'Logo Description'
                    }),
                    search.createColumn({name: 'applyingtransaction', label: 'Work Order'})
                ]
            });

            var assemblyIdArray = [];

            transactionSearchObj.run().each(function (result) {
                salesOrderObj.trandate = result.getValue({name: 'trandate'});
                salesOrderObj.salesorderid = result.getValue({name: 'tranid'});
                salesOrderObj.customer = result.getValue({name: 'altname', join: 'customer'});
                salesOrderObj.customername = result.getValue({name: 'companyname', join: 'customer'});

                var workOrderId = result.getValue({name: 'applyingtransaction'});

                if (workOrderId) {
                    var workOrderObj = buildWorkOrderObj(workOrderId, result);
                    assemblyIdArray.push(workOrderObj.assemblyitemid);
                    salesOrderObj.workorders.push(workOrderObj);
                }

                return true;
            });

            fixAssemblyItemNames(salesOrderObj.workorders, assemblyIdArray);

            return {salesorders: [salesOrderObj]};
        }

        //Work Order + logo line detail for one Sales Order search result row
        function buildWorkOrderObj(workOrderId, result) {
            var workOrderRec = record.load({type: record.Type.WORK_ORDER, id: workOrderId});
            var requestedDate = workOrderRec.getValue({fieldId: 'requesteddate'});

            return {
                purchasorder: workOrderRec.getText({fieldId: 'linkedpo'}).split('#')[1],
                expecteddate: formatDate(requestedDate),
                workorderno: workOrderRec.getText({fieldId: 'tranid'}),
                assemblyitemid: workOrderRec.getValue({fieldId: 'assemblyitem'}),
                assemblyitem: workOrderRec.getText({fieldId: 'assemblyitem'}),
                assemblyitemname: workOrderRec.getText({fieldId: 'assemblyitem'}),
                quantity: workOrderRec.getValue({fieldId: 'quantity'}),
                logocode: result.getValue({name: 'name', join: 'CUSTCOL_BB1_LOGO_CODE'}),
                logodesc: result.getValue({name: 'custrecord_bb1_logo_decription', join: 'CUSTCOL_BB1_LOGO_CODE'}),
                logolocation: result.getText({name: 'custcol_bb1_logo_location'}),
                logofont: result.getValue({name: 'custcol_bb1_font'}),
                logonametoprint: result.getValue({name: 'custcol_bb1_name_to_print'})
            };
        }

        function formatDate(dateValue) {
            if (!dateValue) {
                return '';
            }

            var dd = ('0' + dateValue.getDate()).slice(-2);
            var mm = ('0' + (dateValue.getMonth() + 1)).slice(-2);
            var yyyy = dateValue.getFullYear();

            return dd + '/' + mm + '/' + yyyy;
        }

        //the Work Order's assemblyitem getText() lookup is unreliable, so re-resolve the
        //display name from an item search once all assembly ids for the print run are known
        function fixAssemblyItemNames(workOrders, assemblyIdArray) {
            if (!assemblyIdArray.length) {
                return;
            }

            var itemSearchObj = search.create({
                type: 'item',
                filters: [['internalid', 'anyof', assemblyIdArray]],
                columns: [search.createColumn({name: 'displayname', label: 'Display Name'})]
            });

            itemSearchObj.run().each(function (result) {
                var itemId = result.id;
                var itemName = result.getValue({name: 'displayname'});

                for (var i = 0; i < workOrders.length; i++) {
                    if (workOrders[i].assemblyitemid == itemId) {
                        workOrders[i].assemblyitemname = itemName;
                    }
                }

                return true;
            });
        }

        //stores the built PDF data source as JSON on the Project Order so the QZ RECORD
        //print job (type/templateid/records/format only - no custom data source slot) can
        //render bb1_jkr_manuf_doc_proj_order.xml, which reads this field straight off the
        //loaded record and parses it into custPDFdata with FreeMarker's ?eval
        function storePdfDataSource(projOrderId, pdfDataSource) {
            try {
                record.submitFields({
                    type: PROJ_ORDER.REC_ID,
                    id: projOrderId,
                    values: {
                        [PROJ_ORDER.HEADER.PDF_DATA]: JSON.stringify(pdfDataSource)
                    }
                });
            } catch (e) {
                log.error('storePdfDataSource failed for Project Order ' + projOrderId, e.message);
                throw error.create({
                    name: 'BB1_MANUFDOC_DATA_STORE_FAILED',
                    message: 'Could not store PDF data on Project Order ' + projOrderId + ': ' + e.message
                });
            }
        }

        function queueManufactureDocumentPrint(projOrderId, templateId) {
            var jobData = {
                type: 'RECORD',
                templateid: templateId,
                records: [
                    {type: PROJ_ORDER.REC_ID, id: projOrderId}
                ],
                format: 'PDF'
            };

            bb1qz.AddJobToQueue(
                5,
                QZ_PRINT_PLUGIN_SCRIPT_ID,
                'Manufacture Document Printing',
                jobData,
                null
            );
        }

        return {
            onRequest: onRequest
        };

    });
