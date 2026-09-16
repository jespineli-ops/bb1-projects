/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library that queues statement generation and emailing as
 * background Map/Reduce jobs instead of running them inline in the
 * Suitelet. Builds the progress page that polls job status and shows a
 * progress bar until the job finishes, then opens the generated PDF or
 * shows a send summary in the same browser tab.
 *
 * Date                 Author              Purpose
 * 04-September-2026    Jared Espineli      Initial Release - queues gts_mr.js and shows a progress page that polls for a result before opening the generated PDF.
 * 07-September-2026    Jared Espineli      Added Email Statement - queues gts_email_mr.js and shows a progress page reusing the shared progress-page markup.
 * 08-September-2026    Jared Espineli      Added a warning that refreshing the tab after the PDF opens returns to Customer Search, shown via a new HTML viewer page instead of streaming the PDF directly.
 * 08-September-2026    Jared Espineli      Removed the AUTHOR_ID script parameter - sender is now resolved per customer in gts_email_mr.js instead.
 * 16-September-2026    Jared Espineli      Added a Back to Search link to the shared progress page markup, shown on both the Generate Statement and Email Statement status pages.
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

        // How often (and how long, ~10 minutes total) the progress page polls before giving up.
        const POLL_INTERVAL_MS = 4000;
        const POLL_MAX_ATTEMPTS = 150;

        // Overall-progress percentage range for each Map/Reduce stage, used to drive the progress bar.
        const STAGE_RANGES = {
            [task.MapReduceStage.GET_INPUT_DATA]: [0, 5],
            [task.MapReduceStage.MAP]: [5, 90],
            [task.MapReduceStage.REDUCE]: [90, 95],
            [task.MapReduceStage.SUMMARIZE]: [95, 100]
        };

        const LIB_FX = {};

        // Generates a unique run id used as the status-cache key/temp filename.
        const generateRunId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        // Queues gts_mr.js for the marked customers/date filters. Returns the run id, task id, and customer count.
        LIB_FX.submitGenerateStatementTask = (params) => {
            const customerIds = helperLib.LIB_FX.parseIdListParam(params && params[_FIELDS.ACTION.CUSTOMER_IDS]);
            const runId = generateRunId();

            const mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: _FIELDS.MR.SCRIPT_ID,
                // Script parameter values must be strings.
                params: {
                    [_FIELDS.MR.PARAM.RUN_ID]: runId,
                    [_FIELDS.MR.PARAM.CUSTOMER_IDS]: customerIds.join(','),
                    [_FIELDS.MR.PARAM.START_DATE]: String((params && params[_FIELDS.FORM.START_DATE]) || ''),
                    [_FIELDS.MR.PARAM.STATEMENT_DATE]: String((params && params[_FIELDS.FORM.STATEMENT_DATE]) || ''),
                    // Rollup defaults on - only 'F' turns it off.
                    [_FIELDS.MR.PARAM.ROLLUP]: (params && params[_FIELDS.FORM.ROLL_PRIOR_CHARGES]) === 'F' ? 'F' : 'T'
                }
            });

            const nsTaskId = mrTask.submit();
            log.debug('Queued Generate Statement MR task', `task ${nsTaskId}, run ${runId}, ${customerIds.length} customer(s)`);

            return {runId, nsTaskId, customerCount: customerIds.length};
        }

        // Queues gts_email_mr.js for the marked customers/date filters. The sender employee is resolved per
        // customer in gts_email_mr.js's map stage (from the customer's subsidiary), not here.
        LIB_FX.submitEmailStatementTask = (params) => {
            const customerIds = helperLib.LIB_FX.parseIdListParam(params && params[_FIELDS.ACTION.CUSTOMER_IDS]);
            const runId = generateRunId();

            const mrTask = task.create({
                taskType: task.TaskType.MAP_REDUCE,
                scriptId: _FIELDS.EMAIL_MR.SCRIPT_ID,
                params: {
                    [_FIELDS.EMAIL_MR.PARAM.RUN_ID]: runId,
                    [_FIELDS.EMAIL_MR.PARAM.CUSTOMER_IDS]: customerIds.join(','),
                    [_FIELDS.EMAIL_MR.PARAM.START_DATE]: String((params && params[_FIELDS.FORM.START_DATE]) || ''),
                    [_FIELDS.EMAIL_MR.PARAM.STATEMENT_DATE]: String((params && params[_FIELDS.FORM.STATEMENT_DATE]) || ''),
                    [_FIELDS.EMAIL_MR.PARAM.ROLLUP]: (params && params[_FIELDS.FORM.ROLL_PRIOR_CHARGES]) === 'F' ? 'F' : 'T'
                }
            });

            const nsTaskId = mrTask.submit();
            log.debug('Queued Email Statement MR task', `task ${nsTaskId}, run ${runId}, ${customerIds.length} customer(s)`);

            return {runId, nsTaskId, customerCount: customerIds.length};
        }

        // Builds the URL to this Suitelet's DOWNLOAD_PDF action for the given temp file id.
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

        // Builds the URL to this Suitelet's STATUS_CHECK action, the URL the progress page polls.
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

        // Checks whether the queued run has a result yet, checking the cache first, then task status.
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

                // The job finished but nothing was found in the cache - likely a missing RUN_ID deployment parameter.
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

        // CSS shared by every progress page below.
        const PROGRESS_STYLES = `
            <style>
                .bb1-cstmt-progress-wrap { max-width: 480px; font-size: 12px; }
                .bb1-cstmt-progress-track { background: #E5E5E5; border-radius: 4px; height: 14px; overflow: hidden; }
                .bb1-cstmt-progress-fill {
                    background: #2C5266; height: 100%; width: 0%;
                    transition: width 0.4s ease; border-radius: 4px;
                }
                .bb1-cstmt-progress-fill.bb1-cstmt-progress-error { background: #B23B3B; }
                .bb1-cstmt-progress-status { margin-top: 8px; color: #555555; }
                .bb1-cstmt-progress-back {
                    display: inline-block; margin-top: 16px; padding: 6px 14px;
                    background: #2C5266; color: #FFFFFF; text-decoration: none;
                    border-radius: 4px; font-size: 12px;
                }
                .bb1-cstmt-progress-back:hover { background: #1F3B49; }
            </style>
        `;

        // Builds a progress page that polls for job status and updates the bar until done, then runs config.readyHandlerJs.
        const buildProgressPage = (config) => {
            const form = serverWidget.createForm({title: config.title});

            form.addField({
                id: config.fieldId,
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Confirmation'
            }).defaultValue = `
                ${PROGRESS_STYLES}
                <div class="bb1-cstmt-progress-wrap">
                    ${config.introHtml}
                    <div class="bb1-cstmt-progress-track">
                        <div id="bb1-cstmt-gts-bar" class="bb1-cstmt-progress-fill"></div>
                    </div>
                    <p id="bb1-cstmt-gts-status" class="bb1-cstmt-progress-status">Starting...</p>
                    <a class="bb1-cstmt-progress-back" href="${helperLib.LIB_FX.buildBackToSearchUrl()}">Back to Search</a>
                </div>
                <script>
                (function () {
                    var pollUrl = ${JSON.stringify(config.statusCheckUrl)};
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
                        statusEl.textContent = 'Could not complete: ' + message;
                    }

                    function onReady(data) {
                        ${config.readyHandlerJs}
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
                                if (data.ready) {
                                    onReady(data);
                                    return;
                                }
                                if (typeof data.percent === 'number') {
                                    setPercent(data.percent);
                                    statusEl.textContent = 'Working... ' + data.percent + '%';
                                }
                                if (attempts >= maxAttempts) {
                                    statusEl.textContent = 'Still working after several minutes - check back later.';
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

        // Generate Statement's progress page - once ready, redirects this same tab to the finished PDF.
        LIB_FX.buildConfirmationForm = (submission) => buildProgressPage({
            title: 'Generate Statement',
            fieldId: 'custpage_qpg_cstmt_gts_confirm',
            statusCheckUrl: buildStatusCheckUrl(submission.runId, submission.nsTaskId),
            introHtml: `<p>Generating the statement for ${submission.customerCount} customer(s) - this runs in the
                background and may take a few minutes for a large selection. This tab will open the PDF
                automatically once it's ready - please keep it open. Refreshing this tab after the PDF opens
                will return you to Customer Search.</p>`,
            readyHandlerJs: `
                setPercent(100);
                if (data.downloadUrl) {
                    statusEl.textContent = 'Done - opening the PDF...';
                    window.location.href = data.downloadUrl;
                    return;
                }
                statusEl.textContent = 'Done.';
            `
        });

        // Email Statement's progress page - once ready, shows the send summary (sent/skipped/failed).
        LIB_FX.buildEmailConfirmationForm = (submission) => buildProgressPage({
            title: 'Email Statement',
            fieldId: 'custpage_qpg_cstmt_gts_email_confirm',
            statusCheckUrl: buildStatusCheckUrl(submission.runId, submission.nsTaskId),
            introHtml: `<p>Emailing the statement to ${submission.customerCount} customer(s) - this runs in the
                background and may take a few minutes for a large selection. Keep this tab open until it
                finishes.</p>`,
            readyHandlerJs: `
                setPercent(100);
                if (data.summary) {
                    var s = data.summary;
                    var parts = [s.sent + ' sent'];
                    if (s.skipped) parts.push(s.skipped + ' skipped (no recipient email or statement author on file)');
                    if (s.failed) parts.push(s.failed + ' failed');
                    statusEl.textContent = 'Done - ' + parts.join(', ') + '.';
                    return;
                }
                statusEl.textContent = 'Done.';
            `
        });

        // Escapes HTML entities in the PDF's file name.
        const escapeHtml = (value) => String(value || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

        // Builds an HTML page that embeds the PDF (as a base64 data URI) and warns that refreshing it returns to Customer Search.
        LIB_FX.buildPdfViewerPage = (fileName, base64Contents) => `
            <!doctype html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>${escapeHtml(fileName)}</title>
                <style>html, body { margin: 0; height: 100%; }</style>
            </head>
            <body>
                <script>
                    window.alert('Refreshing this page will return you to Customer Search.');
                </script>
                <embed src="data:application/pdf;base64,${base64Contents}" type="application/pdf"
                       style="width: 100%; height: 100vh; border: none;" />
            </body>
            </html>
        `;

        return {LIB_FX};
    });
