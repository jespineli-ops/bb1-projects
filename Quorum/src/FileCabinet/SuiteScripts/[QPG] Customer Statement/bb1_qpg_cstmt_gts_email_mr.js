/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Emails the Customer Statement in the background - one map key per
 * customer, each getting their own single-page statement PDF by email
 * (see gts_email_lib.js for addresses/subject/body/send). Has two
 * deployments: an on-demand one, triggered via N/task from gts_task_lib.js
 * with an explicit CUSTOMER_IDS/RUN_ID (reports a send summary through
 * N/cache, keyed by RUN_ID, for the Suitelet's progress page to poll); and
 * a Scheduled one, customdeploy_bb1_qpg_cstmt_gts_email_mrs (fires on the
 * 20th of each month), which has no CUSTOMER_IDS/RUN_ID/dates set - it
 * instead processes every customer in the Customer List saved search (read
 * off the SCRIPT_PARAM.CUSTOMER_LIST_SEARCH Company Preference, shared with
 * the Suitelet) and defaults its own Start/Statement Date (see
 * getDefaultPeriodDates() in gts_pdf_lib.js).
 *
 * Date                 Author              Purpose
 * 07-September-2026    Jared Espineli      Initial Release - emails each marked customer their own statement PDF and reports a send summary for the progress page.
 * 08-September-2026    Jared Espineli      Added the Scheduled-deployment path (customer list/dates fallback, per-customer sender from subsidiary, optional RUN_ID) and logs deploymentId for traceability.
 * 16-September-2026    Jared Espineli      Subject/body now come from the customer's subsidiary Email Template when configured (gts_email_lib.js's mergeEmailTemplate()), falling back to the fixed wording otherwise. The PDF attachment is unaffected either way.
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(['N/runtime', 'N/cache', 'N/search', 'N/log', './bb1_qpg_cstmt_gts_pdf_lib', './bb1_qpg_cstmt_gts_email_lib',
        './bb1_qpg_cstmt_gts_lib_helper'],
    /**
     * @param{runtime} runtime
     * @param{cache} cache
     * @param{search} search
     * @param{log} log
     * @param{pdfLib} pdfLib
     * @param{emailLib} emailLib
     * @param{helperLib} helperLib
     */
    (runtime, cache, search, log, pdfLib, emailLib, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        // How long a run's cached status stays available for the progress page to poll.
        const STATUS_TTL_SECONDS = 3600;

        //-----------------------------------------------
        //Shared by both deployments - on-demand (triggered from gts_task_lib.js via N/task) and Scheduled
        //-----------------------------------------------

        // Writes this run's result to N/cache, keyed by RUN_ID, for the progress page to poll. Callers only
        // reach this with a RUN_ID in hand (see summarize below) - the Scheduled deployment has none and skips
        // this entirely, so this guard is just defensive.
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

        // Reads this run's date/rollup filters from the script parameters. START_DATE/STATEMENT_DATE are blank
        // on the Scheduled deployment - fall back to computed defaults (rollup already defaults on via !== 'F',
        // matching the Suitelet's Roll Prior Charges checkbox default, so nothing extra needed for that here).
        const getFilters = () => {
            const currentScript = runtime.getCurrentScript();
            const startDateParam = currentScript.getParameter({name: _FIELDS.EMAIL_MR.PARAM.START_DATE});
            const statementDateParam = currentScript.getParameter({name: _FIELDS.EMAIL_MR.PARAM.STATEMENT_DATE});
            const defaults = (!startDateParam || !statementDateParam) ? pdfLib.LIB_FX.getDefaultPeriodDates() : null;

            return {
                startDate: startDateParam || defaults.startDate,
                statementDate: statementDateParam || defaults.statementDate,
                rollup: currentScript.getParameter({name: _FIELDS.EMAIL_MR.PARAM.ROLLUP}) !== 'F'
            };
        }

        // Enumerates every customer id in the Customer List saved search - used by the Scheduled deployment,
        // which has no CUSTOMER_IDS param (that's only set by the Suitelet's on-demand task.create() call).
        // SCRIPT_PARAM.CUSTOMER_LIST_SEARCH is a Company Preference, so it's readable here even though it's
        // defined on the Suitelet's script, not this one. Pages in 1000-row chunks since search.run().getRange()
        // caps at 1000.
        const getCustomerListSearchIds = () => {
            const searchId = runtime.getCurrentScript().getParameter({name: _FIELDS.SCRIPT_PARAM.CUSTOMER_LIST_SEARCH});

            if (!searchId) {
                log.error('Missing Company Preference',
                    `${_FIELDS.SCRIPT_PARAM.CUSTOMER_LIST_SEARCH} has no value set - ` +
                    'no CUSTOMER_IDS and no saved search means there are no customers to process.');
                return [];
            }

            const ids = [];

            try {
                const loadedSearch = search.load({id: searchId});
                const totalCount = loadedSearch.runPaged({pageSize: 1}).count;

                let start = 0;
                while (start < totalCount) {
                    const end = Math.min(start + 1000, totalCount);
                    loadedSearch.run().getRange({start, end}).forEach((result) => ids.push(String(result.id)));
                    start = end;
                }
            } catch (e) {
                log.error(`Customer List search load failed for id ${searchId}`, e.message);
            }

            return ids;
        }

        // One map key per customer id - either the marked ids carried from the Suitelet, or (Scheduled
        // deployment) every customer in CUSTOMER_LIST_SEARCH.
        const getInputData = (inputContext) => {
            try {
                const customerIds = helperLib.LIB_FX.parseIdListParam(
                    runtime.getCurrentScript().getParameter({name: _FIELDS.EMAIL_MR.PARAM.CUSTOMER_IDS}));

                const ids = customerIds.length ? customerIds : getCustomerListSearchIds();

                const inputObject = {};
                ids.forEach((customerId, index) => {
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
                const {statement, pageXml} = pdfLib.LIB_FX.buildCustomerStatement(customerId, getFilters());
                const customerName = statement.header.customer_name || `Customer ${customerId}`;

                // Sender is resolved per customer, from their subsidiary's Customer Statement Author field
                // (custrecord_bb1_cust_statement_author) - N/email.send's author must be a Number.
                const authorId = Number(statement.header.statement_author_id) || null;

                if (!authorId) {
                    const reason = 'No Customer Statement Author configured on this customer\'s subsidiary ' +
                        '(custrecord_bb1_cust_statement_author) - skipped.';
                    log.error(`Skipping email for customer ${customerId}`, reason);
                    mapContext.write(mapContext.key, {status: 'skipped', customerId, customerName, reason});
                    return;
                }

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

                // Subsidiary's Email Template (custrecord_bb1_cus_state_email_template), when configured,
                // supplies the subject/body - falls back to the fixed wording otherwise. Either way the PDF
                // is still attached below by sendStatementEmail.
                const templateEmail = emailLib.LIB_FX.mergeEmailTemplate(
                    statement.header.email_template_id, customerId, statement.header.transaction_id);

                emailLib.LIB_FX.sendStatementEmail({
                    authorId, customerId,
                    to: emailFields.to,
                    cc: emailFields.cc,
                    subject: templateEmail ? templateEmail.subject : emailLib.LIB_FX.buildSubject(statement.billingMonth),
                    body: templateEmail ? templateEmail.body : emailLib.LIB_FX.buildBody(customerName, statement.billingMonth),
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

                // RUN_ID is blank on the Scheduled deployment - no progress page is polling for one, so the
                // status-cache write is skipped rather than logged as an error (see writeStatus above).
                if (runId) writeStatus(runId, {ready: true, summary});

                // Both deployments log into the same script's Execution Log, and a blank RUN_ID alone doesn't
                // prove this was the real Scheduled recurrence - it also happens when someone tests the
                // Scheduled deployment via Deploy Script. deploymentId disambiguates both unambiguously.
                const deploymentId = runtime.getCurrentScript().deploymentId;
                log.debug('Statement emails sent',
                    `deployment ${deploymentId}, run ${runId || '(none)'}: ${JSON.stringify(summary)}`);
            } catch (e) {
                log.error(`summarize error (deployment ${runtime.getCurrentScript().deploymentId})`, e.message);
                if (runId) {
                    writeStatus(runId, {ready: true, error: 'Emailing statements failed - check the script execution log.'});
                }
            }
        }

        return {getInputData, map, summarize}

    });
