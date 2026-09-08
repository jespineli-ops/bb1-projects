/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Suitelet for the Generate Statement page. Renders the form, queues background
 * PDF-generation or email jobs for large selections, and lets the progress page
 * poll status. Also streams the finished PDF for printing or one-shot download.
 *
 * Date             Author              Purpose
 * 02-September-2026    Jared Espineli      Initial Release - passes request.parameters through to buildForm() so the carried-over Customer/Category filter reaches the Customer List sublist.
 * 03-September-2026    Jared Espineli      Added the print action that streams the merged statement PDF, and confirmed the Customer List's page index passes through unchanged.
 * 04-September-2026    Jared Espineli      Fixed crashes on large selections by queuing a background Map/Reduce job to generate the PDF, with STATUS_CHECK/DOWNLOAD_PDF actions for the progress page.
 * 07-September-2026    Jared Espineli      Added the EMAIL_STATEMENT action to queue statement emails, reusing STATUS_CHECK to poll progress.
 * 08-September-2026    Jared Espineli      Made DOWNLOAD_PDF handle an already-gone temp file gracefully by redirecting back to Customer Search instead of showing a raw error.
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/file', 'N/http', 'N/log', './bb1_qpg_cstmt_gts_form_lib', './bb1_qpg_cstmt_gts_task_lib', './bb1_qpg_cstmt_gts_lib_helper'],
    /**
     * @param{file} file
     * @param{http} http
     * @param{log} log
     * @param{formLib} formLib
     * @param{taskLib} taskLib
     * @param{helperLib} helperLib
     */
    (file, http, log, formLib, taskLib, helperLib) => {

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
                // Queues the PDF-generation job instead of rendering the PDF here.
                const submission = taskLib.LIB_FX.submitGenerateStatementTask(request.parameters);
                response.writePage(taskLib.LIB_FX.buildConfirmationForm(submission));
                return;
            }

            if (action === _FIELDS.ACTION.EMAIL_STATEMENT) {
                // Queues the email-statement job - one email per selected customer, each with its own PDF attached.
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

            // What the progress page navigates to once ready - streams the finished PDF as an HTML
            // wrapper that warns about refreshing, then deletes the temp file.
            if (action === _FIELDS.ACTION.DOWNLOAD_PDF) {
                const fileId = request.parameters[_FIELDS.ACTION.FILE_ID];

                // The URL is one-shot; if the file is already gone (e.g. a refresh), redirect back to
                // Customer Search instead of erroring.
                let pdfFile;
                try {
                    pdfFile = file.load({id: fileId});
                } catch (e) {
                    log.debug('DOWNLOAD_PDF file no longer available', `fileId ${fileId}: ${e.message}`);
                    response.sendRedirect({
                        type: http.RedirectType.SUITELET,
                        identifier: helperLib.LIB_FX.BACK_TO_SEARCH.scriptId,
                        id: helperLib.LIB_FX.BACK_TO_SEARCH.deploymentId
                    });
                    return;
                }

                response.setHeader({name: 'Content-Type', value: 'text/html'});
                response.write({output: taskLib.LIB_FX.buildPdfViewerPage(pdfFile.name, pdfFile.getContents())});

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
