/**
 * Project: J&K Ross - IF Changes
 *
 * Teamwork task: P102821
 *
 * Renders the Item Fulfillment's shipping label (bb1_jkr_if_mailing_label_pdf.xml) -
 * one 7.6cm x 7.6cm label per box (Boxes, custbody_bb1_boxes) showing the ship-to
 * attention, the full ship address and the IF number as text and barcode - and returns
 * it inline so it opens in the browser window
 *
 * Called By: bb1_jkr_if_mandfields_cs.js (Print Label button)
 *
 * Date                Author              Purpose
 * 13-October-2026     Jared Espineli      Initial Release
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/render', 'N/record', 'N/error'],

    function (render, record, error) {

        //request parameters - must match bb1_jkr_if_mandfields_cs.js
        var REQUEST_PARAM_IF_ID = 'custscript_bb1_jkr_if_print_label_id_su';
        var REQUEST_PARAM_TEMPLATE_ID = 'custscript_bb1_jkr_if_print_label_tmpl_su';

        //alias the label template reads its data from
        var LABEL_DATA_ALIAS = 'labeldata';

        var FIELD = {
            TRANID: 'tranid',
            BOXES: 'custbody_bb1_boxes',
            SHIP_ADDRESS: 'shippingaddress',
            SHIP_ADDRESS_TEXT: 'shipaddress'
        };

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
            var ifId = request.parameters[REQUEST_PARAM_IF_ID];
            var templateId = request.parameters[REQUEST_PARAM_TEMPLATE_ID];

            log.debug('Print Label requested', {ifId: ifId, templateId: templateId});

            if (!/^\d+$/.test(ifId || '') || !/^\d+$/.test(templateId || '')) {
                throw error.create({
                    name: 'BB1_IF_PRINT_LABEL_INVALID_REQUEST',
                    message: 'Print Label needs a valid Item Fulfillment id and label template id.'
                });
            }

            var step = 'record.load';

            try {
                var ifRecord = record.load({
                    type: record.Type.ITEM_FULFILLMENT,
                    id: ifId
                });

                step = 'buildLabelData';
                var labelData = buildLabelData(ifRecord);

                log.debug('Print Label data', labelData);

                var renderer = render.create();

                step = 'setTemplateById';
                renderer.setTemplateById({id: Number(templateId)});

                step = 'addCustomDataSource labeldata';
                renderer.addCustomDataSource({
                    format: render.DataSource.OBJECT,
                    alias: LABEL_DATA_ALIAS,
                    data: labelData
                });

                step = 'renderAsPdf';
                var pdfFile;

                try {
                    pdfFile = renderer.renderAsPdf();
                } catch (renderError) {
                    logTemplateError(renderer);
                    throw renderError;
                }

                pdfFile.name = 'Label_' + (ifRecord.getValue({fieldId: FIELD.TRANID}) || ifId) + '.pdf';

                step = 'writeFile';
                scriptContext.response.writeFile({file: pdfFile, isInline: true});
            } catch (e) {
                log.error('Print Label failed at ' + step, {name: e.name, message: e.message, id: e.id, stack: e.stack});
                throw error.create({
                    name: 'BB1_IF_PRINT_LABEL_FAILED',
                    message: 'Could not render the label for Item Fulfillment ' + ifId + ' (' + step + '): ' + e.message
                });
            }
        }

        //-----------------------------------------------
        //{attention, shipaddress, tranid, boxes} - flat strings only (arrays in custom
        //data sources fail in renderAsPdf). Text is upper-cased and XML-escaped here as
        //the template prints it as-is (auto_esc=false)
        //-----------------------------------------------
        function buildLabelData(ifRecord) {
            var address = ifRecord.getSubrecord({fieldId: FIELD.SHIP_ADDRESS});
            var attention = address ? String(address.getValue({fieldId: 'attention'}) || '').trim() : '';

            //full formatted ship address, as shown on the Item Fulfillment
            var shipAddress = String(ifRecord.getValue({fieldId: FIELD.SHIP_ADDRESS_TEXT}) || '');

            var boxes = parseInt(ifRecord.getValue({fieldId: FIELD.BOXES}), 10);

            return {
                attention: formatText(attention),
                shipaddress: formatText(shipAddress).replace(/\r?\n/g, '<br />'),
                tranid: formatText(ifRecord.getValue({fieldId: FIELD.TRANID})),
                boxes: String(boxes > 0 ? boxes : 1)
            };
        }

        //renderAsPdf only reports "unexpected error" - rendering as a string surfaces the
        //underlying FreeMarker error, or the generated XML if the template itself ran fine
        function logTemplateError(renderer) {
            try {
                var xml = renderer.renderAsString();
                log.error('Print Label template output (XML/BFO issue)', xml.substring(0, 3900));
            } catch (e) {
                log.error('Print Label template error', {name: e.name, message: e.message});
            }
        }

        function formatText(value) {
            return String(value || '')
                .toUpperCase()
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        }

        return {
            onRequest: onRequest
        };

    });
