/**
 * Project: J&K Ross - P102821
 *
 * Teamwork task: P102821 - Production Order
 *
 * Builds the Manufacture Document PDF data source for a Project Order (from
 * its linked Sales Order/Work Orders) and queues one bb1_jkr_manuf_doc_proj_order.xml
 * print job per Work Order through the QZ print library/plugin (Manufacture
 * Document button) - each job's PDF data is stored on that Work Order's Project
 * Order Line record (customrecord_bb1_prjord_l), not the Project Order header,
 * so concurrently queued jobs don't overwrite each other's data
 *
 * Also queues a single bb1_jkr_pick_doc_proj_order.xml Picking Ticket print job
 * (Picking Ticket button) straight against the Project Order's linked Sales Order -
 * that template reads its fields directly off the Sales Order record, so no PDF
 * data source needs to be built/stored first
 *
 * Called By: bb1_jkr_prod_order_print_ue.js (Manufacture Document / Picking Ticket buttons)
 * Calls: bb1_qz_lib_public (SuiteApp com.bluebridgeonecouk.qztray)
 *
 * Date                Author              Purpose
 * 29-September-2026   Jared Espineli     Initial Release
 * 01-October-2026      Jared Espineli     Added Picking Ticket print job
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

        //request parameter telling this Suitelet which document to print - must match bb1_jkr_prod_order_print_cs.js
        var REQUEST_PARAM_DOC_TYPE = 'custscript_bb1_jkr_prod_order_print_doctype_su';
        var DOC_TYPE_PICK = 'PICK';

        //deployment script parameter holding bb1_jkr_manuf_doc_proj_order.xml's internal id
        var SCRIPT_PARAM_TEMPLATE_ID = 'custscript_bb1_jkr_prod_order_print_tmpl';

        //deployment script parameter holding bb1_jkr_pick_doc_proj_order.xml's internal id
        var SCRIPT_PARAM_PICK_TEMPLATE_ID = 'custscript_bb1_jkr_prod_order_pick_tmpl';

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
            var docType = request.parameters[REQUEST_PARAM_DOC_TYPE];

            if (docType === DOC_TYPE_PICK) {
                printPickingTicket(projOrderId);
                return;
            }

            var templateId = runtime.getCurrentScript().getParameter({name: SCRIPT_PARAM_TEMPLATE_ID});

            log.debug('Manufacture Document requested', {projOrderId: projOrderId, templateId: templateId});

            try {
                var salesOrderId = getSalesOrderId(projOrderId);
                var pdfDataSource = buildPdfDataSource(salesOrderId);
                var salesOrderObj = pdfDataSource.salesorders[0];
                var lineIdsByWorkOrder = getProjOrderLineIds(projOrderId);

                //one job per Work Order, each against its own Project Order Line record -
                //referencing the shared Project Order header for every job would mean every
                //job reads whatever the header's PDF data field holds when the QZ plugin
                //actually renders it (later, once the whole queue is processed), so every job
                //would end up rendering the same (last-written) Work Order
                salesOrderObj.workorders.forEach(function (workOrder) {
                    var lineId = lineIdsByWorkOrder[workOrder.workorderid];

                    if (!lineId) {
                        log.error('Manufacture Document print - no Project Order Line found for Work Order ' + workOrder.workorderid, {projOrderId: projOrderId});
                        return;
                    }

                    storePdfDataSource(lineId, {
                        salesorders: [{
                            trandate: salesOrderObj.trandate,
                            salesorderid: salesOrderObj.salesorderid,
                            customer: salesOrderObj.customer,
                            customername: salesOrderObj.customername,
                            workorders: [workOrder]
                        }]
                    });

                    queueManufactureDocumentPrint(lineId, templateId);
                });

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
                    message: 'Could not render the Manufacture Document for Project Order ' + projOrderId + ': ' + e.message
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
            var rowCount = 0;

            transactionSearchObj.run().each(function (result) {
                rowCount++;

                salesOrderObj.trandate = result.getValue({name: 'trandate'});
                salesOrderObj.salesorderid = result.getValue({name: 'tranid'});
                salesOrderObj.customer = result.getValue({name: 'altname', join: 'customer'});
                salesOrderObj.customername = result.getValue({name: 'companyname', join: 'customer'});

                var workOrderId = result.getValue({name: 'applyingtransaction'});
                var workOrderText = result.getText({name: 'applyingtransaction'});

                log.debug('buildPdfDataSource - Sales Order line ' + rowCount, {
                    line: result.id,
                    workOrderId: workOrderId,
                    workOrderText: workOrderText
                });

                if (workOrderId) {
                    var workOrderObj = buildWorkOrderObj(workOrderId, result);
                    assemblyIdArray.push(workOrderObj.assemblyitemid);
                    salesOrderObj.workorders.push(workOrderObj);
                }

                return true;
            });

            fixAssemblyItemNames(salesOrderObj.workorders, assemblyIdArray);

            log.debug('buildPdfDataSource - Work Orders found', {
                salesOrderId: salesOrderId,
                salesOrderLinesScanned: rowCount,
                workOrderCount: salesOrderObj.workorders.length,
                workOrders: salesOrderObj.workorders.map(function (wo) {
                    return {workorderno: wo.workorderno, assemblyitemid: wo.assemblyitemid};
                })
            });

            return {salesorders: [salesOrderObj]};
        }

        //Work Order + logo line detail for one Sales Order search result row
        function buildWorkOrderObj(workOrderId, result) {
            var workOrderRec = record.load({type: record.Type.WORK_ORDER, id: workOrderId});
            var requestedDate = workOrderRec.getValue({fieldId: 'requesteddate'});

            return {
                workorderid: Number(workOrderId),
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

        //maps each Work Order internal id to its Project Order Line record id, so each print
        //job below can store/reference its own Line record instead of the shared header
        function getProjOrderLineIds(projOrderId) {
            var LINE = PROJ_ORDER.SUBLIST.LINE;
            var lineIdsByWorkOrder = {};

            var lineSearchObj = search.create({
                type: LINE.REC_ID,
                filters: [[LINE.PARENT, 'anyof', projOrderId]],
                columns: [search.createColumn({name: LINE.WO})]
            });

            lineSearchObj.run().each(function (result) {
                var workOrderId = result.getValue({name: LINE.WO});
                lineIdsByWorkOrder[workOrderId] = result.id;
                return true;
            });

            return lineIdsByWorkOrder;
        }

        //stores the built single-Work-Order PDF data source as JSON on that Work Order's
        //Project Order Line record so the QZ RECORD print job (type/templateid/records/format
        //only - no custom data source slot) can render bb1_jkr_manuf_doc_proj_order.xml, which
        //reads this field straight off the loaded Line record and parses it into custPDFdata
        //with FreeMarker's ?eval
        function storePdfDataSource(lineId, pdfDataSource) {
            var LINE = PROJ_ORDER.SUBLIST.LINE;

            try {
                record.submitFields({
                    type: LINE.REC_ID,
                    id: lineId,
                    values: {
                        [LINE.PDF_DATA]: JSON.stringify(pdfDataSource)
                    }
                });
            } catch (e) {
                log.error('storePdfDataSource failed for Project Order Line ' + lineId, e.message);
                throw error.create({
                    name: 'BB1_MANUFDOC_DATA_STORE_FAILED',
                    message: 'Could not store PDF data on Project Order Line ' + lineId + ': ' + e.message
                });
            }
        }

        //queues the print job through the QZ library/plugin, against the Work Order's Project
        //Order Line record - templateid/records[].id must be numeric (not the string/search
        //result ids used elsewhere) to match the QZ RECORD job schema
        function queueManufactureDocumentPrint(lineId, templateId) {
            var jobData = {
                type: 'RECORD',
                templateid: Number(templateId),
                records: [
                    {type: PROJ_ORDER.SUBLIST.LINE.REC_ID, id: Number(lineId)}
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

        //-----------------------------------------------
        //Triggered from the Picking Ticket button
        //-----------------------------------------------
        function printPickingTicket(projOrderId) {
            var templateId = runtime.getCurrentScript().getParameter({name: SCRIPT_PARAM_PICK_TEMPLATE_ID});

            log.debug('Picking Ticket requested', {projOrderId: projOrderId, templateId: templateId});

            try {
                var salesOrderId = getSalesOrderId(projOrderId);

                if (!salesOrderId) {
                    throw error.create({
                        name: 'BB1_PICKTICKET_NO_SALES_ORDER',
                        message: 'Project Order ' + projOrderId + ' has no linked Sales Order (' + PROJ_ORDER.HEADER.SALES_ORDER + ')'
                    });
                }

                queuePickingTicketPrint(salesOrderId, templateId);

                var redirectUrl = url.resolveRecord({
                    recordType: PROJ_ORDER.REC_ID,
                    recordId: projOrderId,
                    isEditMode: false
                });

                bb1qz.InitiateProcessJobQueue(redirectUrl || null, null, null, false, false, null);
            } catch (e) {
                log.error('Picking Ticket print failed', e.message);
                throw error.create({
                    name: 'BB1_PICKTICKET_PRINT_FAILED',
                    message: 'Could not render the Picking Ticket for Project Order ' + projOrderId + ': ' + e.message
                });
            }
        }

        //queues the Picking Ticket print job directly against the linked Sales Order record -
        //bb1_jkr_pick_doc_proj_order.xml reads its fields straight off the Sales Order, so
        //(unlike the Manufacture Document) no PDF data source needs to be built/stored first
        function queuePickingTicketPrint(salesOrderId, templateId) {
            var jobData = {
                type: 'RECORD',
                templateid: Number(templateId),
                records: [
                    {type: 'salesorder', id: Number(salesOrderId)}
                ],
                format: 'PDF'
            };

            bb1qz.AddJobToQueue(
                5,
                QZ_PRINT_PLUGIN_SCRIPT_ID,
                'Picking Ticket Printing',
                jobData,
                null
            );
        }

        return {
            onRequest: onRequest
        };

    });
