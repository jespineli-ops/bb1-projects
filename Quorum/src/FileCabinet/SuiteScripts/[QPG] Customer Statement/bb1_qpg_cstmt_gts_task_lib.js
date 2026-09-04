/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library that hands Generate Statement off to the background
 * gts_mr.js Map/Reduce job instead of rendering the merged PDF inline in
 * the Suitelet. The PDF still needs to open in the SAME new browser tab
 * Generate Statement opened - since a Map/Reduce job has no live HTTP
 * connection to push its result back through, that tab instead opens
 * showing a progress page (buildConfirmationForm) whose own script polls
 * the new STATUS_CHECK action every few seconds - driving a visual
 * progress bar off gts_mr.js's own N/task.checkStatus() - until it reports
 * a temp file id (or an error), then navigates that same tab to the new
 * DOWNLOAD_PDF action (see gts_sl.js), which streams that file and
 * deletes it immediately after.
 *
 * Date                 Author              Purpose
 * 04-September-2026    Jared Espineli      Initial Release - queues gts_mr.js and shows a progress page with a
 *                                          real bar (fed by task.checkStatus()'s per-stage percentage) that
 *                                          polls until a temp file id (or error) appears in N/cache, then
 *                                          navigates to the DOWNLOAD_PDF action; generates its own RUN_ID (a
 *                                          Map/Reduce job has no API to read its own real task id) and passes
 *                                          it into gts_mr.js as a script parameter to use as the cache key,
 *                                          while the real task id from submit() is kept separately for
 *                                          task.checkStatus() progress polling - a COMPLETE task with nothing
 *                                          in the cache now surfaces a clear error (pointing at a likely-missing
 *                                          RUN_ID deployment Parameter) instead of polling forever.
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/task', 'N/runtime', 'N/url', 'N/cache', 'N/ui/serverWidget', 'N/log', './bb1_qpg_cstmt_gts_lib_helper'],
    /**
     * @param{task} task
     * @param{runtime} runtime
     * @param{url} url
     * @param{cache} cache
     * @param{serverWidget} serverWidget
     * @param{log} log
     * @param{helperLib} helperLib
     */
    (task, runtime, url, cache, serverWidget, log, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        // Poll cadence for the progress page's own script. POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS is how long the
        // page keeps polling before giving up (~10 minutes) - the background job itself isn't stopped by this.
        const POLL_INTERVAL_MS = 4000;
        const POLL_MAX_ATTEMPTS = 150;

        // Rough overall-progress ranges per Map/Reduce stage, turning task.checkStatus()'s per-stage
        // getPercentageCompleted() into one number the bar can show. MAP gets the majority of the range since
        // that's where the real per-customer query work happens.
        const STAGE_RANGES = {
            [task.MapReduceStage.GET_INPUT_DATA]: [0, 5],
            [task.MapReduceStage.MAP]: [5, 90],
            [task.MapReduceStage.REDUCE]: [90, 95],
            [task.MapReduceStage.SUMMARIZE]: [95, 100]
        };

        const LIB_FX = {};

        // A run id generated BEFORE submission, so it can be handed to gts_mr.js as a script parameter - the
        // real NetSuite task id isn't known until submit() returns, too late to pass into the job it identifies.
        // Not a security token, just needs to be unique enough for a status-cache key/temp filename.
        const generateRunId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        // Queues gts_mr.js with this request's marked customer ids/date filters. Returns the self-generated
        // run id (the N/cache key gts_mr.js writes its result under), the real task id (for task.checkStatus()
        // progress polling), and customer count (for the initial message).
        LIB_FX.submitGenerateStatementTask = (params) => {
            const customerIds = helperLib.LIB_FX.parseIdListParam(params && params[_FIELDS.ACTION.CUSTOMER_IDS]);
            const runId = generateRunId();

            const mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: _FIELDS.MR.SCRIPT_ID,
                // Coerced to String() throughout - the only type a script parameter value is guaranteed to
                // round-trip as.
                params: {
                    [_FIELDS.MR.PARAM.RUN_ID]: runId,
                    [_FIELDS.MR.PARAM.CUSTOMER_IDS]: customerIds.join(','),
                    [_FIELDS.MR.PARAM.START_DATE]: String((params && params[_FIELDS.FORM.START_DATE]) || ''),
                    [_FIELDS.MR.PARAM.STATEMENT_DATE]: String((params && params[_FIELDS.FORM.STATEMENT_DATE]) || ''),
                    // Mirrors buildPdf's own rollup default - only 'F' turns it off
                    [_FIELDS.MR.PARAM.ROLLUP]: (params && params[_FIELDS.FORM.ROLL_PRIOR_CHARGES]) === 'F' ? 'F' : 'T'
                }
            });

            const nsTaskId = mrTask.submit();
            log.debug('Queued Generate Statement MR task', `task ${nsTaskId}, run ${runId}, ${customerIds.length} customer(s)`);

            return {runId, nsTaskId, customerCount: customerIds.length};
        }

        // This same Suitelet's DOWNLOAD_PDF action, carrying the temp file's id - streamed then deleted by
        // gts_sl.js, never a lasting URL.
        const buildDownloadUrl = (fileId) => {
            const currentScript = runtime.getCurrentScript();

            return url.resolveScript({
                scriptId: currentScript.id,
                deploymentId: currentScript.deploymentId,
                params: {
                    [_FIELDS.ACTION.PARAM]: _FIELDS.ACTION.DOWNLOAD_PDF,
                    [_FIELDS.ACTION.FILE_ID]: fileId
                }
            });
        }

        // Turns a still-running MapReduceScriptTaskStatus into one overall percent via STAGE_RANGES above.
        const estimateOverallPercent = (status) => {
            const range = STAGE_RANGES[status.stage] || [0, 100];
            const stagePercent = (typeof status.getPercentageCompleted === 'function' && status.getPercentageCompleted()) || 0;

            return Math.round(range[0] + (stagePercent / 100) * (range[1] - range[0]));
        }

        // This same Suitelet's STATUS_CHECK action, carrying both ids - runId (the N/cache key) and nsTaskId
        // (for task.checkStatus() progress) - what the progress page polls.
        const buildStatusCheckUrl = (runId, nsTaskId) => {
            const currentScript = runtime.getCurrentScript();

            return url.resolveScript({
                scriptId: currentScript.id,
                deploymentId: currentScript.deploymentId,
                params: {
                    [_FIELDS.ACTION.PARAM]: _FIELDS.ACTION.STATUS_CHECK,
                    [_FIELDS.ACTION.RUN_ID]: runId,
                    [_FIELDS.ACTION.TASK_ID]: nsTaskId
                }
            });
        }

        // Checks whether the queued run has a result yet. Checks N/cache first, by runId (the definitive
        // result, written by gts_mr.js's summarize) and only falls back to task.checkStatus() by nsTaskId - for
        // progress percent, and to catch a run that failed before summarize ever wrote anything.
        LIB_FX.checkGenerateStatementStatus = (runId, nsTaskId) => {
            if (!runId) {
                return {ready: true, error: 'Missing run id.'};
            }

            try {
                const statusCache = cache.getCache({name: _FIELDS.MR.STATUS_CACHE_NAME, scope: cache.Scope.PROTECTED});
                const cached = statusCache.get({key: runId});

                if (cached) {
                    const result = JSON.parse(cached);

                    if (result.fileId) {
                        return {ready: true, downloadUrl: buildDownloadUrl(result.fileId)};
                    }

                    return result; // {ready:true, error}
                }
            } catch (e) {
                log.error(`Status cache read failed for run ${runId}`, e.message);
                return {ready: true, error: 'Could not read the generation result - check the script execution log.'};
            }

            try {
                const status = task.checkStatus({taskId: nsTaskId});

                if (status.status === task.TaskStatus.FAILED) {
                    return {ready: true, error: 'Statement generation failed - check the script execution log.'};
                }

                // The job finished but the cache lookup above found nothing - normally impossible (gts_mr.js
                // writes the cache entry as its very last step), so this means MR.PARAM.RUN_ID isn't registered
                // on the deployment (getParameter() came back blank there, so writeStatus had no key to write
                // under). Surfaced here instead of leaving the page polling forever.
                if (status.status === task.TaskStatus.COMPLETE) {
                    return {
                        ready: true,
                        error: 'Statement generation finished, but no result was found - the RUN_ID parameter ' +
                            'may be missing from the customscript_bb1_qpg_cstmt_gts_mr deployment.'
                    };
                }

                return {ready: false, percent: estimateOverallPercent(status)};
            } catch (e) {
                log.error(`task.checkStatus failed for task ${nsTaskId}`, e.message);
                return {ready: true, error: 'Could not check the generation status - check the script execution log.'};
            }
        }

        // A progress page shown in place of the PDF - its own plain <script> polls checkGenerateStatementStatus
        // every POLL_INTERVAL_MS, updating the bar, until a response carries a downloadUrl or an error.
        LIB_FX.buildConfirmationForm = (submission) => {
            const form = serverWidget.createForm({title: 'Generate Statement'});
            const statusCheckUrl = buildStatusCheckUrl(submission.runId, submission.nsTaskId);

            form.addField({
                id: 'custpage_qpg_cstmt_gts_confirm',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Confirmation'
            }).defaultValue = `
                <style>
                    .bb1-cstmt-progress-wrap { max-width: 480px; font-size: 12px; }
                    .bb1-cstmt-progress-track { background: #E5E5E5; border-radius: 4px; height: 14px; overflow: hidden; }
                    .bb1-cstmt-progress-fill {
                        background: #2C5266; height: 100%; width: 0%;
                        transition: width 0.4s ease; border-radius: 4px;
                    }
                    .bb1-cstmt-progress-fill.bb1-cstmt-progress-error { background: #B23B3B; }
                    .bb1-cstmt-progress-status { margin-top: 8px; color: #555555; }
                </style>
                <div class="bb1-cstmt-progress-wrap">
                    <p>Generating the statement for ${submission.customerCount} customer(s) - this runs in the
                    background and may take a few minutes for a large selection. This tab will open the PDF
                    automatically once it's ready - please keep it open.</p>
                    <div class="bb1-cstmt-progress-track">
                        <div id="bb1-cstmt-gts-bar" class="bb1-cstmt-progress-fill"></div>
                    </div>
                    <p id="bb1-cstmt-gts-status" class="bb1-cstmt-progress-status">Starting...</p>
                </div>
                <script>
                (function () {
                    var pollUrl = ${JSON.stringify(statusCheckUrl)};
                    var maxAttempts = ${POLL_MAX_ATTEMPTS};
                    var intervalMs = ${POLL_INTERVAL_MS};
                    var attempts = 0;
                    var barEl = document.getElementById('bb1-cstmt-gts-bar');
                    var statusEl = document.getElementById('bb1-cstmt-gts-status');

                    function setPercent(percent) {
                        barEl.style.width = Math.max(0, Math.min(100, percent)) + '%';
                    }

                    function showError(message) {
                        barEl.classList.add('bb1-cstmt-progress-error');
                        statusEl.textContent = 'Could not generate the statement: ' + message;
                    }

                    function poll() {
                        attempts++;

                        fetch(pollUrl, {credentials: 'same-origin'})
                            .then(function (response) { return response.json(); })
                            .then(function (data) {
                                if (data.error) {
                                    showError(data.error);
                                    return;
                                }
                                if (data.ready && data.downloadUrl) {
                                    setPercent(100);
                                    statusEl.textContent = 'Done - opening the PDF...';
                                    window.location.href = data.downloadUrl;
                                    return;
                                }
                                if (typeof data.percent === 'number') {
                                    setPercent(data.percent);
                                    statusEl.textContent = 'Generating... ' + data.percent + '%';
                                }
                                if (attempts >= maxAttempts) {
                                    statusEl.textContent = 'Still generating after several minutes - check back later.';
                                    return;
                                }
                                setTimeout(poll, intervalMs);
                            })
                            .catch(function () {
                                if (attempts >= maxAttempts) {
                                    showError('could not reach the server. Please refresh this tab to try again.');
                                    return;
                                }
                                setTimeout(poll, intervalMs);
                            });
                    }

                    poll();
                })();
                </script>
            `;

            return form;
        }

        return {LIB_FX};
    });
