/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Server-only helper library that builds the Tenancy Schedule PDF.
 *
 * Date        	  Author		        Purpose
 * 08/21/2026     Jared Espineli        Initial version - header/logo/column
 *                                      scaffold, no data sourcing yet
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/render', './bb1_qpg_tschd_report_lib_helper'],
    /**
     * @param{render} render
     * @param{helperLib} helperLib
     */
    (render, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        const LOGO_URL = 'https://11536405.app.netsuite.com/core/media/media.nl?id=4007&c=11536405&h=vMOQpihs6u5R5MQswLAA1sZ5a8h-LvBnXfGPuCx39bSKx6gU';

        // Column headers, left to right - mirrors the reference PDF's layout.
        const COLUMNS = [
            'Premises', 'Area', 'Units / Parking', 'Tenant', 'Starts', 'Expires',
            'Review', 'Months Option', 'Current Rent', 'Rent Rate', 'Rent Esc%',
            'Other Chargings', 'Description', 'Amount', 'Rate', 'Gross Income',
            'Gross Rate', 'Market Rate', 'Market Esc%'
        ];

        const MONTH_NAMES = [
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ];

        const LIB_FX = {};

        const pad2 = (n) => String(n).padStart(2, '0');

        //formatting of As of Date value
        const formatAsOfDate = (date) =>
            `${pad2(date.getDate())} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;

        //formatting of the printed date time value
        const formatPrintedTimestamp = (date) => {
            const datePart = `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
            const timePart = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
            return `${datePart} ${timePart}`;
        }

        const escapeXml = (value) => String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

        const buildHeaderMacro = (asOfDate) => {
            const logoCell = `<img src="${escapeXml(LOGO_URL)}" alt="Company Logo" style="height: 70pt; width: 200pt;" />`;
            const printedText = escapeXml(formatPrintedTimestamp(new Date()));
            const asOfDateText = escapeXml(formatAsOfDate(asOfDate));

            return `
                <macro id="header">
                    <table style="width: 100%; border: 0;">
                        <tr>
                            <td style="width: 30%; vertical-align: middle; border: none;">${logoCell}</td>
                            <td style="width: 40%; vertical-align: middle; border: none;">
                                <table style="width: 100%; border: 0;">
                                    <tr>
                                        <td align="center" style="text-align: center; border: none;">
                                            <span style="font-size: 16pt; font-weight: bold;">Tenancy Schedule</span>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td align="center" style="text-align: center; border: none;">
                                            <span style="font-size: 9pt; font-weight: normal;">as of ${asOfDateText}</span>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                            <td style="width: 30%; text-align: right; vertical-align: middle; font-size: 8pt; border: none;">
                                Printed: ${printedText}<br/>
                                Page: <pagenumber/>
                            </td>
                        </tr>
                    </table>
                </macro>
            `;
        }

        const buildColumnHeaderRow = () => {
            return COLUMNS.map((label) => `<th align="left">${label}</th>`).join('');
        }

        const buildPropertyRow = () => {
            const remainingColumns = COLUMNS.length - 4;
            return `
                <td colspan="5">Property</td>
                <td colspan="${remainingColumns}" style="border: none;"></td>
            `;
        }

        LIB_FX.buildPdf = (params) => {
            const asOfDateParam = params && params[_FIELDS.FORM.AS_OF_DATE];
            const parsedAsOfDate = asOfDateParam ? new Date(asOfDateParam) : null;
            const asOfDate = (parsedAsOfDate && !isNaN(parsedAsOfDate.getTime())) ? parsedAsOfDate : new Date();

            const xml = `
                <?xml version="1.0"?>
                <!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
                <pdf>
                    <head>
                        <macrolist>
                            ${buildHeaderMacro(asOfDate)}
                        </macrolist>
                        <style>
                            * { font-family: Arial, Helvetica, sans-serif; }
                            table.tschd-table { font-size: 6pt; width: 100%; border-collapse: collapse; }
                            table.tschd-table th {
                                background-color: #FFF9C4;
                                color: #000000;
                                font-weight: bold;
                                padding: 3pt;
                                border: 1pt solid #000000;
                                text-align: right;
                            }
                            table.tschd-table td {
                                padding: 3pt;
                                border: 1pt solid #666666;
                            }
                        </style>
                    </head>
                    <body header="header" header-height="70pt" size="A4-landscape" padding="0.4in 0.3in 0.4in 0.3in">
                        <table class="tschd-table">
                            <tr>${buildPropertyRow()}</tr>
                            <tr>${buildColumnHeaderRow()}</tr>
                            <tr>
                                <td colspan="${COLUMNS.length}" style="text-align: center; font-style: italic; color: #666666;">                                    
                                </td>
                            </tr>
                        </table>
                    </body>
                </pdf>
            `;

            // The <?xml ?> declaration must be the very first characters in the
            // string - the template literal's leading newline/indentation would
            // otherwise make the parser reject it.
            return render.xmlToPdf({xmlString: xml.trim()});
        }

        return {LIB_FX};
    });