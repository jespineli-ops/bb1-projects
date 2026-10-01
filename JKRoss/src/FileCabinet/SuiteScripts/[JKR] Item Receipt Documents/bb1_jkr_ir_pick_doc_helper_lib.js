/**
 * Project: J&K Ross - P102821
 *
 * Teamwork task: P102821 - Production Order
 *
 * Helper library for Item Receipt Picking Ticket scripts - shared config (record/field ids,
 * script parameters) plus the logic that turns newly-committed Sales Order lines from an Item
 * Receipt save into one customrecord_bb1_jkr_ir_pick_data record per Sales Order
 *
 * Date              Author              Purpose
 * 01-October-2026   Jared Espineli     Initial Release
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/record', 'N/search', 'N/format'],
    (record, search, format) => {
        const _CONFIG = {
            SCRIPTS: {
                PARAM: {
                    //read by bb1_jkr_prod_ord_ue.js's afterSubmit (deployed on the UE's own
                    //deployment)
                    COMMIT_SEARCH: 'custscript_bb1_jkr_ir_rel_t_proj_ord_sea',
                    //read by bb1_jkr_ir_pick_doc_wfa.js (Workflow Action Script parameter)
                    PICK_TEMPLATE: 'custscript_bb1_jkr_ir_pick_doc_temp'
                }
            },
            PICK_DATA: {
                REC_ID: 'customrecord_bb1_jkr_ir_pick_data',
                ITEM_RECEIPT: 'custrecord_bb1_jkr_ir_pick_data_ir',
                SALES_ORDER: 'custrecord_bb1_jkr_ir_pick_data_so',
                JSON_DATA: 'custrecord_bb1_jkr_ir_pick_data_json',
                PRINTED: 'custrecord_bb1_jkr_ir_pick_data_printed'
            }
        };

        //raw "recordtype" value as the search API returns it (lowercase, no spaces) - this field
        //doesn't support getText() (always returns null), only getValue()
        const RECORD_TYPE_SALES_ORDER = 'salesorder';
        const SO_ITEM_SUBLIST = 'item';

        //columns read off the COMMIT_SEARCH saved search (transaction search over SalesOrd/WorkOrd
        //lines whose committed quantity increased - see Teamwork task P102821 for the full search
        //definition)
        const COMMIT_SEARCH_COLUMN = {
            ITEM: 'item',
            RECORD_TYPE: 'recordtype',
            TRANID: 'tranid',
            TRANDATE: 'trandate'
        };

        const LIB_FX = {};

        //true when dateA and dateB fall on the same calendar day (ignores time-of-day)
        const isSameCalendarDate = (dateA, dateB) => {
            return dateA.getFullYear() === dateB.getFullYear()
                && dateA.getMonth() === dateB.getMonth()
                && dateA.getDate() === dateB.getDate();
        }

        //unique item internal ids on the Item Receipt's item sublist
        const getReceiptItemIds = (itemReceiptRec) => {
            let lineCount = itemReceiptRec.getLineCount({sublistId: SO_ITEM_SUBLIST});
            let itemIds = [];

            for (let i = 0; i < lineCount; i++) {
                let itemId = itemReceiptRec.getSublistValue({sublistId: SO_ITEM_SUBLIST, fieldId: 'item', line: i});

                if (itemId && itemIds.indexOf(itemId) === -1) {
                    itemIds.push(itemId);
                }
            }

            return itemIds;
        }

        //rows from the commitment-tracking saved search, scoped to this receipt's items and to
        //commitment events on the same calendar date as the Item Receipt's own creation - the
        //search itself carries no date filter, so without this every historical "newly committed"
        //event for these items (from any past receipt) would be picked up again
        const getNewlyCommittedRows = (itemIds, idCommitSearch, irCreatedDate) => {
            let commitSearch = search.load({id: idCommitSearch});
            log.debug('getNewlyCommittedRows', 'search loaded - existing filter count: ' + commitSearch.filters.length);

            log.debug('getNewlyCommittedRows', {
                idCommitSearch: idCommitSearch,
                itemIds: itemIds,
                irCreatedDate: irCreatedDate
            });

            //the search's own raw filter definition uses the lowercase dotted join id
            //("linesystemnotes.field"), not the camelCase alias ("lineSystemNotes") that only
            //columns seem to accept - matching that exactly here, since the camelCase join on a
            //createFilter() join param is the suspected cause of the previous failure
            let itemFilter = search.createFilter({
                name: COMMIT_SEARCH_COLUMN.ITEM,
                operator: search.Operator.ANYOF,
                values: itemIds
            });
            log.debug('getNewlyCommittedRows', 'item filter created');
            commitSearch.filters.push(itemFilter);
            log.debug('getNewlyCommittedRows', 'item filter pushed - filter count: ' + commitSearch.filters.length);

            //NOT filtering linesystemnotes.date in the search itself - every variation tried
            //(two filters, a single WITHIN filter, string values, raw Date values) broke search
            //execution the same way, which points at this join's date field simply not being
            //filterable even though it works fine as a column (read per-row below). The window is
            //applied in memory instead, against the same value already read successfully as a
            //column.
            let rows = [];
            let scannedCount = 0;

            log.debug('getNewlyCommittedRows', 'about to run search');
            commitSearch.run().each((result) => {
                scannedCount++;

                let dateCommittedRaw = result.getValue({name: 'date', join: 'linesystemnotes'});
                let dateCommitted = dateCommittedRaw ? format.parse({value: dateCommittedRaw, type: format.Type.DATETIME}) : null;
                let withinWindow = !!dateCommitted && isSameCalendarDate(dateCommitted, irCreatedDate);

                log.debug('getNewlyCommittedRows - row', {
                    resultId: result.id,
                    recordType: result.getValue({name: COMMIT_SEARCH_COLUMN.RECORD_TYPE}),
                    item: result.getValue({name: COMMIT_SEARCH_COLUMN.ITEM}),
                    dateCommitted: dateCommittedRaw,
                    withinWindow: withinWindow
                });

                if (withinWindow) {
                    rows.push(result);
                }

                return true;
            });

            log.debug('getNewlyCommittedRows', 'Found ' + rows.length + ' row(s) within window (scanned ' + scannedCount + ')');

            return rows;
        }

        //groups search rows by their parent transaction (Sales Order or Work Order) internal id
        const groupRowsByOrder = (rows) => {
            let groups = {};
            let orderIds = [];

            rows.forEach((result) => {
                let orderId = result.id;

                if (!groups[orderId]) {
                    groups[orderId] = {
                        orderId: orderId,
                        recordType: result.getValue({name: COMMIT_SEARCH_COLUMN.RECORD_TYPE}),
                        tranid: result.getValue({name: COMMIT_SEARCH_COLUMN.TRANID}),
                        trandate: result.getValue({name: COMMIT_SEARCH_COLUMN.TRANDATE}),
                        itemIds: []
                    };
                    orderIds.push(orderId);
                }

                let itemId = result.getValue({name: COMMIT_SEARCH_COLUMN.ITEM});

                if (groups[orderId].itemIds.indexOf(itemId) === -1) {
                    groups[orderId].itemIds.push(itemId);
                }
            });

            return orderIds.map((orderId) => groups[orderId]);
        }

        //builds {tranid, trandate, shipaddress, shipmethod, item: [...]}, keeping only the lines
        //in itemIds - matches the field names bb1_jkr_pick_doc_ir.xml's evaluated custPDFdata
        //object uses, so the rest of that template's markup doesn't need to change. tranid/trandate
        //come from the commit search row itself (group.tranid/group.trandate), not record.load -
        //the search already has them as columns, and reading them from there avoids a second,
        //redundant source for the same values.
        const buildSalesOrderPdfDataSource = (salesOrderId, tranid, trandate, itemIds) => {
            let salesOrderRec = record.load({type: record.Type.SALES_ORDER, id: salesOrderId});

            let dataSource = {
                tranid: tranid,
                trandate: trandate,
                shipaddress: salesOrderRec.getValue({fieldId: 'shipaddress'}),
                shipmethod: salesOrderRec.getText({fieldId: 'shipmethod'}),
                item: []
            };

            let lineCount = salesOrderRec.getLineCount({sublistId: SO_ITEM_SUBLIST});

            for (let i = 0; i < lineCount; i++) {
                let lineItemId = salesOrderRec.getSublistValue({sublistId: SO_ITEM_SUBLIST, fieldId: 'item', line: i});

                if (itemIds.indexOf(lineItemId) === -1) {
                    continue;
                }

                dataSource.item.push({
                    item: salesOrderRec.getSublistText({sublistId: SO_ITEM_SUBLIST, fieldId: 'item', line: i}),
                    description: salesOrderRec.getSublistValue({sublistId: SO_ITEM_SUBLIST, fieldId: 'description', line: i}),
                    custcol_bb1_shelf_number: salesOrderRec.getSublistValue({sublistId: SO_ITEM_SUBLIST, fieldId: 'custcol_bb1_shelf_number', line: i}),
                    quantitycommitted: salesOrderRec.getSublistValue({sublistId: SO_ITEM_SUBLIST, fieldId: 'quantitycommitted', line: i}),
                    units: salesOrderRec.getSublistText({sublistId: SO_ITEM_SUBLIST, fieldId: 'units', line: i}),
                    //TODO: native "Item Options" text is computed by NetSuite's template engine only
                    //when bound directly to a live record - it can't be reproduced generically from a
                    //sublist read. Left blank; confirm with a test print whether this is actually
                    //needed for this document, and if so which field(s) should feed it.
                    options: ''
                });
            }

            return dataSource;
        }

        LIB_FX.createPickDataRecord = (itemReceiptId, salesOrderId, dataSource) => {
            let pickDataRec = record.create({type: _CONFIG.PICK_DATA.REC_ID, isDynamic: true});

            //"Include Name Field" is enabled on this custom record, so Name is mandatory on save
            pickDataRec.setValue({fieldId: 'name', value: 'IR ' + itemReceiptId + ' - SO ' + salesOrderId});
            pickDataRec.setValue({fieldId: _CONFIG.PICK_DATA.ITEM_RECEIPT, value: itemReceiptId});
            pickDataRec.setValue({fieldId: _CONFIG.PICK_DATA.SALES_ORDER, value: salesOrderId});
            pickDataRec.setValue({fieldId: _CONFIG.PICK_DATA.JSON_DATA, value: JSON.stringify(dataSource)});
            pickDataRec.setValue({fieldId: _CONFIG.PICK_DATA.PRINTED, value: false});

            let idPickData = pickDataRec.save();
            log.debug('createPickDataRecord', 'Pick data record ' + idPickData + ' created for Item Receipt ' + itemReceiptId + ' / Sales Order ' + salesOrderId);

            return idPickData;
        }

        /**
         * Entry point called from bb1_jkr_prod_ord_ue.js's afterSubmit for Item Receipt saves
         * (CREATE only). Finds the Sales Order lines whose committed quantity increased because
         * of this receipt (via idCommitSearch, scoped to this receipt's items and to the same
         * calendar date as its creation) and creates one pick-data record per Sales Order so
         * bb1_jkr_ir_pick_doc_wfa.js can print one Picking Ticket per order.
         */
        LIB_FX.processItemReceiptPickTickets = (itemReceiptRec, itemReceiptId, idCommitSearch) => {
            if (!idCommitSearch) {
                log.error('processItemReceiptPickTickets', 'Missing ' + _CONFIG.SCRIPTS.PARAM.COMMIT_SEARCH + ' script parameter');
                return;
            }

            let itemIds = getReceiptItemIds(itemReceiptRec);
            log.debug('processItemReceiptPickTickets', 'Item Receipt ' + itemReceiptId + ' item ids: ' + itemIds.join(','));

            if (!itemIds.length) {
                return;
            }

            let irCreatedDate = itemReceiptRec.getValue({fieldId: 'createddate'});

            if (!irCreatedDate) {
                log.error('processItemReceiptPickTickets', 'Item Receipt ' + itemReceiptId + ' has no createddate - cannot scope the commitment window');
                return;
            }

            let rows = getNewlyCommittedRows(itemIds, idCommitSearch, irCreatedDate);

            if (!rows.length) {
                log.debug('processItemReceiptPickTickets', 'No newly committed Sales Order/Work Order lines found for Item Receipt ' + itemReceiptId);
                return;
            }

            let groups = groupRowsByOrder(rows);
            let pickDataCount = 0;

            groups.forEach((group) => {
                //Work Order commitment events aren't supported yet - no picking ticket template or
                //custom record field exists for them yet; log and skip rather than guess
                if (group.recordType !== RECORD_TYPE_SALES_ORDER) {
                    log.debug('processItemReceiptPickTickets', 'Skipping ' + group.recordType + ' ' + group.orderId + ' - Work Order picking tickets not yet supported');
                    return;
                }

                try {
                    let dataSource = buildSalesOrderPdfDataSource(group.orderId, group.tranid, group.trandate, group.itemIds);
                    LIB_FX.createPickDataRecord(itemReceiptId, group.orderId, dataSource);
                    pickDataCount++;
                } catch (e) {
                    log.error('processItemReceiptPickTickets - failed for Sales Order ' + group.orderId, e.message);
                }
            });

            log.debug('processItemReceiptPickTickets', 'Created ' + pickDataCount + ' pick data record(s) for Item Receipt ' + itemReceiptId);
        }

        return {LIB_FX, _CONFIG};
    });
