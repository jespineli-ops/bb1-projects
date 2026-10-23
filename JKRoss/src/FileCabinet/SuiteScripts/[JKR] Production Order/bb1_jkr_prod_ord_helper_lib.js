/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: J&K Ross - P102821
 * Helper library for Production Order Scripts
 *
 * Date              Author              Purpose
 * 23-September-2026  Jared Espineli     Initial Release
 * 21-October-2026    Jared Espineli     Project Order Default Printer set from the current user's
 *                                       employee record on create
 * 23-October-2026    Jared Espineli     getUserDefaultPrinter exposed for the print Suitelet
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 */
define(['N/record', 'N/search', 'N/format', 'N/runtime'],
    (record, search, format, runtime) => {
        const _CONFIG = {
            SCRIPTS: {
                PARAM: {
                    WO_SEARCH: 'custscript_bb1_jkr_wo_proj_ord_sea'
                }
            },
            EMPLOYEE: {
                DFLT_PRINTER: 'custentity_bb1_jkr_user_dflt_printer'
            },
            HEADER: {
                STATUS: 'status',
                PROJ_ORDER: 'custbody_bb1_jkr_wo_proj_ord_id'
            },
            SUBLIST: {
                ITEM: {
                    ID: 'item',
                    CREATE_WO: 'createwo'
                },
                LINKS: {
                    ID: 'links',
                    TYPE: 'type'
                }
            },
            PROJ_ORDER: {
                REC_ID: 'customrecord_bb1_prjord',
                HEADER: {
                    SALES_ORDER: 'custrecord_bb1_prjord_so',
                    STATUS: 'custrecord_bb1_prjord_status',
                    TOTAL_WO: 'custrecord_bb1_prjord_wo',
                    TOTAL_WO_COMPLETED: 'custrecord_bb1_prjord_wo_comp',
                    PDF_DATA: 'custrecord_bb1_prjord_pdf_data',
                    DFLT_PRINTER: 'custrecord_bb1_prjord_dflt_printer'
                },
                SUBLIST: {
                    LINE: {
                        ID: 'recmachcustrecord_bb1_prjord_l_prjo',
                        REC_ID: 'customrecord_bb1_prjord_l',
                        PARENT: 'custrecord_bb1_prjord_l_prjo',
                        WO: 'custrecord_bb1_prjord_l_wo',
                        BUILDABLE: 'custrecord_bb1_prjord_l_buildable',
                        BUILT: 'custrecord_bb1_prjord_l_buildt',
                        EST_START: 'custrecord_bb1_prjord_l_est_start',
                        EST_END: 'custrecord_bb1_prjord_l_est_end',
                        PDF_DATA: 'custrecord_bb1_prjord_l_pdf_data'
                    }
                }
            }
        };

        const STATUS_PENDING_FULFILLMENT = 'Pending Fulfillment';
        const LINK_TYPE_WORK_ORDER = 'Work Order';

        //columns on the WO_SEARCH saved search (see bb1_jkr_prod_ord_helper_lib console snippet below)
        const WO_SEARCH_COLUMN = {
            INTERNAL_ID: 'internalid',
            BUILDABLE: 'buildable',
            BUILT: 'built',
            ACTUAL_START_DATE: 'actualproductionstartdate',
            ACTUAL_END_DATE: 'actualproductionenddate'
        };

        const LIB_FX = {};

        //true when the Sales Order is already linked to a Project Order
        LIB_FX.hasProjOrder = (salesOrderRec) => {
            let projOrderId = salesOrderRec.getValue({fieldId: _CONFIG.HEADER.PROJ_ORDER});
            return !!projOrderId;
        }

        LIB_FX.isPendingFulfillment = (salesOrderRec) => {
            let orderStatus = salesOrderRec.getText(_CONFIG.HEADER.STATUS);
            return orderStatus == STATUS_PENDING_FULFILLMENT;
        }

        //true when at least one item line has Create Work Order checked
        LIB_FX.hasCreateWoLine = (salesOrderRec) => {
            let sublistId = _CONFIG.SUBLIST.ITEM.ID;
            let lineCount = salesOrderRec.getLineCount({sublistId: sublistId});

            for(let i = 0; i < lineCount; i++){
                let createWoValue = salesOrderRec.getSublistValue({
                    sublistId: sublistId,
                    fieldId: _CONFIG.SUBLIST.ITEM.CREATE_WO,
                    line: i
                });

                if(createWoValue === true || createWoValue === 'T'){
                    return true;
                }
            }

            return false;
        }

        //number of link lines whose type is Work Order
        const countWorkOrderLinks = (salesOrderRec) => {
            let sublistId = _CONFIG.SUBLIST.LINKS.ID;
            let lineCount = salesOrderRec.getLineCount({sublistId: sublistId});
            let workOrderCount = 0;

            for(let j = 0; j < lineCount; j++){
                let linkType = salesOrderRec.getSublistText({
                    sublistId: sublistId,
                    fieldId: _CONFIG.SUBLIST.LINKS.TYPE,
                    line: j
                });

                if(linkType == LINK_TYPE_WORK_ORDER){
                    workOrderCount++;
                }
            }

            return workOrderCount;
        }

        //true when at least one link line is a Work Order
        LIB_FX.hasWorkOrderLink = (salesOrderRec) => {
            return countWorkOrderLinks(salesOrderRec) > 0;
        }

        /**
         * Creates a Project Order record from a Sales Order record. Total Work Orders is
         * set from the count of Work Order links on the Sales Order; Total Work Orders
         * Completed is left blank for now. Project Order Lines are created from idWoSearch
         * (the WO_SEARCH saved search) right after the Project Order itself is saved.
         */
        LIB_FX.createProjOrder = (salesOrderRec, salesOrderId, idWoSearch) => {
            let projOrderFields = _CONFIG.PROJ_ORDER.HEADER;
            let totalWorkOrders = countWorkOrderLinks(salesOrderRec);

            let projOrderRec = record.create({
                type: _CONFIG.PROJ_ORDER.REC_ID,
                isDynamic: true
            });

            projOrderRec.setValue({fieldId: projOrderFields.SALES_ORDER, value: salesOrderId});
            projOrderRec.setValue({fieldId: projOrderFields.TOTAL_WO, value: totalWorkOrders});
            projOrderRec.setValue({fieldId: projOrderFields.STATUS, value: 1}); //default to open upon creation

            let defaultPrinter = LIB_FX.getUserDefaultPrinter();
            if(defaultPrinter){
                projOrderRec.setValue({fieldId: projOrderFields.DFLT_PRINTER, value: defaultPrinter});
            }

            let idProjOrder = projOrderRec.save();
            log.debug('createProjOrder', 'Project Order ' + idProjOrder + ' created from Sales Order ' + salesOrderId + ' with ' + totalWorkOrders + ' Work Order link(s)');

            //links the new Project Order back to the Sales Order that spawned it
            record.submitFields({
                type: salesOrderRec.type,
                id: salesOrderId,
                values: {
                    [_CONFIG.HEADER.PROJ_ORDER]: idProjOrder
                }
            });

            LIB_FX.setProjOrderLines(idProjOrder, salesOrderId, idWoSearch);

            return idProjOrder;
        }

        //Default Printer on the current user's employee record, or null when the user isn't an
        //employee (e.g. -4 system/web services contexts) or has none set
        LIB_FX.getUserDefaultPrinter = () => {
            let userId = runtime.getCurrentUser().id;

            if(!userId || userId < 0){
                log.debug('getUserDefaultPrinter', 'No employee for current user ' + userId + ' - Default Printer left blank');
                return null;
            }

            try {
                let employeeFields = search.lookupFields({
                    type: search.Type.EMPLOYEE,
                    id: userId,
                    columns: [_CONFIG.EMPLOYEE.DFLT_PRINTER]
                });

                let defaultPrinter = employeeFields[_CONFIG.EMPLOYEE.DFLT_PRINTER];
                return defaultPrinter && defaultPrinter.length ? defaultPrinter[0].value : null;
            } catch (e) {
                log.error('getUserDefaultPrinter failed for user ' + userId, e.message);
                return null;
            }
        }

        //converts a search result's date column string to a Date, or null when the column is empty
        const parseSearchDate = (dateValue) => dateValue ? format.parse({value: dateValue, type: format.Type.DATE}) : null;

        /**
         * Creates one Project Order Line child record per Work Order found by WO_SEARCH
         * (loaded by idWoSearch) that was created from this Sales Order. Returns the number
         * of lines created.
         */
        LIB_FX.setProjOrderLines = (idProjOrder, salesOrderId, idWoSearch) => {
            let lineFields = _CONFIG.PROJ_ORDER.SUBLIST.LINE;

            let woSearch = search.load({id: idWoSearch});
            woSearch.filters.push(search.createFilter({
                name: 'createdfrom',
                operator: search.Operator.ANYOF,
                values: salesOrderId
            }));

            let lineCount = 0;

            woSearch.run().each((result) => {
                let idWorkOrder = result.getValue({name: WO_SEARCH_COLUMN.INTERNAL_ID});

                try {
                    let buildableValue = result.getValue({name: WO_SEARCH_COLUMN.BUILDABLE});
                    let builtValue = result.getValue({name: WO_SEARCH_COLUMN.BUILT});
                    let startDateValue = result.getValue({name: WO_SEARCH_COLUMN.ACTUAL_START_DATE});
                    let endDateValue = result.getValue({name: WO_SEARCH_COLUMN.ACTUAL_END_DATE});

                    //TEMP diagnostic - remove once the Built column mismatch is confirmed/fixed
                    log.debug('setProjOrderLines - raw WO_SEARCH row for WO ' + idWorkOrder, {
                        columns: result.columns.map((c) => c.name + (c.label ? ' (' + c.label + ')' : '')),
                        idWorkOrder: idWorkOrder,
                        buildableValue: buildableValue,
                        builtValue: builtValue,
                        startDateValue: startDateValue,
                        endDateValue: endDateValue
                    });

                    let lineRec = record.create({type: lineFields.REC_ID, isDynamic: false});

                    lineRec.setValue({fieldId: lineFields.PARENT, value: idProjOrder});
                    lineRec.setValue({fieldId: lineFields.WO, value: idWorkOrder});
                    lineRec.setValue({fieldId: lineFields.BUILDABLE, value: buildableValue});
                    lineRec.setValue({fieldId: lineFields.BUILT, value: builtValue});

                    let startDate = parseSearchDate(startDateValue);
                    if(startDate){
                        lineRec.setValue({fieldId: lineFields.EST_START, value: startDate});
                    }

                    let endDate = parseSearchDate(endDateValue);
                    if(endDate){
                        lineRec.setValue({fieldId: lineFields.EST_END, value: endDate});
                    }

                    //TEMP diagnostic - confirms whether setValue already holds the wrong value pre-save
                    log.debug('setProjOrderLines - pre-save line values for WO ' + idWorkOrder, {
                        buildableOnRec: lineRec.getValue({fieldId: lineFields.BUILDABLE}),
                        builtOnRec: lineRec.getValue({fieldId: lineFields.BUILT})
                    });

                    lineRec.save();
                    lineCount++;
                } catch(e) {
                    log.error('setProjOrderLines - failed for Work Order ' + idWorkOrder, e.message);
                }

                return true;
            });

            log.debug('setProjOrderLines', 'Created ' + lineCount + ' Project Order Line(s) for Project Order ' + idProjOrder + ' from Sales Order ' + salesOrderId);

            return lineCount;
        }

        return {LIB_FX, _CONFIG};
    });
