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

                    var user = payload.q13_fullName || "";
                    var ifNum = payload.q50_deliveryNotes || "";
                    var signatureUrl = payload.q59_signature || "";

                    // Fallback: Jotform keys are q{id}_{uniqueName}, so locate the signature field by name if q59_signature is absent
                    if (!signatureUrl) {
                        Object.keys(payload).some(function (key) {
                            if (/^q\d+_.*signature/i.test(key) && payload[key]) {
                                log.debug("Signature key found", key);
                                signatureUrl = payload[key];
                                return true;
                            }
                            return false;
                        });
                    }
                    // var userNum = payload.q13_phoneNumber || "";
                    var deliveryLocation = payload.q51_dropOff || "";
                    var deliveryMetadata = payload.q44_metaData || "";
                    var driverName = payload.q60_driverName || "";
                    var interactionRating = parseInt(payload.q56_interactionRating, 10);

                    log.debug("Mapped Fields", "User=" + user + ", IF#=" + ifNum);

                    // IF document numbers are pipe-separated, e.g. "IF123|IF345|IF456"
                    var ifNumArr = ifNum.split('|')
                        .map(function (num) {
                            return num.trim();
                        });

                    // Number of boxes per IF = occurrence count of its document number in the delivery notes
                    var boxCounts = {};

                    ifNumArr.forEach(function (num) {
                        if (num) {
                            boxCounts[num] = (boxCounts[num] || 0) + 1;
                        }
                    });

                    var ifArr = Object.keys(boxCounts);

                    log.debug('item fulfillment numbers', ifArr);
                    log.debug('number of boxes per item fulfillment', boxCounts);

                    var ifFilters = [];

                    ifArr.forEach(function (num, index) {
                        if (index > 0) {
                            ifFilters.push("OR");
                        }
                        ifFilters.push(["tranid", "is", num]);
                    });

                    log.debug('item fulfillment filters', ifFilters);

                    // Search IFulfillment
                    var fulfillmentID;
                    var ifStatus;

                    if (ifFilters.length > 0) {
                        var itemfulfillmentSearch = search.create({
                            type: "itemfulfillment",
                            filters: [
                                ["mainline", "is", "T"],
                                "AND",
                                ["status", "anyof", "ItemShip:A"], // Picked only
                                "AND",
                                ifFilters
                            ],
                            columns: [
                                search.createColumn({ name: "internalid", label: "Internal ID" }),
                                search.createColumn({ name: "status", label: "Status" }),
                                search.createColumn({ name: "tranid", label: "Document Number" })
                            ]
                        });

                        log.audit('itemfulfillmentSearch', itemfulfillmentSearch.filters);

                        var searchResultCount = itemfulfillmentSearch.runPaged().count;
                        
                        log.debug("itemfulfillmentSearchObj result count", searchResultCount);

                        var fulfillments = [];
                        var ifStatuses = {};
                        var ifBoxCounts = {};
                        var pickedTranIds = {};

                        itemfulfillmentSearch.run().each(function (result) {
                            fulfillmentID = result.getValue('internalid');
                            ifStatus = result.getText('status');

                            fulfillments.push(fulfillmentID);
                            ifStatuses[fulfillmentID] = ifStatus;
                            ifBoxCounts[fulfillmentID] = boxCounts[result.getValue('tranid')] || 1;
                            pickedTranIds[result.getValue('tranid')] = true;

                            log.debug("IF ID", fulfillmentID);
                            log.debug("IF Status", ifStatus);
                            log.debug('fulfillments list', fulfillments);

                            return true;
                        });

                        // Log IFs that were skipped because they are not in Picked status
                        var skippedIfArr = ifArr.filter(function (num) {
                            return !pickedTranIds[num];
                        });

                        if (skippedIfArr.length > 0) {
                            var skippedFilters = [];

                            skippedIfArr.forEach(function (num, index) {
                                if (index > 0) {
                                    skippedFilters.push("OR");
                                }
                                skippedFilters.push(["tranid", "is", num]);
                            });

                            var shippedTranIds = {};

                            search.create({
                                type: "itemfulfillment",
                                filters: [
                                    ["mainline", "is", "T"],
                                    "AND",
                                    ["status", "anyof", "ItemShip:C"], // Shipped
                                    "AND",
                                    skippedFilters
                                ],
                                columns: [
                                    search.createColumn({ name: "internalid", label: "Internal ID" }),
                                    search.createColumn({ name: "tranid", label: "Document Number" })
                                ]
                            }).run().each(function (result) {
                                shippedTranIds[result.getValue('tranid')] = true;

                                log.audit("IF Skipped - Already Shipped", "IF# " + result.getValue('tranid') + " (ID " + result.getValue('internalid') + ")");

                                return true;
                            });

                            skippedIfArr.forEach(function (num) {
                                if (!shippedTranIds[num]) {
                                    log.audit("IF Skipped - Not Picked or Not Found", "IF# " + num);
                                }
                            });
                        }

                        if (fulfillments.length === 0) {
                            log.audit("No Picked Item Fulfillments", "Nothing to update for: " + ifNum);

                            context.response.write(JSON.stringify({
                                success: false,
                                error: "No Item Fulfillments in Picked status were found.",
                                fulfillmentNumber: ifNum,
                                skipped: skippedIfArr
                            }));
                            return;
                        }

                        //    Save signature into File Cabinet
                        log.debug("Signature value (first 100 chars)", String(signatureUrl).substring(0, 100));

                        var fileId = '';
                        var base64Part = String(signatureUrl).indexOf('base64,') !== -1 ? String(signatureUrl).split(',')[1] : '';

                        if (base64Part) {
                            try {
                                var fileObj = file.create({
                                    name: "signature_" + fulfillments.join('_') + "_" + new Date().getTime() + ".png",
                                    fileType: file.Type.PNGIMAGE,
                                    contents: base64Part,
                                    encoding: file.Encoding.BASE_64,
                                    folder: 1515
                                });

                                fileId = fileObj.save();

                                log.debug("File saved", fileId);
                            } catch (fileErr) {
                                log.error("Error Saving Signature File", fileErr.toString());
                            }
                        } else {
                            log.error("Signature Not Saved", "Signature is missing or not a base64 data URI: " + String(signatureUrl).substring(0, 100));
                        }

                        // Update signature on each IF, then mark it as Shipped
                        var shipErrors = [];

                        for (var i = 0; i < fulfillments.length; i++) {
                            var ifID = fulfillments[i];

                            var ifValues = {
                                custbody_bb1_signature_user: user,
                                custbody_bb1_delivery_location: deliveryLocation,
                                custbody_bb1_number_of_boxes: ifBoxCounts[ifID],
                                custbody_bb1_delivery_metadata: deliveryMetadata,
                                custbody_bb1_driver_name: driverName,
                                custbody_bb1_interaction_rating: isNaN(interactionRating) ? '' : interactionRating
                            };

                            // Only overwrite the signature when a new file was saved
                            if (fileId) {
                                ifValues.custbody_bb1_jotform_signature = fileId;
                            }

                            log.debug("Updating IF " + ifID, ifValues);

                            // Field update failure should not prevent shipping
                            try {
                                record.submitFields({
                                    type: record.Type.ITEM_FULFILLMENT,
                                    id: ifID,
                                    values: ifValues,
                                    options: {
                                        enableSourcing: false,
                                        ignoreMandatoryFields: true
                                    }
                                });

                                log.debug("IF Fields Updated", ifID);
                            } catch (updateErr) {
                                log.error("Error Updating Fields on Item Fulfillment " + ifID, updateErr.toString());
                                shipErrors.push({ itemFulfillmentId: ifID, error: updateErr.message });
                            }

                            log.debug("IF " + ifID + " status before shipping", ifStatuses[ifID]);

                            if (ifStatuses[ifID] !== 'Shipped') {
                                // Signature stays saved even if shipping fails
                                try {
                                    var ifRec = record.load({
                                        type: record.Type.ITEM_FULFILLMENT,
                                        id: ifID
                                    });

                                    log.debug("IF " + ifID + " shipstatus on load", ifRec.getValue({ fieldId: 'shipstatus' }));

                                    ifRec.setValue({ fieldId: 'shipstatus', value: 'C' });
                                    ifRec.save({
                                        enableSourcing: false,
                                        ignoreMandatoryFields: true
                                    });

                                    log.audit("IF Shipped", ifID);
                                } catch (shipErr) {
                                    log.error("Error Shipping Item Fulfillment " + ifID, shipErr.toString());
                                    shipErrors.push({ itemFulfillmentId: ifID, error: shipErr.message });
                                }
                            }
                        }

                        // Respond back to Jotform
                        context.response.write(JSON.stringify({
                            success: shipErrors.length === 0,
                            itemFulfillmentId: fulfillmentID,
                            fulfillmentNumber: ifNum,
                            skipped: skippedIfArr,
                            shipErrors: shipErrors
                        }));
                    } else {
                        context.response.write(JSON.stringify({
                            success: false,
                            error: "No Item Fulfillment numbers received."
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