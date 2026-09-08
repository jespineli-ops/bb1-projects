/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Emails the Customer Statement in the background - one map key per marked
 * customer, each getting their own single-page statement PDF by email
 * (see gts_email_lib.js for addresses/subject/body/send). Triggered via
 * N/task from gts_task_lib.js. Reports a send summary through N/cache
 * (keyed by RUN_ID) for the progress page to poll.
 *
 * Date                 Author              Purpose
 * 07-September-2026    Jared Espineli      Initial Release - emails each marked customer their own statement PDF and reports a send summary for the progress page.
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(['N/runtime', 'N/cache', 'N/log', './bb1_qpg_cstmt_gts_pdf_lib', './bb1_qpg_cstmt_gts_email_lib',
        './bb1_qpg_cstmt_gts_lib_helper'],
    /**
     * @param{runtime} runtime
     * @param{cache} cache
     * @param{log} log
     * @param{pdfLib} pdfLib
     * @param{emailLib} emailLib
     * @param{helperLib} helperLib
     */
    (runtime, cache, log, pdfLib, emailLib, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        // How long a run's cached status stays available for the progress page to poll.
        const STATUS_TTL_SECONDS = 3600;

        //-----------------------------------------------
        //Triggered from gts_task_lib.js via N/task
        //-----------------------------------------------

        // Writes this run's result to N/cache, keyed by RUN_ID, for the progress page to poll.
        const writeStatus = (runId, statusObj) => {
            if (!runId) {
                log.error('Cannot write status - RUN_ID missing',
                    'custscript_bb1_qpg_cstmt_eml_run_id came back blank - add it as a Parameter on this script\'s deployment');
                return;
            }

            try {
                cache.getCache({name: _FIELDS.MR.STATUS_CACHE_NAME, scope: cache.Scope.PROTECTED})
                    .put({key: runId, value: JSON.stringify(statusObj), ttl: STATUS_TTL_SECONDS});
            } catch (e) {
                log.error(`Failed writing status cache for run ${runId}`, e.message);
            }
        }

        // Reads this run's date/rollup filters from the script parameters.
        const getFilters = () => {
            const currentScript = runtime.getCurrentScript();
            return {
                startDate: currentScript.getParameter({name: _FIELDS.EMAIL_MR.PARAM.START_DATE}),
                statementDate: currentScript.getParameter({name: _FIELDS.EMAIL_MR.PARAM.STATEMENT_DATE}),
                rollup: currentScript.getParameter({name: _FIELDS.EMAIL_MR.PARAM.ROLLUP}) !== 'F'
            };
        }

        // One map key per marked customer id, in marked order.
        const getInputData = (inputContext) => {
            try {
                const customerIds = helperLib.LIB_FX.parseIdListParam(
                    runtime.getCurrentScript().getParameter({name: _FIELDS.EMAIL_MR.PARAM.CUSTOMER_IDS}));

                const inputObject = {};
                customerIds.forEach((customerId, index) => {
                    inputObject[String(index).padStart(5, '0')] = customerId;
                });

                return inputObject;
            } catch (e) {
                log.error('getInputData error', e.message);
                throw e;
            }
        }

        // Emails one customer's statement and writes its result for summarize to tally. Never throws, so one
        // failed customer doesn't stop the batch.
        const map = (mapContext) => {
            const customerId = mapContext.value;

            try {
                // N/email.send's author must be a Number - script parameters come back as strings.
                const authorId = Number(runtime.getCurrentScript().getParameter({name: _FIELDS.EMAIL_MR.PARAM.AUTHOR_ID}));

                if (!authorId) {
                    mapContext.write(mapContext.key, {
                        status: 'failed', customerId,
                        reason: `Sender employee id ${emailLib.LIB_FX.AUTHOR_EMPLOYEE_ID} did not reach this ` +
                            'job - check the AUTHOR_ID parameter on this script\'s deployment.'
                    });
                    return;
                }

                const {statement, pageXml} = pdfLib.LIB_FX.buildCustomerStatement(customerId, getFilters());
                const customerName = statement.header.customer_name || `Customer ${customerId}`;
                const emailFields = emailLib.LIB_FX.getStatementEmailFields(customerId);

                if (!emailFields.to.length) {
                    mapContext.write(mapContext.key, {
                        status: 'skipped', customerId, customerName,
                        reason: 'No statement recipient email on file.'
                    });
                    return;
                }

                const pdfFile = pdfLib.LIB_FX.wrapPagesAsPdf([pageXml]);
                pdfFile.name = `Statement - ${customerName} - ${statement.billingMonth}.pdf`;

                emailLib.LIB_FX.sendStatementEmail({
                    authorId, customerId,
                    to: emailFields.to,
                    cc: emailFields.cc,
                    subject: emailLib.LIB_FX.buildSubject(statement.billingMonth),
                    body: emailLib.LIB_FX.buildBody(customerName, statement.billingMonth),
                    pdfFile
                });

                mapContext.write(mapContext.key, {status: 'sent', customerId, customerName});
            } catch (e) {
                log.error(`Email failed for customer ${customerId}`, e.message);
                mapContext.write(mapContext.key, {status: 'failed', customerId, reason: e.message});
            }
        }

        // Tallies every per-customer result into one summary and reports it through N/cache.
        const summarize = (summaryContext) => {
            let runId = null;

            try {
                runId = runtime.getCurrentScript().getParameter({name: _FIELDS.EMAIL_MR.PARAM.RUN_ID});

                const summary = {sent: 0, skipped: 0, failed: 0, details: []};

                summaryContext.output.iterator().each((key, value) => {
                    const result = JSON.parse(value);
                    summary[result.status] = (summary[result.status] || 0) + 1;

                    // Only non-sent results get a detail line - a full "sent" list would just be noise here.
                    if (result.status !== 'sent') {
                        summary.details.push(`${result.customerName || result.customerId}: ${result.reason || result.status}`);
                    }

                    return true;
                });

                summaryContext.mapSummary.errors.iterator().each((key, errorMessage) => {
                    log.error(`map error for key ${key}`, errorMessage);
                    summary.failed++;
                    return true;
                });

                writeStatus(runId, {ready: true, summary});
                log.debug('Statement emails sent', `run ${runId}: ${JSON.stringify(summary)}`);
            } catch (e) {
                log.error('summarize error', e.message);
                if (runId) {
                    writeStatus(runId, {ready: true, error: 'Emailing statements failed - check the script execution log.'});
                }
            }
        }

        return {getInputData, map, summarize}

    });
