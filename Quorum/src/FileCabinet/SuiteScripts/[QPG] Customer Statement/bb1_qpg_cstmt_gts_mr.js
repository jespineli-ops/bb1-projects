/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Generates the merged Customer Statement PDF in the background - one map
 * key per marked customer, so each customer's own SuiteQL queries run in
 * their own governance/execution-time budget instead of stacking up in a
 * single Suitelet request. Triggered via N/task from gts_task_lib.js when
 * Generate Statement is clicked. The finished PDF opens in the SAME
 * browser tab Generate Statement opened - since a Map/Reduce job has no
 * live HTTP connection to push a result through, summarize saves the
 * merged PDF as a TEMPORARY file (deleted right after being streamed - see
 * gts_sl.js's DOWNLOAD_PDF branch) and writes its id (or an error) to
 * N/cache, keyed by RUN_ID, for gts_task_lib.js's
 * checkGenerateStatementStatus to poll.
 *
 * Date                 Author              Purpose
 * 04-September-2026    Jared Espineli      Initial Release - generates the merged PDF via one map key per
 *                                          marked customer, then reports a temp file id (or an error) through
 *                                          N/cache for gts_task_lib.js to poll and gts_sl.js's DOWNLOAD_PDF
 *                                          branch to stream and delete; keyed by RUN_ID (a self-generated id
 *                                          passed in as a script parameter, since N/runtime has no API for a
 *                                          Map/Reduce job to read its own real task id) - writeStatus now guards
 *                                          against a blank RUN_ID (a missing deployment Parameter) instead of
 *                                          letting cache.put's own generic error obscure the real cause.
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 */
define(['N/runtime', 'N/cache', 'N/log', './bb1_qpg_cstmt_gts_pdf_lib', './bb1_qpg_cstmt_gts_lib_helper'],
    /**
     * @param{runtime} runtime
     * @param{cache} cache
     * @param{log} log
     * @param{pdfLib} pdfLib
     * @param{helperLib} helperLib
     */
    (runtime, cache, log, pdfLib, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        // How long a written status stays in N/cache before expiring - longer than gts_task_lib.js's own
        // polling window (~10 minutes), so a slow run's result is still there for the next poll.
        const STATUS_TTL_SECONDS = 3600;

        // File Cabinet folder the merged PDF is saved to TEMPORARILY - gts_sl.js's DOWNLOAD_PDF branch deletes
        // it right after streaming. Same hardcoded-constant pattern as the Tenancy Schedule report's own CSV
        // export (EXPORT_FOLDER_ID).
        const OUTPUT_FOLDER_ID = 1649;

        //-----------------------------------------------
        //Triggered from gts_task_lib.js via N/task
        //-----------------------------------------------

        // Writes this run's result to N/cache, keyed by RUN_ID - the only channel back to the progress page's
        // polling script. statusObj is either {ready:true, fileId} or {ready:true, error}. Guards against a
        // blank runId itself (rather than letting cache.put's own generic "Missing a required argument: key"
        // obscure the real cause) - almost always means MR.PARAM.RUN_ID isn't registered as a Parameter on this
        // script's deployment yet.
        const writeStatus = (runId, statusObj) => {
            if (!runId) {
                log.error('Cannot write status - RUN_ID missing',
                    'custscript_bb1_qpg_cstmt_mr_run_id came back blank - add it as a Parameter on this script\'s deployment');
                return;
            }

            try {
                cache.getCache({name: _FIELDS.MR.STATUS_CACHE_NAME, scope: cache.Scope.PROTECTED})
                    .put({key: runId, value: JSON.stringify(statusObj), ttl: STATUS_TTL_SECONDS});
            } catch (e) {
                log.error(`Failed writing status cache for run ${runId}`, e.message);
            }
        }

        // Reads this run's date/rollup filters - each stage runs independently, so needs a fresh read rather
        // than a module-level constant.
        const getFilters = () => {
            const currentScript = runtime.getCurrentScript();
            return {
                startDate: currentScript.getParameter({name: _FIELDS.MR.PARAM.START_DATE}),
                statementDate: currentScript.getParameter({name: _FIELDS.MR.PARAM.STATEMENT_DATE}),
                rollup: currentScript.getParameter({name: _FIELDS.MR.PARAM.ROLLUP}) !== 'F'
            };
        }

        // One map key per marked customer id, in marked order - zero-padded keys so summarize's output
        // iterator (ascending key order) reassembles the pages correctly past 9 customers.
        const getInputData = (inputContext) => {
            try {
                const customerIds = helperLib.LIB_FX.parseIdListParam(
                    runtime.getCurrentScript().getParameter({name: _FIELDS.MR.PARAM.CUSTOMER_IDS}));

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

        // One customer's statement page, built via buildCustomerPageXml (which already turns a failure into a
        // short error page). No reduce stage - each key maps to exactly one value.
        const map = (mapContext) => {
            try {
                const customerId = mapContext.value;
                const pageXml = pdfLib.LIB_FX.buildCustomerPageXml(customerId, getFilters());
                mapContext.write(mapContext.key, pageXml);
            } catch (e) {
                log.error(`map error for key ${mapContext.key}`, e.message);
            }
        }

        // Collects every page in key order, merges them into one PDF, saves it as a temp file, then writes the
        // result to N/cache (writeStatus) for the progress page to pick up.
        const summarize = (summaryContext) => {
            let runId = null;

            try {
                runId = runtime.getCurrentScript().getParameter({name: _FIELDS.MR.PARAM.RUN_ID});

                const pages = [];

                summaryContext.output.iterator().each((key, value) => {
                    pages.push(value);
                    return true;
                });

                summaryContext.mapSummary.errors.iterator().each((key, errorMessage) => {
                    log.error(`map error for key ${key}`, errorMessage);
                    return true;
                });

                if (!pages.length) {
                    log.error('No statement pages generated', 'Every marked customer failed - see the map errors above');
                    writeStatus(runId, {ready: true, error: 'Every marked customer failed to generate.'});
                    return;
                }

                if (!OUTPUT_FOLDER_ID) {
                    log.error('OUTPUT_FOLDER_ID not configured',
                        'Set OUTPUT_FOLDER_ID at the top of this script to a real File Cabinet folder id before deploying');
                    writeStatus(runId, {ready: true, error: 'The output folder is not configured - contact your NetSuite administrator.'});
                    return;
                }

                const pdfFile = pdfLib.LIB_FX.wrapPagesAsPdf(pages);
                pdfFile.folder = OUTPUT_FOLDER_ID;
                // Named after the run id, not anything customer-facing - deleted moments after being served.
                pdfFile.name = `bb1_qpg_cstmt_temp_${runId}.pdf`;

                const fileId = pdfFile.save();

                writeStatus(runId, {ready: true, fileId: fileId});
                log.debug('Statement PDF generated (temp file)', `File id ${fileId}, run ${runId}`);

            } catch (e) {
                log.error('summarize error', e.message);
                if (runId) {
                    writeStatus(runId, {ready: true, error: 'Statement generation failed - check the script execution log.'});
                }
            }
        }

        return {getInputData, map, summarize}

    });
