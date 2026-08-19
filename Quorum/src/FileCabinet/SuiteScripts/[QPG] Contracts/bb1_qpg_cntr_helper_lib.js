/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Contracts - P102843 Quorum NetSuite Implementation
 * Helper library for Contract Scripts
 *
 * Date        	  Author		        Purpose
 * 08/05/2026     Jared Espineli        Initial Version
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */

define(['N/record', 'N/runtime', 'N/search', 'N/format'],
    (record, runtime, search, format) => {
        const _CONFIG = {
            SCRIPTS: {
                PARAMETERS: {
                    CONTRACT_SEARCH: 'custscript_bb1_qpg_actv_cntr_util',
                    FIXED_CHARGES_SEARCH: 'custscript_bb1_qpg_fx_chrg_util',
                    UTIL_CHARGES_SEARCH: 'custscript_bb1_qpg_util_chrg_util',
                    IS_MANUAL: 'custscript_bb1_qpg_man_chck_util',
                    UTIL_PERIOD: 'custscript_bb1_qpg_period_util',
                    UPDATE_CONTRACT: 'custscript_bb1_qpg_cntr_ids',
                    INV_PERIOD: 'custscript_bb1_qpg_cntr_period_inv'
                }
            },
            CONTRACT: {
                REC_ID: 'customrecord_bb1_lease_contract'
            },
            UTILISED_CHARGE: {
                REC_ID: 'customrecord_bb1_utilised_charges'
            }
        }

        const _FIELDS = {
            CONTRACT: {
                HEADER: {
                    IS_UPDATING: 'custrecord_bb1_cntr_invoice_updating'
                },
                SUBLIST: {
                    CHARGES: {
                        ID:                 'recmachcustrecord_bb1_utilised_lease',
                        UTIL_DATE:          'custrecord_bb1_utilised_date',
                        FX_CHRG_TYE:        'custrecord_bb1_utilised_fixed_charges',
                        DESC:               'custrecord_bb1_utilised_description',
                        RATE_EX_VAT:        'custrecord_bb1_utilised_rate_ex_vat',
                        TYPE:               'custrecord_bb1_utilised_type',
                        ITEM:               'custrecord_bb1_utlised_item',
                        STATUS:             'custrecord_bb1_utilised_status',
                        INVOICE:            'custrecord_bb1_utilised_invoice',
                        DISCOUNT_AMOUNT:    'custrecord_bb1_utilised_discount_amount'
                    }
                }
            },
            INVOICE: {
                HEADER: {
                },
                SUBLIST: {
                    ITEMS: {
                        ID: 'item',
                        ITEM: 'item',
                        DESCRIPTION: 'description',
                        QUANTITY: 'quantity',
                        RATE: 'rate',
                        AMOUNT: 'amount',
                        PRICE_LEVEL: 'price',
                        UTIL_CHRG_REC: 'custcol_bb1_qpg_cntr_inv_chrg_rec'
                    }
                }
            }
        }

        const LIB_FX= {};

        //search call optimization
        const _searchDefCache = {};
        const getSearchDefinition = (idSavedSearch) => {
            if(!_searchDefCache[idSavedSearch]){
                let dataSearch = search.load({id: idSavedSearch});
                _searchDefCache[idSavedSearch] = {
                    type: dataSearch.searchType,
                    columns: dataSearch.columns,
                    filterExpression: dataSearch.filterExpression
                };
            }

            return _searchDefCache[idSavedSearch];
        }

        LIB_FX.searchData = (idSavedSearch, searchType, periodDate, idBuilding, idContract) => {
            log.debug('_searchData function');
            let searchDef = getSearchDefinition(idSavedSearch);
            let dataSearch = search.create({
                type: searchDef.type,
                columns: searchDef.columns
            });

            //shallow copy so this call's pushes build onto its own array, never mutating the cached base filters
            //shared by every other call against this same saved search
            let filterExpr = searchDef.filterExpression.slice();

            //fixedChrg: start date is within this month, or started earlier but still open/ongoing
            const buildFixedChrgFilter = (date, strDate, strMonthStart, strEndDate) => [
                [
                    ['custrecord_bb1_fixed_start_dated', 'onorafter', strMonthStart],
                    'and',
                    ['custrecord_bb1_fixed_start_dated', 'onorbefore', strEndDate],
                    'and',
                    [
                        ['custrecord_bb1_fixed_end_date', 'isempty', ''],
                        'or',
                        ['custrecord_bb1_fixed_end_date', 'onorafter', strEndDate]
                    ]
                ],
                'or',
                [
                    ['custrecord_bb1_fixed_start_dated', 'before', strMonthStart],
                    'and',
                    ['custrecord_bb1_fixed_end_date', 'after', strEndDate]
                ],
                'or',
                [
                    ['custrecord_bb1_fixed_start_dated', 'onorbefore', strDate],
                    'and',
                    ['custrecord_bb1_fixed_end_date', 'isempty', '']
                ]
            ];

            //utilChrg: utilised charge date falls within the same month and year as the given date (for fixed charges)
            const buildUtilChrgFilter = (strMonthStart, strEndDate) => [
                ['custrecord_bb1_utilised_date', 'onorafter', strMonthStart],
                'and',
                ['custrecord_bb1_utilised_date', 'onorbefore', strEndDate],
                'and',
                ['custrecord_bb1_utilised_lease', 'anyof', idContract]
            ];

            const buildEndDateFilter = (date) => {
                let strDate = format.format({value: date, type: format.Type.DATE});
                let monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
                let monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
                let today = new Date();

                //date structuring for different utitily charge searches
                let targetsOtherMonth = searchType === 'utilChrgInv' && (date.getFullYear() !== today.getFullYear() || date.getMonth() !== today.getMonth());
                let endDate = (searchType === 'utilChrgPeriod' || targetsOtherMonth) ? monthEnd : today;
                let strMonthStart = format.format({value: monthStart, type: format.Type.DATE});
                let strEndDate = format.format({value: endDate, type: format.Type.DATE});

                return (searchType === 'utilChrg' || searchType === 'utilChrgUE' || searchType === 'utilChrgInv' || searchType === 'utilChrgPeriod')
                    ? buildUtilChrgFilter(strMonthStart, strEndDate)
                    : buildFixedChrgFilter(date, strDate, strMonthStart, strEndDate);
            }

            if(searchType === 'fixedChrg' && periodDate){ //for fixed charges search
                filterExpr.push('and', buildEndDateFilter(periodDate));
            }

            if((searchType === 'utilChrg' || searchType === 'utilChrgUE' || searchType === 'utilChrgInv' || searchType === 'utilChrgPeriod') && periodDate){ //for utilisation charges search
                filterExpr.push('and', buildEndDateFilter(periodDate));

                if(searchType === 'utilChrg' || searchType === 'utilChrgInv'){ //exclude charges already linked to an invoice
                    filterExpr.push('and', [
                        ['custrecord_bb1_utilised_invoice', 'isempty', '']
                    ]);
                }
            }

            //utilChrgAll: every utilised charge for this contract, regardless of date or invoice status -
            //used to pull a contract's full uninvoiced set without needing a period bound
            if(searchType === 'utilChrgAll' && idContract){
                filterExpr.push('and', ['custrecord_bb1_utilised_lease', 'anyof', idContract]);
            }

            //additional criteria for fixed charges search
            if(idBuilding){ //used for scheduled run
                filterExpr.push('and', [
                    ['custrecord_bb1_fixed_building', 'anyof', idBuilding],
                    'and',
                    buildEndDateFilter(new Date())
                ]);
            }

            dataSearch.filterExpression = filterExpr;

            let results = [];
            let count = 0;
            let pageSize = 1000;
            let start = 0;

            do {
                let subresults = dataSearch.run().getRange({
                    start: start,
                    end: start + pageSize
                });

                results = results.concat(subresults);
                count = subresults.length;
                start += pageSize;
            } while (count === pageSize);

            log.debug('results length: ', results.length);

            return results;

        }

        /**
         * adds charge lines in contract record
         */

        //extracts the internal id from a list/record search result field, e.g. [{value, text}]
        LIB_FX.getListValue = (fieldValue) => (fieldValue && fieldValue.length > 0) ? fieldValue[0].value : '';

        //extracts the display text from a list/record search result field, e.g. [{value, text}]
        LIB_FX.getListText = (fieldValue) => (fieldValue && fieldValue.length > 0) ? fieldValue[0].text : '';

        //static values for rent and parking
        //skipFixedCharges is set to true for parking to limit charges from being added in this contract record
        const STATIC_CHARGE_CONFIG = {
            RENT: {type: 3, skipFixedCharges: false},    //rent - fixed charges still apply
            PARKING: {type: 5, skipFixedCharges: true}   //parking - fixed charges excluded
        };

        LIB_FX.addChargeLines = (idContract, fixedCharges, contractValues, isManualRun, periodDate, idUtChargeSea) => {
            //values sourced from the contract's search row (moved here from the mr script's reduce stage)
            let idLeaseType = LIB_FX.getListValue(contractValues.custrecord_bb1_lease_type);
            let rentAmount = parseFloat(contractValues.custrecord_bb1_lease_rent) || 0;
            let isMonthtoMonth = contractValues.custrecord_bb1_lease_monthtomonth;
            let rentEscalation = contractValues.custrecord_bb1_lease_rent_escalation;
            let rentItem = LIB_FX.getListValue(contractValues.custrecord_bb1_lease_item);
            let rentItemText = LIB_FX.getListText(contractValues.custrecord_bb1_lease_item);

            let contractRec = record.load({
                type: _CONFIG.CONTRACT.REC_ID,
                id: idContract,
                isDynamic: true
            })

            let chargeFields = _FIELDS.CONTRACT.SUBLIST.CHARGES;
            let sublistId = chargeFields.ID;

            //selects a new line on the charges sublist, sets every field passed in, then commits it
            let addLine = (values) => {
                contractRec.selectNewLine(sublistId);
                Object.keys(values).forEach((fieldId) => contractRec.setCurrentSublistValue(sublistId, fieldId, values[fieldId]));
                contractRec.commitLine(sublistId);
            }

            //search for all charges for this period, regardless of invoice status
            let periodCharges = LIB_FX.searchData(idUtChargeSea, 'utilChrgPeriod', periodDate, '', idContract);

            //fixed charges already utilised this period, keyed by the fixed charge's own internal id (FX_CHRG_TYE)
            let existingFixedChargeIds = new Set(
                periodCharges.map((entry) => entry.getValue({name: chargeFields.FX_CHRG_TYE})).filter(Boolean).map(String)
            );

            //items already utilised this period - used below to guard the static Rent/Parking charge line
            let existingItems = new Set(
                periodCharges.map((entry) => entry.getValue({name: chargeFields.ITEM})).filter(Boolean).map(String)
            );

            //use the period date in the manual deployment for the utilisation date - periodDate comes from a
            let utilDate = isManualRun ? format.parse({value: periodDate, type: format.Type.DATE}) : new Date();


            let staticConfig = String(idLeaseType) === '2' ? STATIC_CHARGE_CONFIG.PARKING : STATIC_CHARGE_CONFIG.RENT;
            let staticCharge = rentItem ? {
                desc: rentItemText,
                item: rentItem,
                type: staticConfig.type,
                skipFixedCharges: staticConfig.skipFixedCharges
            } : null;

            //sking adding charge lines if contract type = parking
            if(!staticCharge || !staticCharge.skipFixedCharges){
                for(let i = 0; i < fixedCharges.length; i++){
                    let charge = fixedCharges[i];

                    //skip charges that are already utilised for this period
                    if(existingFixedChargeIds.has(String(charge.id))){
                        continue;
                    }

                    addLine({
                        [chargeFields.FX_CHRG_TYE]: charge.id,
                        [chargeFields.DESC]: charge.getValue({name: 'name'}),
                        [chargeFields.RATE_EX_VAT]: charge.getValue({name: 'custrecord_bb1_fixed_rate'}),
                        [chargeFields.UTIL_DATE]: utilDate,
                        [chargeFields.TYPE]: 1, //type = fixed charge
                        [chargeFields.ITEM]: charge.getValue({name: 'custrecord_bb1_fixed_item'})
                    });
                }
            }

            //check if rent/parking static charge already exists in the current period
            let staticChargeExists = staticCharge && existingItems.has(String(staticCharge.item));

            //retrieve escalation rate and get the for computation value
            let escalationRate = parseFloat(String(rentEscalation || '0').replace('%', '')) / 100;

            //month-to-month leases add the escalation percentage on top of the base rent; fixed-term leases don't
            let escalatedRentAmount = isMonthtoMonth ? rentAmount + (rentAmount * escalationRate) : rentAmount;

            if(staticCharge && !staticChargeExists){
                addLine({
                    [chargeFields.DESC]: rentItemText,
                    [chargeFields.ITEM]: rentItem,
                    [chargeFields.RATE_EX_VAT]: escalatedRentAmount,
                    [chargeFields.UTIL_DATE]: utilDate,
                    [chargeFields.TYPE]: staticCharge.type
                });
            }

            contractRec.save();
            log.debug('saved contract record: ' + idContract);
        }

        /**
         * adds one invoice line per utilised charge on the contract, plus a discount line where applicable.
         * Rent/Parking charges (type 3/5) are skipped entirely for the main line - they already come over
         * as the SO's own line via the transform, which is also what keeps this invoice showing under the
         * SO's Related Records. Their discount line still gets added here though, since the SO's line never
         * carries a discount amount. Every other charge type gets its own fresh line as normal.
         */
        const addChargeLinesToInvoice = (invoiceRec, sublistId, utilChargeList) => {
            let itemFields = _FIELDS.INVOICE.SUBLIST.ITEMS;
            let chargeFields = _FIELDS.CONTRACT.SUBLIST.CHARGES;

            for(let i = 0; utilChargeList && i < utilChargeList.length; i++){
                let charge = utilChargeList[i];
                let description = charge.getValue({name: chargeFields.DESC});
                let chargeType = charge.getValue({name: chargeFields.TYPE});
                let isStaticCharge = String(chargeType) === '3' || String(chargeType) === '5'; // Rent = 3, Parking = 5

                if(!isStaticCharge){
                    invoiceRec.selectNewLine({sublistId: sublistId});
                    invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: itemFields.ITEM, value: charge.getValue({name: chargeFields.ITEM})});
                    invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: itemFields.DESCRIPTION, value: description});
                    invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: itemFields.QUANTITY, value: 1});
                    invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: itemFields.PRICE_LEVEL, value: -1}); //Custom Price Level
                    invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: itemFields.RATE, value: charge.getValue({name: chargeFields.RATE_EX_VAT})});
                    invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: itemFields.UTIL_CHRG_REC, value: charge.id}); //links this invoice line back to the utilised charge it was billed from
                    invoiceRec.commitLine({sublistId: sublistId});
                }

                //if current charge has discount amount, add discount line after it - still needed for
                //Rent/Parking even though their main line is skipped, since the SO carries no discount
                let discountAmount = charge.getValue({name: chargeFields.DISCOUNT_AMOUNT});
                if(discountAmount){
                    invoiceRec.selectNewLine({sublistId: sublistId});
                    invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: itemFields.ITEM, value: '22'}); //discount item
                    invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: itemFields.DESCRIPTION, value: description}); //description = charge line description where discount is applied
                    invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: itemFields.QUANTITY, value: 1});
                    invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: itemFields.PRICE_LEVEL, value: -1}); //Custom Price Level
                    invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: itemFields.AMOUNT, value: -parseFloat(discountAmount)});
                    invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: itemFields.UTIL_CHRG_REC, value: charge.id}); //same charge as the line it's discounting
                    invoiceRec.commitLine({sublistId: sublistId});
                }
            }
        }

        /**
         * transforms the linked SO in the contract to an invoice - the SO's own Rent/Parking lines are kept
         * as-is (addChargeLinesToInvoice skips them for the main line, only adding their discount line if
         * any) so the invoice still carries the transform's order-linkage back to the SO; every other
         * charge is added fresh
         */
        LIB_FX.createInvoice = (idSalesOrder, utilChargeList) => {
            let invoiceRec = record.transform({
                fromType: record.Type.SALES_ORDER,
                fromId: idSalesOrder,
                toType: record.Type.INVOICE,
                isDynamic: true
            });

            let sublistId = _FIELDS.INVOICE.SUBLIST.ITEMS.ID;

            //force quantity = 1 on the Rent/Parking line(s) carried over from the SO - everything else about
            //them (item, rate, amount) is left exactly as the SO had it
            let existingLineCount = invoiceRec.getLineCount({sublistId: sublistId});
            for(let line = 0; line < existingLineCount; line++){
                invoiceRec.selectLine({sublistId: sublistId, line: line});
                invoiceRec.setCurrentSublistValue({sublistId: sublistId, fieldId: _FIELDS.INVOICE.SUBLIST.ITEMS.QUANTITY, value: 1});
                invoiceRec.commitLine({sublistId: sublistId});
            }

            addChargeLinesToInvoice(invoiceRec, sublistId, utilChargeList);

            let idInvoice = invoiceRec.save();
            log.debug('createInvoice', 'Invoice ' + idInvoice + ' created from Sales Order ' + idSalesOrder);

            LIB_FX.updateUtilisedCharges(utilChargeList, idInvoice);

            return idInvoice;
        }

        /**
         * marks each utilised charge as invoiced (status = 2) and links it to the resulting invoice
         */
        LIB_FX.updateUtilisedCharges = (utilChargeList, idInvoice) => {
            let chargeFields = _FIELDS.CONTRACT.SUBLIST.CHARGES;

            for(let i = 0; utilChargeList && i < utilChargeList.length; i++){
                let charge = utilChargeList[i];

                record.submitFields({
                    type: _CONFIG.UTILISED_CHARGE.REC_ID,
                    id: charge.id,
                    values: {
                        [chargeFields.STATUS]: 2,
                        [chargeFields.INVOICE]: idInvoice
                    },
                    //neither field triggers dependent/sourced values on this record, so skip that server-side
                    //work on every one of these calls - meaningful at 1000+ charges per run
                    options: {
                        enableSourcing: false,
                        ignoreMandatoryFields: true
                    }
                });
            }

            log.debug('updateUtilisedCharges', 'Updated ' + (utilChargeList ? utilChargeList.length : 0) + ' utilised charge(s) with invoice ' + idInvoice);
        }

        /**
         * attaches a sibling contract's utilised charges (e.g. a parking contract's) as new lines onto an
         * invoice already resolved for the group - used when rent and parking contracts share one Sales
         * Order and therefore must land on the same invoice, but only one of them actually creates it
         */
        LIB_FX.addChargesToInvoice = (idInvoice, utilChargeList) => {
            if(!utilChargeList || !utilChargeList.length){
                return;
            }

            let sublistId = _FIELDS.INVOICE.SUBLIST.ITEMS.ID;
            let invoiceRec = record.load({
                type: record.Type.INVOICE,
                id: idInvoice,
                isDynamic: true
            });

            //guard against duplicate lines on a rerun of the same charges
            let existingChargeIds = LIB_FX.getExistingChargeIds(invoiceRec, sublistId);
            let newCharges = utilChargeList.filter((charge) => !existingChargeIds.has(String(charge.id)));

            if(newCharges.length){
                addChargeLinesToInvoice(invoiceRec, sublistId, newCharges);
                invoiceRec.save();
                log.debug('addChargesToInvoice', 'Invoice ' + idInvoice + ' updated with ' + newCharges.length + ' new charge line(s)');
            }

            //re-link the full group, including any duplicates - self-heals any charge whose own invoice
            //field never got set despite already having a line on this invoice
            LIB_FX.updateUtilisedCharges(utilChargeList, idInvoice);
        }

        /**
         * to check if there are new utilised charges
         */
        LIB_FX.hasNewUtilisedCharges = (oldContractRec, newContractRec) => {
            let sublistId = _FIELDS.CONTRACT.SUBLIST.CHARGES.ID;
            return newContractRec.getLineCount({sublistId: sublistId}) > oldContractRec.getLineCount({sublistId: sublistId});
        }

        /**
         * set the flag for updating of invoice on save
         */
        LIB_FX.flagContractUpdating = (contractRec) => {
            contractRec.setValue({fieldId: _FIELDS.CONTRACT.HEADER.IS_UPDATING, value: true});
        }

        /**
         * true if this contract record is currently flagged as having an update MR in flight
         */
        LIB_FX.isContractUpdating = (contractRec) => {
            return contractRec.getValue({fieldId: _FIELDS.CONTRACT.HEADER.IS_UPDATING});
        }

        /**
         * update the flag for the UI invoice update script to false when MR finishes its execution
         */
        LIB_FX.clearContractUpdating = (idContract) => {
            record.submitFields({
                type: _CONFIG.CONTRACT.REC_ID,
                id: idContract,
                values: {[_FIELDS.CONTRACT.HEADER.IS_UPDATING]: false}
            });
        }

        /**
         * returns charges without invoices linked to it
         */
        LIB_FX.checkUtilisedCharges = (utilChargeList, idContract) => {
            let chargeFields = _FIELDS.CONTRACT.SUBLIST.CHARGES;
            let uninvoicedCharges = (utilChargeList || []).filter((charge) => !charge.getValue({name: chargeFields.INVOICE}));

            log.debug('checkUtilisedCharges', 'Contract ' + idContract + ' has ' + uninvoicedCharges.length + ' utilised charge(s) with no invoice linked');

            return uninvoicedCharges;
        }

        /**
         * groups charges based on period (month/year)
         */
        const getPeriodKey = (charge) => {
            let chargeFields = _FIELDS.CONTRACT.SUBLIST.CHARGES;
            let chargeDate = format.parse({value: charge.getValue({name: chargeFields.UTIL_DATE}), type: format.Type.DATE});
            return chargeDate.getFullYear() + '-' + (chargeDate.getMonth() + 1); //+1: getMonth() is zero-indexed, this key is only ever for logging/grouping
        }

        /**
         * groups the charges based on period (same month)
         */
        LIB_FX.groupChargesByPeriod = (charges) => {
            let chargesByPeriod = {};
            (charges || []).forEach((charge) => {
                let period = getPeriodKey(charge);
                chargesByPeriod[period] = chargesByPeriod[period] || [];
                chargesByPeriod[period].push(charge);
            });

            return chargesByPeriod;
        }

        /**
         * runs an invoice search where an existing charge line is linked to
         * returns the invoice id
         */
        LIB_FX.findInvoiceForCharges = (chargeIds) => {
            if(!chargeIds || !chargeIds.length){
                return '';
            }

            let itemFields = _FIELDS.INVOICE.SUBLIST.ITEMS;
            let invoiceSearch = search.create({
                type: search.Type.INVOICE,
                filters: [[itemFields.UTIL_CHRG_REC, 'anyof', chargeIds]],
                columns: ['internalid']
            });

            let result = invoiceSearch.run().getRange({start: 0, end: 1});
            return (result && result.length) ? result[0].getValue({name: 'internalid'}) : '';
        }

        /**
         * finds the invoice already linked to a contract charge line for a given period
         */
        LIB_FX.findInvoiceForPeriod = (idContract, periodDate, idUtChargeSea) => {
            let periodCharges = LIB_FX.searchData(idUtChargeSea, 'utilChrgPeriod', periodDate, '', idContract);
            let chargeIds = periodCharges.map((charge) => charge.id);

            return LIB_FX.findInvoiceForCharges(chargeIds);
        }

        /**
         * handles the processing of uninvoiced charges triggered from the MR script called by the UE script
         */
        LIB_FX.processUninvoicedCharges = (uninvoicedCharges, idContract, idUtChargeSea) => {
            let chargeFields = _FIELDS.CONTRACT.SUBLIST.CHARGES;

            if(!uninvoicedCharges || !uninvoicedCharges.length){
                log.debug('processUninvoicedCharges', 'Contract ' + idContract + ' has no uninvoiced utilised charges to process');
                return;
            }

            let chargesByPeriod = LIB_FX.groupChargesByPeriod(uninvoicedCharges);

            //for each period's group of new charges, find that period's existing invoice and add the new lines to it
            Object.keys(chargesByPeriod).forEach((period) => {
                let periodCharges = chargesByPeriod[period];
                let periodDate = format.parse({value: periodCharges[0].getValue({name: chargeFields.UTIL_DATE}), type: format.Type.DATE});
                let idInvoice = LIB_FX.findInvoiceForPeriod(idContract, periodDate, idUtChargeSea);

                if(!idInvoice){
                    log.debug('processUninvoicedCharges', 'No existing invoice found for period ' + period + ' on contract ' + idContract);
                    return;
                }

                let invoiceRec = record.load({
                    type: record.Type.INVOICE,
                    id: idInvoice,
                    isDynamic: true
                });

                addChargeLinesToInvoice(invoiceRec, _FIELDS.INVOICE.SUBLIST.ITEMS.ID, periodCharges);
                invoiceRec.save();
                log.debug('processUninvoicedCharges', 'Invoice ' + idInvoice + ' updated with ' + periodCharges.length + ' new charge line(s) for period ' + period);

                LIB_FX.updateUtilisedCharges(periodCharges, idInvoice);
            });
        }
        /**
         * this checks if existing charges are found in the invoice to avoid duplicate
         */
        LIB_FX.getExistingChargeIds = (invoiceRec, sublistId) => {
            let itemFields = _FIELDS.INVOICE.SUBLIST.ITEMS;
            let existingIds = new Set();
            let lineCount = invoiceRec.getLineCount({sublistId: sublistId});

            for(let line = 0; line < lineCount; line++){
                let chargeId = invoiceRec.getSublistValue({sublistId: sublistId, fieldId: itemFields.UTIL_CHRG_REC, line: line});
                if(chargeId){
                    existingIds.add(String(chargeId));
                }
            }

            return existingIds;
        }

        /**
         * for monthly invoice run which groups contract's under the same period
         * check if group has an invoice to determine a new one must be created or an update must be made
         *
         * takes the FULL set of this contract's period charges (invoiced and uninvoiced alike), already
         * fetched once by the caller, so the existing-invoice lookup can run off data already in hand
         * instead of re-querying utilised charges a second time just to check for a prior invoice link
         */
        LIB_FX.createOrUpdateInvoice = (idSalesOrder, periodCharges, idContract) => {
            if(!periodCharges || !periodCharges.length){
                return '';
            }

            let chargesByPeriod = LIB_FX.groupChargesByPeriod(periodCharges);
            let idInvoice;

            Object.keys(chargesByPeriod).forEach((period) => {
                let allChargesForPeriod = chargesByPeriod[period];
                let uninvoicedCharges = LIB_FX.checkUtilisedCharges(allChargesForPeriod, idContract);

                if(!uninvoicedCharges.length){
                    return; //everything in this period is already invoiced - nothing new to add
                }

                //look for an existing invoice against the FULL period group (invoiced + uninvoiced), not just
                //the uninvoiced subset - self-heals any charge whose own invoice field never got set despite
                //already having a line on this invoice
                let chargeIds = allChargesForPeriod.map((charge) => charge.id);
                let idExistingInvoice = LIB_FX.findInvoiceForCharges(chargeIds);

                if(idExistingInvoice){
                    let sublistId = _FIELDS.INVOICE.SUBLIST.ITEMS.ID;
                    let invoiceRec = record.load({
                        type: record.Type.INVOICE,
                        id: idExistingInvoice,
                        isDynamic: true
                    });

                    //checks if charges exist in the invoice for a specific period
                    let existingChargeIds = LIB_FX.getExistingChargeIds(invoiceRec, sublistId);

                    //new charges to be added
                    let newCharges = uninvoicedCharges.filter((charge) => !existingChargeIds.has(String(charge.id)));
                    let duplicateCount = uninvoicedCharges.length - newCharges.length;

                    if(duplicateCount){
                        log.debug('createOrUpdateInvoice', duplicateCount + ' of ' + uninvoicedCharges.length + ' charge(s) for period ' + period + ' on contract ' + idContract + ' already exist on invoice ' + idExistingInvoice + ' - skipping duplicate line(s)');
                    }

                    //add only new charges in the invoice
                    if(newCharges.length){
                        addChargeLinesToInvoice(invoiceRec, sublistId, newCharges);
                        invoiceRec.save();
                        log.debug('createOrUpdateInvoice', 'Invoice ' + idExistingInvoice + ' already existed for period ' + period + ' on contract ' + idContract + ' - added ' + newCharges.length + ' new charge line(s) instead of creating a new invoice');
                    }

                    //re-link the full uninvoiced group, including the duplicates - self-heals any charge whose
                    //own invoice field never got set despite already having a line on this invoice
                    LIB_FX.updateUtilisedCharges(uninvoicedCharges, idExistingInvoice);
                    idInvoice = idExistingInvoice;
                } else {
                    idInvoice = LIB_FX.createInvoice(idSalesOrder, uninvoicedCharges);
                }
            });

            return idInvoice;
        }

        return {LIB_FX, _CONFIG};
    });
