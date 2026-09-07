/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Handles UI logic for the Generate Statement page - renders the form and,
 * when Generate Statement is clicked, queues the background PDF-generation
 * job (gts_mr.js, via gts_task_lib.js), showing a progress page that polls
 * until the PDF is ready and streams it (then deletes it - see the
 * DOWNLOAD_PDF branch below). Reached from the Customer Statement
 * Suitelet's Search Customer button, which carries over the Customer/
 * Category selection as request params.
 *
 * Date             Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release, passing request.parameters through to buildForm()
 *                                          so the carried-over Customer/Category filter reaches the Customer
 *                                          List sublist.
 * 03-September-2026    Jared Espineli      Added the print action (streams the merged statement PDF when
 *                                          Generate Statement's PRINT_PDF param is set) and confirmed the
 *                                          Customer List's page index passes through request.parameters
 *                                          unchanged.
 * 04-September-2026    Jared Espineli      Fixed Generate Statement crashing on a large selection by queuing a
 *                                          background gts_mr.js Map/Reduce job instead of streaming the PDF
 *                                          inline, and added the STATUS_CHECK/DOWNLOAD_PDF actions for the
 *                                          progress page to poll and then stream+delete the finished PDF.
 * 07-September-2026    Jared Espineli      Added the EMAIL_STATEMENT action, queuing gts_email_mr.js the same
 *                                          way PRINT_PDF queues gts_mr.js - reuses STATUS_CHECK to poll, but has
 *                                          no download step of its own since nothing is streamed back.
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/file', 'N/log', './bb1_qpg_cstmt_gts_form_lib', './bb1_qpg_cstmt_gts_task_lib', './bb1_qpg_cstmt_gts_lib_helper'],
    /**
     * @param{file} file
     * @param{log} log
     * @param{formLib} formLib
     * @param{taskLib} taskLib
     * @param{helperLib} helperLib
     */
    (file, log, formLib, taskLib, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        /**
         * Defines the Suitelet script trigger point.
         * @param {Object} scriptContext
         * @param {ServerRequest} scriptContext.request - Incoming request
         * @param {ServerResponse} scriptContext.response - Suitelet response
         * @since 2015.2
         */
        const onRequest = (scriptContext) => {
            const {request, response} = scriptContext;
            const action = request.parameters[_FIELDS.ACTION.PARAM];

            if (action === _FIELDS.ACTION.PRINT_PDF) {
                // Queues gts_mr.js instead of rendering the PDF here (see gts_task_lib.js).
                const submission = taskLib.LIB_FX.submitGenerateStatementTask(request.parameters);
                response.writePage(taskLib.LIB_FX.buildConfirmationForm(submission));
                return;
            }

            if (action === _FIELDS.ACTION.EMAIL_STATEMENT) {
                // Queues gts_email_mr.js - one email per marked customer, each with their own single-page
                // statement PDF attached (see gts_email_mr.js/gts_email_lib.js).
                const submission = taskLib.LIB_FX.submitEmailStatementTask(request.parameters);
                response.writePage(taskLib.LIB_FX.buildEmailConfirmationForm(submission));
                return;
            }

            // Polled by the progress page's own script - returns JSON, not a page.
            if (action === _FIELDS.ACTION.STATUS_CHECK) {
                const status = taskLib.LIB_FX.checkGenerateStatementStatus(
                    request.parameters[_FIELDS.ACTION.RUN_ID], request.parameters[_FIELDS.ACTION.TASK_ID]);
                response.setHeader({name: 'Content-Type', value: 'application/json'});
                response.write({output: JSON.stringify(status)});
                return;
            }

            // What the progress page navigates to once ready - streams the temp PDF gts_mr.js saved, then
            // deletes it. The delete is best-effort and doesn't block the response - the file's content is
            // already captured for the outgoing response by the time writeFile() returns.
            if (action === _FIELDS.ACTION.DOWNLOAD_PDF) {
                const fileId = request.parameters[_FIELDS.ACTION.FILE_ID];
                const pdfFile = file.load({id: fileId});
                response.writeFile({file: pdfFile, isInline: true});

                try {
                    file.delete({id: fileId});
                } catch (e) {
                    log.error(`Failed deleting temp statement file ${fileId}`, e.message);
                }

                return;
            }

            const form = formLib.LIB_FX.buildForm(request.parameters);
            response.writePage(form);
        }

        return {onRequest}

    });
