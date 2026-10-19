/**
 * Date              Author		     Purpose
 * 25-February-2026  Laurine Jacobs  JotForm Integration
 * 15-October-2026   Rhys Gottwald   Code cleanup and formatting.
 *
 * Copyright (c) 2026 Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.x
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */

define(['N/ui/serverWidget', 'N/record', 'N/log', 'N/https', 'N/file', 'N/search', 'N/encode'],
    function (ui, record, log, https, file, search, encode) {

        function onRequest(context) {
            try {

                log.debug('Request', context.request);
                var data = context.request.parameters.rawRequest;

                if (context.request.method === 'POST') {

                    var payload = JSON.parse(data);

                    log.debug("Jotform Payload", payload);

                    var barcodeA = payload.q14_typeA || "";
                    var barcodeB = payload.q22_scan || "";
                    var barcodeC = payload.q23_scan23 || "";
                    var user = payload.q13_fullName || "";
                    var ifNum = payload.q33_typeA33 || "";
                    var signatureUrl = payload.q35_signature || "";
                    // var userNum = payload.q13_phoneNumber || "";

                    log.debug("Mapped Fields", "User=" + user + ", IF#=" + ifNum + ", Barcodes= " + barcodeA + barcodeB + barcodeC);

                    var barcodes = [];

                    if (barcodeA) {
                        barcodes.push(["createdfrom.numbertext", "is", barcodeA])
                    }
                    if (barcodeB) {
                        if (barcodes.length > 0) {
                            barcodes.push("OR")
                        }
                        barcodes.push(["createdfrom.numbertext", "is", barcodeB])
                    }
                    if (barcodeC) {
                        if (barcodes.length > 0) {
                            barcodes.push("OR")
                        }
                        barcodes.push(["createdfrom.numbertext", "is", barcodeC])
                    }

                    if (ifNum && barcodes.length !== 0) {
                        barcodes.push("OR")
                    }

                    log.debug('barcode array', barcodes);

                    var soArr = ifNum.trim().split(/\s+/);

                    log.debug('sales orders', soArr);

                    soArr.forEach(function (so, index) {
                        if (index > 0) {
                            barcodes.push("OR");
                        }
                        barcodes.push(["createdfrom.numbertext", "is", so])
                    });

                    log.debug('updated barcodes', barcodes)

                    // Search IFulfillment
                    var fulfillmentID;
                    var ifStatus;

                    if (barcodes.length > 0) {
                        var itemfulfillmentSearch = search.create({
                            type: "itemfulfillment",
                            filters: [
                                ["mainline", "is", "T"],
                                "AND",
                                barcodes
                            ],
                            columns: [
                                search.createColumn({ name: "internalid", label: "Internal ID" }),
                                search.createColumn({ name: "status", label: "Status" })
                            ]
                        });

                        log.audit('itemfulfillmentSearch', itemfulfillmentSearch.filters);

                        var searchResultCount = itemfulfillmentSearch.runPaged().count;
                        
                        log.debug("itemfulfillmentSearchObj result count", searchResultCount);

                        var fulfillments = [];

                        itemfulfillmentSearch.run().each(function (result) {
                            fulfillmentID = result.getValue('internalid');
                            ifStatus = result.getText('status');

                            fulfillments.push(fulfillmentID);

                            log.debug("IF ID", fulfillmentID);
                            log.debug("IF Status", ifStatus);
                            log.debug('fulfillments list', fulfillments);

                            return true;
                        });

                        //    Save signature into File Cabinet
                        var base64Part = signatureUrl.split(',')[1];
                        var fileObj = file.create({
                            name: "signature_" + fulfillments + ".png",
                            fileType: file.Type.PNGIMAGE,
                            contents: base64Part,
                            encoding: file.Encoding.BASE_64,
                            folder: 1515
                        });

                        var fileId = fileObj.save();

                        log.debug("Filed saved", fileId)

                        // Load existing IF

                        for (var i = 0; i < fulfillments.length; i++) {
                            var ifID = fulfillments[i];

                            record.submitFields({
                                type: record.Type.ITEM_FULFILLMENT,
                                id: ifID,
                                values: {
                                    custbody_bb1_signature_user: user,
                                    custbody_bb1_jotform_signature: fileId
                                },
                                options: {
                                    enableSourcing: false,
                                    ignoreMandatoryFields: true
                                }
                            });
                        }

                        // if (ifStatus !== 'Shipped'){
                        //     fulfillments.forEach(function(ifID){
                        //         record.submitFields({
                        //         type: record.Type.ITEM_FULFILLMENT,
                        //         id: fulfillments,
                        //         values: {
                        //             custbody_bb1_signature_user: user
                        //             shipstatus: "C" //,
                        //             custbody_bb1_user_num: userNum
                        //         },
                        //         options: {
                        //             enableSourcing: false,
                        //             ignoreMandatoryFields: true
                        //         }
                        //     );
                        // }
                        // }

                        // Respond back to Jotform
                        context.response.write(JSON.stringify({
                            success: true,
                            itemFulfillmentId: fulfillmentID,
                            fulfillmentNumber: ifNum
                        }));
                    }
                } else {
                    context.response.write("This Suitelet accepts POST requests from Jotform webhooks.");
                }
            } catch (e) {
                log.error("Error Updating Item Fulfillment", e.toString());
                context.response.write(JSON.stringify({ success: false, error: e.message }));
            }
        }
        return {
            onRequest: onRequest
        };
    });