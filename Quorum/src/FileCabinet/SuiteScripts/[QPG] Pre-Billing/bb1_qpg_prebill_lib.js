/**
 * Project: Quorum (Q Holdings) - P102843
 *
 * Teamwork task: [TEAMWORK TASK LINK OR N/A - confirm before deployment]
 *
 * Shared library for bb1_qpg_prebill_sl.js - SuiteQL data assembly,
 * classification rules, and screen/PDF/CSV rendering for the MRI-style
 * Pre-Billing Check tenant billing history report.
 *
 * Date              Author              Purpose
 * 16-September-2026 Jared Espineli      Initial Release
 * 18-September-2026 Jared Espineli      Added screen pagination (Previous/Next), ported from
 *                                       Andile's bb1_qhold_billhist_su.js POC.
 * 21-September-2026 Jared Espineli      Added the Compare Periods layout (with Only Show
 *                                       Variances and Variance Tolerance %), ported from
 *                                       Andile's bb1_qhold_billhist_su.js POC.
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */

define(['N/query', 'N/runtime', 'N/render', 'N/file', 'N/url', 'N/format', 'N/record', 'N/error', 'N/log'],

    function (query, runtime, render, file, url, format, record, error, log) {

        //-----------------------------------------------
        //Account-specific constants
        //-----------------------------------------------

        var DEFAULT_PERIOD_COUNT  = 4;
        var MAX_PERIOD_COUNT      = 24;

        // Caps a property-wide multi-period run to stay inside the BB1 5-second rule.
        // Screen output is paged instead (see PAGE_SIZE) and is not subject to this cap;
        // PDF and CSV are unpaged and always cover the whole selection, so this is what
        // bounds them.
        var MAX_TENANTS           = 250;
        var QUERY_CHUNK_SIZE      = 500;

        // Tenants shown per screen page. PDF and CSV ignore this and take the lot.
        var PAGE_SIZE             = 50;

        // BFO fails with a generic error past this many rows - named here instead
        var MAX_PDF_ROWS          = 4000;

        // Above this, an invoice/lines mismatch is shown as its own row, not absorbed
        var RECONCILE_TOLERANCE   = 0.01;

        // Comma-separated; only stripped when a name actually starts with one
        var ALLOCATION_PREFIXES   = 'XXX_';

        var AR_ACCOUNT_TYPE       = 'AcctRec';
        var SQL_DATE_MASK         = 'YYYY-MM-DD';
        var REPORT_TITLE          = 'Tenant Billing History';

        // PDF header logo box, in points - the logo is scaled down (never up) to fit
        var LOGO_MAX_WIDTH        = 150;
        var LOGO_MAX_HEIGHT       = 58;

        var MONTH_NAMES           = ['January', 'February', 'March', 'April', 'May', 'June',
                                     'July', 'August', 'September', 'October', 'November', 'December'];

        // Portfolio/accommodation type live on the property and unit segment records
        var BUILDING_RECORD       = 'customrecord_cseg_bb1_building';
        var BUILDING_PORTFOLIO    = 'custrecord_bb1_building_portfolio';
        var UNIT_RECORD           = 'customrecord_cseg_bb1_unit';
        var UNIT_ACCOMM_TYPE      = 'custrecord_bb1_unit_accommodation_type';

        // Same lists the Contracts/Tenancy Schedule filters use
        var PORTFOLIO_LIST        = 'customlist_bb1_building_prop_portfolio';
        var ACCOMM_TYPE_LIST      = 'customlist_bb1_building_accommoda_type';

        // Utilised Charge record - field IDs include the account's spelling
        // inconsistencies (utilited / utlised); do not "correct" them
        var UC_RECORD             = 'customrecord_bb1_utilised_charges';
        var UC_INVOICE            = 'custrecord_bb1_utilised_invoice';
        var UC_ITEM               = 'custrecord_bb1_utlised_item';
        var UC_TYPE               = 'custrecord_bb1_utilised_type';
        var UC_STATUS             = 'custrecord_bb1_utilised_status';
        var UC_DISCOUNT           = 'custrecord_bb1_utilised_discount_amount';

        // Must be set per account via the script parameters below
        var DEFAULT_WRITEOFF_ITEMS    = '';
        var DEFAULT_RECOVERY_ITEMS    = '';

        // 1182 = E301 Variable Expenses : Bad Debts, 1314 = I060 Bad Debts Recovered
        var DEFAULT_WRITEOFF_ACCOUNTS = '1182';
        var DEFAULT_RECOVERY_ACCOUNTS = '1314';

        var PARAM_WRITEOFF_ITEMS  = 'custscript_bb1_qpg_prebill_bdwoitems_su';
        var PARAM_RECOVERY_ITEMS  = 'custscript_bb1_qpg_prebill_bdrecitems_su';
        var PARAM_WRITEOFF_ACCTS  = 'custscript_bb1_qpg_prebill_bdaccts_su';
        var PARAM_RECOVERY_ACCTS  = 'custscript_bb1_qpg_prebill_bdrecaccts_su';
        var PARAM_ALLOC_PREFIX    = 'custscript_bb1_qpg_prebill_allocpfx_su';
        var PARAM_MAX_TENANTS     = 'custscript_bb1_qpg_prebill_maxtenant_su';
        var PARAM_PAGE_SIZE       = 'custscript_bb1_qpg_prebill_pagesize_su';

        var BUCKET_CHARGES        = 'charges';
        var BUCKET_RECEIPTS       = 'receipts';
        var BUCKET_CREDITS        = 'credits';
        var BUCKET_WRITEOFF       = 'writeoff';
        var BUCKET_RECOVERY       = 'recovery';
        var BUCKET_OTHER          = 'other';

        var LIB_FX = {};

        //-----------------------------------------------
        //Criteria
        //-----------------------------------------------
        function readFilters(request) {

            var filters = {};

            filters.propertyId    = request.parameters.custparam_property;
            filters.customerId    = request.parameters.custparam_customer;
            filters.portfolioIds  = parseIdList(request.parameters.custparam_portfolio);
            filters.accommTypeIds = parseIdList(request.parameters.custparam_accommtype);
            filters.toPeriod      = request.parameters.custparam_toperiod;
            filters.periodCount   = request.parameters.custparam_periods;
            filters.mode          = request.parameters.custparam_mode;
            filters.showZero      = request.parameters.custparam_showzero === 'T';
            filters.showAnalysis  = request.parameters.custparam_analysis !== 'F';
            filters.showLines     = request.parameters.custparam_lines !== 'F';
            filters.view          = request.parameters.custparam_view;
            filters.variancesOnly = request.parameters.custparam_varonly === 'T';

            if (!filters.view) {
                filters.view = 'detail';
            }

            if (!filters.mode) {
                filters.mode = 'screen';
            }

            // Screen output is paged. PDF and CSV ignore this and take the lot.
            filters.page = parseInt(request.parameters.custparam_page, 10);

            if (isNaN(filters.page) || filters.page < 1) {
                filters.page = 1;
            }

            // Percentage below which a movement is treated as noise. Zero means
            // every difference is flagged.
            filters.tolerancePct = parseFloat(request.parameters.custparam_tolerance);

            if (isNaN(filters.tolerancePct) || filters.tolerancePct < 0) {
                filters.tolerancePct = 0;
            }

            // Blank means the month currently being billed - one month ahead of today
            if (!filters.toPeriod) {
                filters.toPeriod = addMonths(todayYearMonth(), 1);
            }
            filters.toPeriod = normalisePeriod(filters.toPeriod);

            var count = parseInt(filters.periodCount, 10);
            if (isNaN(count) || count < 1) {
                count = DEFAULT_PERIOD_COUNT;
            }
            if (count > MAX_PERIOD_COUNT) {
                count = MAX_PERIOD_COUNT;
            }
            filters.periodCount = count;

            filters.fromPeriod = addMonths(filters.toPeriod, -(count - 1));
            filters.periods    = buildPeriodList(filters.fromPeriod, filters.toPeriod);
            filters.periodEnd  = cycleWindowEnd(filters.toPeriod);
            filters.openingBoundary = cycleWindowStart(filters.fromPeriod);

            return filters;
        }

        //-----------------------------------------------
        //Data assembly
        //-----------------------------------------------
        function buildHistory(filters) {

            var data = {};

            data.filters = filters;
            data.warnings = [];

            var tenants = getTenantDirectory(filters);

            data.totalTenants = tenants.length;
            data.pageCount    = 1;
            data.page         = 1;
            data.pageStart    = 1;

            if (filters.mode === 'screen') {

                // Only the tenants on this page are assembled, so the queries below
                // stay the size of a page rather than the whole selection
                var pageSize = getPageSize();

                data.pageCount = Math.ceil(tenants.length / pageSize);

                if (data.pageCount < 1) {
                    data.pageCount = 1;
                }

                data.page = filters.page;

                if (data.page > data.pageCount) {
                    data.page = data.pageCount;
                }

                data.pageStart = ((data.page - 1) * pageSize) + 1;

                tenants = tenants.slice(data.pageStart - 1, data.pageStart - 1 + pageSize);

            } else if (tenants.length > getMaxTenants()) {

                data.warnings.push('Showing the first ' + getMaxTenants() + ' tenants of ' +
                                   tenants.length + '. Narrow the selection or run the ' +
                                   'report per tenant to see the rest.');
                tenants = tenants.slice(0, getMaxTenants());
            }

            data.pageTenants = tenants.length;

            // One PDF header, so one subsidiary logo - resolved from the tenants that
            // will actually appear, before any of them are dropped for no activity
            data.subsidiaryLogo = resolveReportSubsidiary(tenants, data.warnings);

            if (!tenants.length) {
                data.tenants = [];
                return data;
            }

            var customerIds = [];
            var tenantsById = {};

            for (var i = 0; i < tenants.length; i++) {
                customerIds.push(tenants[i].customer_id);
                tenantsById[tenants[i].customer_id] = tenants[i];
            }

            var openings = getOpeningBalances(customerIds, filters.openingBoundary);
            var activity = getActivity(customerIds, filters);

            var invoiceIds = [];
            for (var j = 0; j < activity.length; j++) {
                if (activity[j].transaction_type_code === 'CustInvc') {
                    invoiceIds.push(activity[j].transaction_id);
                }
            }

            // Only queried when the account parameters are configured
            if (hasAccountClassification()) {
                decorateOffsetAccounts(activity);
            }

            var lines = [];
            var linesByTransaction = {};

            if (filters.showLines && invoiceIds.length) {
                lines = getInvoiceLines(invoiceIds);

                for (var k = 0; k < lines.length; k++) {
                    var line = lines[k];
                    if (!linesByTransaction[line.transaction_id]) {
                        linesByTransaction[line.transaction_id] = [];
                    }
                    linesByTransaction[line.transaction_id].push(line);
                }
            }

            var utilised = {};
            if (filters.showAnalysis && invoiceIds.length) {
                utilised = getUtilisedCharges(invoiceIds);
            }

            data.tenants = assembleTenants(tenantsById, customerIds, openings, activity,
                                           linesByTransaction, utilised, filters);

            log.debug('Row counts', 'tenants ' + tenants.length +
                                    ', activity ' + activity.length +
                                    ', invoice lines ' + lines.length +
                                    ', reported ' + data.tenants.length);

            if (tenants.length && !data.tenants.length) {
                data.warnings.push(tenants.length + ' tenants matched the selection but none had ' +
                                   'activity or a balance in periods ' +
                                   compactPeriod(filters.fromPeriod) + ' to ' +
                                   compactPeriod(filters.toPeriod) + '. ' +
                                   'Tick "Include Tenants With No Activity" to list them anyway.');
            }

            data.summary = summariseAll(data.tenants);

            return data;
        }

        //-----------------------------------------------
        //Tenant directory - property/unit come from the
        //most recent invoice per tenant (ROW_NUMBER)
        //-----------------------------------------------
        function getTenantDirectory(filters) {

            var where = " WHERE t.type = 'CustInvc' " +
                        "   AND t.voided = 'F' " +
                        "   AND t.trandate <= " + sqlDate(filters.periodEnd) + " ";

            // All four criteria combine (AND) - e.g. Property + Portfolio + Accommodation
            // Type + Tenant together narrows to that tenant's history for that property,
            // aligned to the portfolio/accommodation type selected
            if (filters.customerId) {
                where += " AND t.entity = " + assertId(filters.customerId) + " ";
            }

            if (filters.propertyId) {
                where += " AND t.cseg_bb1_building = " + assertId(filters.propertyId) + " ";
            }

            if (filters.portfolioIds && filters.portfolioIds.length) {
                where += " AND t.cseg_bb1_building IN ( " +
                         "SELECT id FROM " + BUILDING_RECORD + " " +
                         "WHERE " + BUILDING_PORTFOLIO + " IN (" + assertIdList(filters.portfolioIds) + ") " +
                         ") ";
            }

            if (filters.accommTypeIds && filters.accommTypeIds.length) {
                where += " AND t.cseg_bb1_unit IN ( " +
                         "SELECT id FROM " + UNIT_RECORD + " " +
                         "WHERE " + UNIT_ACCOMM_TYPE + " IN (" + assertIdList(filters.accommTypeIds) + ") " +
                         ") ";
            }

            var sql =
                "SELECT " +
                "    x.customer_id, " +
                "    x.customer_name, " +
                "    x.property, " +
                "    x.unit_no, " +
                "    x.currency_symbol, " +
                "    x.subsidiary_id " +
                "FROM ( " +
                "    SELECT " +
                "        t.entity                                 AS customer_id, " +
                "        BUILTIN.DF(t.entity)                     AS customer_name, " +
                "        BUILTIN.DF(t.cseg_bb1_building)          AS property, " +
                "        BUILTIN.DF(t.cseg_bb1_unit)              AS unit_no, " +
                "        t.custbody_alf_currency_symbol           AS currency_symbol, " +
                "        c.subsidiary                             AS subsidiary_id, " +
                "        ROW_NUMBER() OVER (PARTITION BY t.entity " +
                "                           ORDER BY t.trandate DESC, t.id DESC) AS rn " +
                "    FROM transaction t " +
                "    LEFT JOIN customer c ON c.id = t.entity " +
                where +
                ") x " +
                "WHERE x.rn = 1 " +
                "ORDER BY x.property, x.customer_name";

            return runQuery(sql, 'Tenant directory');
        }

        //-----------------------------------------------
        //Subsidiary logo for the PDF header - the report
        //has one header, so one subsidiary is picked even
        //when a Property/Portfolio run spans several
        //-----------------------------------------------
        function resolveReportSubsidiary(tenants, warnings) {

            if (!tenants.length) {
                return null;
            }

            var subsidiaryId = tenants[0].subsidiary_id;
            var mixed        = false;

            for (var i = 1; i < tenants.length; i++) {
                if (tenants[i].subsidiary_id !== subsidiaryId) {
                    mixed = true;
                    break;
                }
            }

            if (mixed) {
                warnings.push('Selection spans more than one subsidiary - the header logo ' +
                              'shown belongs to the first tenant only.');
            }

            return getSubsidiaryLogo(subsidiaryId, warnings);
        }

        // record.load rather than search.lookupFields - the Subsidiary Logo (Forms)
        // field is an image-select field whose value search.lookupFields does not
        // return in the usual {value,text} shape, but getValue() does reliably
        function getSubsidiaryLogo(subsidiaryId, warnings) {

            if (!subsidiaryId) {
                return null;
            }

            try {

                var subsidiaryRecord = record.load({ type: 'subsidiary', id: subsidiaryId });
                var logoFileId       = subsidiaryRecord.getValue({ fieldId: 'logo' });

                if (!logoFileId) {
                    return null;
                }

                var logoFile = file.load({ id: logoFileId });
                var contents = logoFile.getContents();

                // BFO does not reliably auto-scale an <img> from one dimension alone, so
                // the logo's real pixel size is read from the file and explicitly fitted
                // into the header box, preserving its aspect ratio
                var bytes   = base64ToBytes(contents);
                var natural = imageDimensions(logoFile.fileType, bytes);
                var box     = fitLogoBox(natural);

                return {
                    dataUri: 'data:' + logoMimeType(logoFile.fileType) + ';base64,' + contents,
                    width:   box.width,
                    height:  box.height
                };

            } catch (e) {
                // Surfaced as a report warning, not just the execution log, so a
                // missing/inaccessible logo is diagnosable without blocking the report
                log.error('Subsidiary logo fetch failed', e);
                warnings.push('The subsidiary logo could not be loaded (' + e.message +
                              ') - the report header is shown without it.');
                return null;
            }
        }

        // The Subsidiary Logo (Forms) field only accepts JPG/GIF, PNG covered defensively
        function logoMimeType(fileType) {

            if (fileType === file.Type.GIFIMAGE) {
                return 'image/gif';
            }

            if (fileType === file.Type.PNGIMAGE) {
                return 'image/png';
            }

            return 'image/jpeg';
        }

        // Scales the logo's natural pixel size down to fit the header box, without
        // ever upscaling a small logo past its own size
        function fitLogoBox(natural) {

            if (!natural || !natural.width || !natural.height) {
                return { width: LOGO_MAX_WIDTH, height: LOGO_MAX_HEIGHT };
            }

            var scale = Math.min(LOGO_MAX_WIDTH / natural.width, LOGO_MAX_HEIGHT / natural.height, 1);

            return {
                width:  Math.round(natural.width * scale),
                height: Math.round(natural.height * scale)
            };
        }

        // Dispatches to the right header parser for the pixel dimensions - returns
        // null (falls back to the default box) rather than failing the report
        function imageDimensions(fileType, bytes) {

            try {

                if (fileType === file.Type.GIFIMAGE) {
                    return gifDimensions(bytes);
                }

                if (fileType === file.Type.PNGIMAGE) {
                    return pngDimensions(bytes);
                }

                return jpegDimensions(bytes);

            } catch (e) {
                log.error('Logo dimension parse failed', e);
                return null;
            }
        }

        // GIF87a/GIF89a: width/height are little-endian uint16 at bytes 6-9
        function gifDimensions(bytes) {

            return {
                width:  bytes[6] | (bytes[7] << 8),
                height: bytes[8] | (bytes[9] << 8)
            };
        }

        // PNG: width/height are big-endian uint32 at bytes 16-23, inside the
        // mandatory-first IHDR chunk
        function pngDimensions(bytes) {

            return {
                width:  ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0,
                height: ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0
            };
        }

        // JPEG: walk the marker segments to the first SOF marker, which carries the
        // pixel height/width as big-endian uint16 values
        function jpegDimensions(bytes) {

            var offset = 2;

            while (offset < bytes.length - 1) {

                if (bytes[offset] !== 0xFF) {
                    offset++;
                    continue;
                }

                var marker = bytes[offset + 1];

                // Markers with no length/payload of their own
                if (marker === 0xD8 || marker === 0xD9 || marker === 0x01 ||
                    (marker >= 0xD0 && marker <= 0xD7)) {
                    offset += 2;
                    continue;
                }

                var segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
                var isSofMarker   = marker >= 0xC0 && marker <= 0xCF &&
                                    marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;

                if (isSofMarker) {
                    return {
                        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
                        width:  (bytes[offset + 7] << 8) | bytes[offset + 8]
                    };
                }

                offset += 2 + segmentLength;
            }

            return null;
        }

        var BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

        // Manual decode - N/file has no binary byte accessor, only base64 text, and
        // the image dimension parsers need the raw bytes
        function base64ToBytes(base64) {

            var clean = String(base64).replace(/[\r\n]/g, '');
            var bytes = [];

            for (var i = 0; i < clean.length; i += 4) {

                var c0 = BASE64_CHARS.indexOf(clean.charAt(i));
                var c1 = BASE64_CHARS.indexOf(clean.charAt(i + 1));
                var c2 = BASE64_CHARS.indexOf(clean.charAt(i + 2));
                var c3 = BASE64_CHARS.indexOf(clean.charAt(i + 3));

                if (c0 === -1 || c1 === -1) {
                    break;
                }

                bytes.push((c0 << 2) | (c1 >> 4));

                if (c2 !== -1) {
                    bytes.push(((c1 & 0x0F) << 4) | (c2 >> 2));
                }

                if (c3 !== -1) {
                    bytes.push(((c2 & 0x03) << 6) | c3);
                }
            }

            return bytes;
        }

        //-----------------------------------------------
        //Opening balances - everything before the first
        //period shown, aggregated
        //-----------------------------------------------
        function getOpeningBalances(customerIds, openingBoundary) {

            var openings = {};
            var chunks   = chunkIds(customerIds);

            for (var i = 0; i < chunks.length; i++) {

                var sql =
                    "SELECT " +
                    "    NVL(tl.entity, t.entity)   AS customer_id, " +
                    "    NVL(SUM(tal.amount), 0)    AS opening_balance " +
                    "FROM transaction t " +
                    "JOIN transactionline tl " +
                    "       ON tl.transaction = t.id " +
                    "JOIN transactionaccountingline tal " +
                    "       ON tal.transaction = t.id " +
                    "      AND tal.transactionline = tl.id " +
                    "JOIN account a " +
                    "       ON a.id = tal.account " +
                    "WHERE a.accttype = '" + AR_ACCOUNT_TYPE + "' " +
                    "  AND tal.posting = 'T' " +
                    "  AND t.voided = 'F' " +
                    "  AND t.trandate < " + sqlDate(openingBoundary) + " " +
                    "  AND NVL(tl.entity, t.entity) IN (" + chunks[i] + ") " +
                    "GROUP BY NVL(tl.entity, t.entity)";

                var rows = runQuery(sql, 'Opening balances');

                for (var j = 0; j < rows.length; j++) {
                    openings[rows[j].customer_id] = toNumber(rows[j].opening_balance);
                }
            }

            return openings;
        }

        //-----------------------------------------------
        //Settlement and charge activity - transaction
        //level, every AR posting in the window
        //-----------------------------------------------
        function getActivity(customerIds, filters) {

            var activity = [];
            var chunks   = chunkIds(customerIds);

            for (var i = 0; i < chunks.length; i++) {

                var sql =
                    "SELECT " +
                    "    t.id                        AS transaction_id, " +
                    "    NVL(tl.entity, t.entity)    AS customer_id, " +
                    "    t.type                      AS transaction_type_code, " +
                    "    BUILTIN.DF(t.type)          AS transaction_type, " +
                    "    t.tranid                    AS document_number, " +
                    "    TO_CHAR(t.trandate, '" + SQL_DATE_MASK + "') AS transaction_date, " +
                    "    t.memo                      AS memo, " +
                    "    SUM(tal.amount)             AS amount " +
                    "FROM transaction t " +
                    "JOIN transactionline tl " +
                    "       ON tl.transaction = t.id " +
                    "JOIN transactionaccountingline tal " +
                    "       ON tal.transaction = t.id " +
                    "      AND tal.transactionline = tl.id " +
                    "JOIN account a " +
                    "       ON a.id = tal.account " +
                    "WHERE a.accttype = '" + AR_ACCOUNT_TYPE + "' " +
                    "  AND tal.posting = 'T' " +
                    "  AND t.voided = 'F' " +
                    "  AND t.trandate >= " + sqlDate(filters.openingBoundary) + " " +
                    "  AND t.trandate <= " + sqlDate(filters.periodEnd) + " " +
                    "  AND NVL(tl.entity, t.entity) IN (" + chunks[i] + ") " +
                    "GROUP BY t.id, NVL(tl.entity, t.entity), t.type, BUILTIN.DF(t.type), " +
                    "         t.tranid, t.trandate, t.memo " +
                    "ORDER BY t.trandate, t.id";

                var rows = runQuery(sql, 'Activity');

                for (var j = 0; j < rows.length; j++) {
                    activity.push(rows[j]);
                }
            }

            return activity;
        }

        //-----------------------------------------------
        //Invoice item lines - post negative against
        //income, so amounts are negated for display
        //-----------------------------------------------
        function getInvoiceLines(invoiceIds) {

            var lines  = [];
            var chunks = chunkIds(invoiceIds);

            for (var i = 0; i < chunks.length; i++) {

                var sql =
                    "SELECT " +
                    "    t.id                             AS transaction_id, " +
                    "    TO_CHAR(t.trandate, '" + SQL_DATE_MASK + "') AS transaction_date, " +
                    "    tl.linesequencenumber            AS line_sequence, " +
                    "    tl.item                          AS item_id, " +
                    "    i.itemid                         AS allocation, " +
                    "    tl.memo                          AS remarks, " +
                    "    -tl.quantity                     AS quantity, " +
                    "    tl.rate                          AS rate, " +
                    "    -tl.foreignamount                AS exclusive, " +
                    "    -tl.tax1amt                      AS tax, " +
                    "    -(tl.foreignamount + tl.tax1amt) AS inclusive " +
                    "FROM transaction t " +
                    "JOIN transactionline tl ON tl.transaction = t.id " +
                    "LEFT JOIN item i        ON i.id = tl.item " +
                    "WHERE t.id IN (" + chunks[i] + ") " +
                    "  AND tl.mainline = 'F' " +
                    "  AND tl.taxline = 'F' " +
                    "  AND tl.item IS NOT NULL " +
                    "ORDER BY t.trandate, t.id, tl.linesequencenumber";

                var rows = runQuery(sql, 'Invoice lines');

                for (var j = 0; j < rows.length; j++) {
                    lines.push(rows[j]);
                }
            }

            return lines;
        }

        //-----------------------------------------------
        //Offsetting accounts - identifies a bad debt
        //journal from the non-AR side of its posting
        //-----------------------------------------------
        function getOffsetAccounts(transactionIds) {

            var offsets = {};
            var chunks  = chunkIds(transactionIds);

            for (var i = 0; i < chunks.length; i++) {

                var sql =
                    "SELECT " +
                    "    tal.transaction          AS transaction_id, " +
                    "    tal.account              AS account_id, " +
                    "    BUILTIN.DF(tal.account)  AS account_name " +
                    "FROM transactionaccountingline tal " +
                    "JOIN account a " +
                    "       ON a.id = tal.account " +
                    "WHERE tal.transaction IN (" + chunks[i] + ") " +
                    "  AND tal.posting = 'T' " +
                    "  AND a.accttype <> '" + AR_ACCOUNT_TYPE + "' " +
                    "GROUP BY tal.transaction, tal.account, BUILTIN.DF(tal.account)";

                var rows = runQuery(sql, 'Offset accounts');

                for (var j = 0; j < rows.length; j++) {

                    if (!offsets[rows[j].transaction_id]) {
                        offsets[rows[j].transaction_id] = [];
                    }

                    offsets[rows[j].transaction_id].push({
                        account_id:   rows[j].account_id,
                        account_name: rows[j].account_name
                    });
                }
            }

            return offsets;
        }

        //-----------------------------------------------
        //Utilised Charge classification, keyed invoice|item
        //-----------------------------------------------
        function getUtilisedCharges(invoiceIds) {

            var utilised = {};
            var chunks   = chunkIds(invoiceIds);

            for (var i = 0; i < chunks.length; i++) {

                var sql =
                    "SELECT " +
                    "    uc." + UC_INVOICE + "                  AS invoice_id, " +
                    "    uc." + UC_ITEM + "                      AS item_id, " +
                    "    BUILTIN.DF(uc." + UC_TYPE + ")          AS charge_type, " +
                    "    BUILTIN.DF(uc." + UC_STATUS + ")        AS charge_status, " +
                    "    NVL(SUM(uc." + UC_DISCOUNT + "), 0)     AS discount_amount " +
                    "FROM " + UC_RECORD + " uc " +
                    "WHERE uc." + UC_INVOICE + " IN (" + chunks[i] + ") " +
                    "  AND uc.isinactive = 'F' " +
                    "GROUP BY uc." + UC_INVOICE + ", uc." + UC_ITEM + ", " +
                    "         BUILTIN.DF(uc." + UC_TYPE + "), BUILTIN.DF(uc." + UC_STATUS + ")";

                var rows = runQuery(sql, 'Utilised charges');

                for (var j = 0; j < rows.length; j++) {

                    var utilisedKey = rows[j].invoice_id + '|' + rows[j].item_id;

                    // Several charges can share an invoice+item; trusted only while
                    // every contributor agrees on the classification
                    if (!utilised[utilisedKey]) {
                        utilised[utilisedKey] = {
                            charge_type:     rows[j].charge_type,
                            charge_status:   rows[j].charge_status,
                            discount_amount: 0
                        };
                    }

                    if (utilised[utilisedKey].charge_type != rows[j].charge_type) {
                        utilised[utilisedKey].charge_type = 'Mixed';
                    }

                    utilised[utilisedKey].discount_amount += toNumber(rows[j].discount_amount);
                }
            }

            return utilised;
        }

        //-----------------------------------------------
        //Period assembly - in-memory only, no queries
        //-----------------------------------------------
        function assembleTenants(tenantsById, customerIds, openings, activity,
                                 linesByTransaction, utilised, filters) {

            var activityByTenant = {};

            for (var i = 0; i < activity.length; i++) {

                var transaction = activity[i];
                var period      = periodOf(transaction.transaction_date);

                if (!activityByTenant[transaction.customer_id]) {
                    activityByTenant[transaction.customer_id] = {};
                }

                var tenantActivity = activityByTenant[transaction.customer_id];

                if (!tenantActivity[period]) {
                    tenantActivity[period] = [];
                }

                transaction.period = period;
                tenantActivity[period].push(transaction);
            }

            var tenants = [];

            for (var j = 0; j < customerIds.length; j++) {

                var customerId = customerIds[j];
                var tenant     = tenantsById[customerId];

                tenant.periods = [];
                tenant.movement = newMovement();

                var running = toNumber(openings[customerId]);
                var tenantRows = activityByTenant[customerId];

                if (!tenantRows) {
                    tenantRows = {};
                }

                running += foldEarlyPeriods(tenantRows, filters, linesByTransaction);

                tenant.opening = running;

                var hasActivity = false;

                for (var m = 0; m < filters.periods.length; m++) {

                    var periodKey   = filters.periods[m];
                    var periodRows  = tenantRows[periodKey];
                    var periodBlock = buildPeriodBlock(periodKey, periodRows, running,
                                                       linesByTransaction, utilised, tenant);

                    running = periodBlock.closing;

                    if (periodBlock.rows.length) {
                        hasActivity = true;
                    }

                    tenant.periods.push(periodBlock);
                    addMovement(tenant.movement, periodBlock.movement);
                }

                tenant.closing = running;

                if (hasActivity || filters.showZero || Math.abs(running) > RECONCILE_TOLERANCE) {
                    tenants.push(tenant);
                }
            }

            return tenants;
        }

        // Folds anything earlier than the reporting window into the opening balance
        function foldEarlyPeriods(tenantRows, filters, linesByTransaction) {

            var folded = 0;

            for (var periodKey in tenantRows) {

                if (periodKey >= filters.fromPeriod) {
                    continue;
                }

                var rows = tenantRows[periodKey];

                for (var i = 0; i < rows.length; i++) {
                    folded += movementAmount(rows[i], linesByTransaction);
                }

                delete tenantRows[periodKey];
            }

            return folded;
        }

        function buildPeriodBlock(periodKey, periodRows, opening, linesByTransaction, utilised, tenant) {

            var block = {};

            block.period      = periodKey;
            block.periodLabel = compactPeriod(periodKey);
            block.monthLabel  = monthLabel(periodKey);
            block.opening     = opening;
            block.rows        = [];
            block.exclusive   = 0;
            block.tax         = 0;
            block.inclusive   = 0;
            block.movement    = newMovement();

            if (!periodRows) {
                block.closing = opening;
                return block;
            }

            for (var i = 0; i < periodRows.length; i++) {

                var transaction = periodRows[i];
                var lines       = linesByTransaction[transaction.transaction_id];

                // MRI suppresses the invoice header and prints its item lines instead
                if (lines && lines.length) {
                    appendLineRows(block, transaction, lines, utilised);
                } else {
                    appendTransactionRow(block, transaction);
                }
            }

            block.closing = opening + block.inclusive;

            return block;
        }

        function appendLineRows(block, transaction, lines, utilised) {

            var lineTotal = 0;

            for (var i = 0; i < lines.length; i++) {

                var line         = lines[i];
                var utilisedKey  = transaction.transaction_id + '|' + line.item_id;
                var row          = {};

                row.transaction_id = transaction.transaction_id;
                row.item_id        = line.item_id;
                row.date           = line.transaction_date;
                row.document       = '';
                row.allocation     = cleanAllocation(line.allocation);
                row.remarks        = line.remarks;
                row.rate           = toNumber(line.rate);
                row.exclusive      = toNumber(line.exclusive);
                row.tax            = toNumber(line.tax);
                row.inclusive      = toNumber(line.inclusive);
                row.charge_type    = '';
                row.charge_status  = '';
                row.discount       = 0;
                row.detail         = true;

                // Only the first line carries the document number, matching MRI
                if (i === 0) {
                    row.document = transaction.document_number;
                }

                if (utilised[utilisedKey]) {
                    row.charge_type   = utilised[utilisedKey].charge_type;
                    row.charge_status = utilised[utilisedKey].charge_status;
                    row.discount      = utilised[utilisedKey].discount_amount;
                }

                row.bucket = classifyLine(row, transaction);

                lineTotal += row.inclusive;

                block.rows.push(row);
                block.exclusive += row.exclusive;
                block.tax       += row.tax;
                block.inclusive += row.inclusive;

                addBucket(block.movement, row.bucket, row.inclusive, row.discount);
            }

            // Item lines not reconciling to the invoice's AR posting get their own row
            var variance = toNumber(transaction.amount) - lineTotal;

            if (Math.abs(variance) > RECONCILE_TOLERANCE) {

                var balancingRow = {};
                balancingRow.transaction_id = transaction.transaction_id;
                balancingRow.date           = transaction.transaction_date;
                balancingRow.document       = transaction.document_number;
                balancingRow.allocation     = 'Other Charges';
                balancingRow.remarks        = 'Posted to AR but not itemised';
                balancingRow.exclusive      = variance;
                balancingRow.tax            = 0;
                balancingRow.inclusive      = variance;
                balancingRow.charge_type    = '';
                balancingRow.charge_status  = '';
                balancingRow.discount       = 0;
                balancingRow.detail         = true;
                balancingRow.bucket         = BUCKET_OTHER;

                block.rows.push(balancingRow);
                block.exclusive += variance;
                block.inclusive += variance;

                addBucket(block.movement, BUCKET_OTHER, variance, 0);

                log.debug('Invoice line variance', 'transaction ' + transaction.transaction_id +
                                                   ' variance ' + variance);
            }
        }

        function appendTransactionRow(block, transaction) {

            var row = {};

            row.transaction_id = transaction.transaction_id;
            row.date           = transaction.transaction_date;
            row.document       = transaction.document_number;
            row.allocation     = transaction.transaction_type;
            row.remarks        = transaction.memo;
            row.exclusive      = 0;
            row.tax            = 0;
            row.inclusive      = toNumber(transaction.amount);
            row.charge_type    = '';
            row.charge_status  = '';
            row.discount       = 0;
            row.detail         = false;

            if (transaction.transaction_type_code !== 'CustPymt') {
                row.exclusive = row.inclusive;
            }

            row.bucket = classifyTransaction(transaction);

            if (transaction.offset_label) {
                row.allocation = transaction.offset_label;
            }

            block.rows.push(row);
            block.exclusive += row.exclusive;
            block.inclusive += row.inclusive;

            addBucket(block.movement, row.bucket, row.inclusive, 0);
        }

        //-----------------------------------------------
        //Classification
        //-----------------------------------------------
        function classifyLine(row, transaction) {

            var writeOffItems = getIdMap(PARAM_WRITEOFF_ITEMS, DEFAULT_WRITEOFF_ITEMS);
            var recoveryItems = getIdMap(PARAM_RECOVERY_ITEMS, DEFAULT_RECOVERY_ITEMS);
            var itemKey       = String(row.item_id);

            if (writeOffItems[itemKey]) {
                return BUCKET_WRITEOFF;
            }

            if (recoveryItems[itemKey]) {
                return BUCKET_RECOVERY;
            }

            var chargeType = String(row.charge_type).toLowerCase();

            if (chargeType.indexOf('write') !== -1 || chargeType.indexOf('bad debt') !== -1) {
                return BUCKET_WRITEOFF;
            }

            if (chargeType.indexOf('recover') !== -1) {
                return BUCKET_RECOVERY;
            }

            if (transaction.transaction_type_code === 'CustCred') {
                return BUCKET_CREDITS;
            }

            return BUCKET_CHARGES;
        }

        function decorateOffsetAccounts(activity) {

            var settlementIds = [];

            for (var i = 0; i < activity.length; i++) {
                if (activity[i].transaction_type_code !== 'CustInvc') {
                    settlementIds.push(activity[i].transaction_id);
                }
            }

            if (!settlementIds.length) {
                return;
            }

            var offsets = getOffsetAccounts(settlementIds);

            for (var j = 0; j < activity.length; j++) {
                activity[j].offset_accounts = offsets[activity[j].transaction_id];
            }
        }

        // A journal writing off to Bad Debts credits AR and debits that expense - the
        // AR leg alone says nothing, hence matching against the contra account
        function classifyByOffsetAccount(transaction) {

            if (!transaction.offset_accounts) {
                return '';
            }

            var writeOffAccounts = getIdMap(PARAM_WRITEOFF_ACCTS, DEFAULT_WRITEOFF_ACCOUNTS);
            var recoveryAccounts = getIdMap(PARAM_RECOVERY_ACCTS, DEFAULT_RECOVERY_ACCOUNTS);

            for (var i = 0; i < transaction.offset_accounts.length; i++) {

                var offset     = transaction.offset_accounts[i];
                var accountKey = String(offset.account_id);

                if (recoveryAccounts[accountKey]) {
                    transaction.offset_label = offset.account_name;
                    return BUCKET_RECOVERY;
                }

                if (writeOffAccounts[accountKey]) {

                    transaction.offset_label = offset.account_name;

                    // AR going down against this account is a write-off, up is a recovery
                    if (toNumber(transaction.amount) > 0) {
                        return BUCKET_RECOVERY;
                    }

                    return BUCKET_WRITEOFF;
                }
            }

            return '';
        }

        function hasAccountClassification() {

            var writeOffAccounts = getIdMap(PARAM_WRITEOFF_ACCTS, DEFAULT_WRITEOFF_ACCOUNTS);
            var recoveryAccounts = getIdMap(PARAM_RECOVERY_ACCTS, DEFAULT_RECOVERY_ACCOUNTS);

            if (Object.keys(writeOffAccounts).length) {
                return true;
            }

            if (Object.keys(recoveryAccounts).length) {
                return true;
            }

            return false;
        }

        function classifyTransaction(transaction) {

            // Account test runs first - a credit memo posted to bad debt is a write-off
            var offsetBucket = classifyByOffsetAccount(transaction);

            if (offsetBucket) {
                return offsetBucket;
            }

            if (transaction.transaction_type_code === 'CustPymt' ||
                transaction.transaction_type_code === 'CustDep') {
                return BUCKET_RECEIPTS;
            }

            if (transaction.transaction_type_code === 'CustCred') {
                return BUCKET_CREDITS;
            }

            if (transaction.transaction_type_code === 'CustInvc') {
                return BUCKET_CHARGES;
            }

            return BUCKET_OTHER;
        }

        function newMovement() {

            var movement = {};

            movement[BUCKET_CHARGES]  = 0;
            movement[BUCKET_RECEIPTS] = 0;
            movement[BUCKET_CREDITS]  = 0;
            movement[BUCKET_WRITEOFF] = 0;
            movement[BUCKET_RECOVERY] = 0;
            movement[BUCKET_OTHER]    = 0;
            movement.discount         = 0;

            return movement;
        }

        function addBucket(movement, bucket, amount, discount) {

            movement[bucket] += toNumber(amount);
            movement.discount += toNumber(discount);
        }

        function addMovement(target, source) {

            target[BUCKET_CHARGES]  += source[BUCKET_CHARGES];
            target[BUCKET_RECEIPTS] += source[BUCKET_RECEIPTS];
            target[BUCKET_CREDITS]  += source[BUCKET_CREDITS];
            target[BUCKET_WRITEOFF] += source[BUCKET_WRITEOFF];
            target[BUCKET_RECOVERY] += source[BUCKET_RECOVERY];
            target[BUCKET_OTHER]    += source[BUCKET_OTHER];
            target.discount         += source.discount;
        }

        // Builds the MRI-style Summary Totals page: Balance B/f, settlement and
        // charges by allocation, proving down to Balance C/f
        function summariseAll(tenants) {

            var summary = {};

            summary.movement = newMovement();
            summary.opening  = 0;
            summary.closing  = 0;
            summary.tenants  = tenants.length;

            var settlementMap = {};
            var chargeMap     = {};

            for (var i = 0; i < tenants.length; i++) {

                var tenant = tenants[i];

                summary.opening += tenant.opening;
                summary.closing += tenant.closing;
                addMovement(summary.movement, tenant.movement);

                for (var j = 0; j < tenant.periods.length; j++) {

                    var rows = tenant.periods[j].rows;

                    for (var k = 0; k < rows.length; k++) {

                        var target = chargeMap;

                        if (rows[k].bucket === BUCKET_RECEIPTS) {
                            target = settlementMap;
                        }

                        accumulateAllocation(target, rows[k]);
                    }
                }
            }

            summary.settlement      = sortAllocations(settlementMap);
            summary.charges         = sortAllocations(chargeMap);
            summary.settlementTotal = totalAllocations(summary.settlement);
            summary.chargeTotal     = totalAllocations(summary.charges);

            summary.proved  = summary.opening +
                              summary.settlementTotal.inclusive +
                              summary.chargeTotal.inclusive;
            summary.variance = summary.closing - summary.proved;

            return summary;
        }

        function accumulateAllocation(map, row) {

            var key = String(row.allocation);

            if (!key) {
                key = '(unallocated)';
            }

            if (!map[key]) {
                map[key] = { allocation: key, exclusive: 0, tax: 0, inclusive: 0 };
            }

            map[key].exclusive += toNumber(row.exclusive);
            map[key].tax       += toNumber(row.tax);
            map[key].inclusive += toNumber(row.inclusive);
        }

        function sortAllocations(map) {

            var list = [];

            for (var key in map) {
                list.push(map[key]);
            }

            list.sort(function (a, b) {

                var left  = a.allocation.toLowerCase();
                var right = b.allocation.toLowerCase();

                if (left < right) {
                    return -1;
                }

                if (left > right) {
                    return 1;
                }

                return 0;
            });

            return list;
        }

        function totalAllocations(list) {

            var total = { exclusive: 0, tax: 0, inclusive: 0 };

            for (var i = 0; i < list.length; i++) {
                total.exclusive += list[i].exclusive;
                total.tax       += list[i].tax;
                total.inclusive += list[i].inclusive;
            }

            return total;
        }

        //-----------------------------------------------
        //Billing period rules - a period is a calendar
        //month, every transaction sits in the month it is
        //dated in
        //-----------------------------------------------
        function periodOf(tranDate) {

            var text = String(tranDate).substring(0, 10);

            // A non-ISO date would silently drop the transaction off the report
            if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
                throw error.create({
                    name:    'BB1_BH_BAD_TRANDATE',
                    message: 'Expected an ISO transaction date but received "' + tranDate +
                             '". Every date column must be selected through TO_CHAR.'
                });
            }

            return text.substring(0, 7);
        }

        function cycleWindowStart(period) {
            return period + '-01';
        }

        function cycleWindowEnd(period) {
            return endOfMonth(period);
        }

        function buildPeriodList(fromPeriod, toPeriod) {

            var periods = [];
            var cursor  = fromPeriod;

            while (cursor <= toPeriod) {
                periods.push(cursor);
                cursor = addMonths(cursor, 1);
            }

            return periods;
        }

        //-----------------------------------------------
        //Period comparison
        //Layout option "Compare Periods": one row per
        //allocation, one column per period, with the
        //movement against the previous period and a flag
        //on anything new, changed, or no longer billing
        //-----------------------------------------------
        function buildComparisonGrid(periodBlocks, periodKeys, filters) {

            var index = {};
            var order = [];

            for (var i = 0; i < periodBlocks.length; i++) {

                var block = periodBlocks[i];

                for (var j = 0; j < block.rows.length; j++) {

                    var row = block.rows[j];
                    var key = String(row.allocation);

                    if (!key) {
                        key = '(unallocated)';
                    }

                    if (!index[key]) {
                        index[key] = { allocation: key, byPeriod: {}, ratesByPeriod: {} };
                        order.push(key);
                    }

                    if (!index[key].byPeriod[block.period]) {
                        index[key].byPeriod[block.period] = 0;
                    }

                    index[key].byPeriod[block.period] += toNumber(row.inclusive);

                    // Distinct unit rates behind the amount. Two lines at 500 total
                    // the same as one at 1000, so the amount alone will not show a
                    // rate that has halved.
                    if (row.rate) {

                        if (!index[key].ratesByPeriod[block.period]) {
                            index[key].ratesByPeriod[block.period] = {};
                        }

                        index[key].ratesByPeriod[block.period][toNumber(row.rate).toFixed(2)] = true;
                    }
                }
            }

            order.sort(function (a, b) {

                var left  = a.toLowerCase();
                var right = b.toLowerCase();

                if (left < right) {
                    return -1;
                }

                if (left > right) {
                    return 1;
                }

                return 0;
            });

            var grid = { rows: [], totals: [], flagged: 0, hidden: 0 };

            for (var k = 0; k < periodKeys.length; k++) {
                grid.totals.push(0);
            }

            for (var m = 0; m < order.length; m++) {

                var entry  = index[order[m]];
                var values = [];
                var rates  = [];

                for (var n = 0; n < periodKeys.length; n++) {

                    var amount = toNumber(entry.byPeriod[periodKeys[n]]);

                    values.push(amount);
                    grid.totals[n] += amount;
                    rates.push(rateKey(entry.ratesByPeriod[periodKeys[n]]));
                }

                var gridRow = { allocation: entry.allocation, values: values, rates: rates };

                decorateComparisonRow(gridRow, periodKeys, filters);

                if (gridRow.status) {
                    grid.flagged++;
                }

                grid.rows.push(gridRow);
            }

            // Totals stay the full period totals whether rows are filtered or not,
            // so a hidden row never changes the figure they foot to
            var totalsRow = { allocation: '', values: grid.totals, rates: [] };

            decorateComparisonRow(totalsRow, periodKeys, filters);

            grid.totalVariance = totalsRow.variance;

            if (filters && filters.variancesOnly) {
                grid = filterToVariances(grid);
            }

            return grid;
        }

        // Distinct rates for one allocation in one period, as a stable string
        function rateKey(rateSet) {

            if (!rateSet) {
                return '';
            }

            var rates = [];

            for (var rate in rateSet) {
                rates.push(rate);
            }

            rates.sort();

            return rates.join(' / ');
        }

        // Drop the unchanged rows, keeping a count so the report can say how
        // many it is not showing
        function filterToVariances(grid) {

            var kept = [];

            for (var i = 0; i < grid.rows.length; i++) {

                if (grid.rows[i].status) {
                    kept.push(grid.rows[i]);
                }
            }

            grid.hidden = grid.rows.length - kept.length;
            grid.rows   = kept;

            return grid;
        }

        // Detection looks across the whole window, not just the last two columns -
        // a charge that dropped in an early period and held through since shows no
        // movement month on month but is still wrong. "Not billed" is the one that
        // matters most: billed before, absent now.
        function decorateComparisonRow(row, periodKeys, filters) {

            var count = row.values.length;

            row.variance    = 0;
            row.variancePct = 0;
            row.status      = '';
            row.changedIn   = '';

            if (count < 2) {
                return;
            }

            var last         = row.values[count - 1];
            var lastIsZero   = Math.abs(last) < RECONCILE_TOLERANCE;
            var priorsZero   = true;
            var priorsDiffer = false;

            for (var i = 0; i < count - 1; i++) {

                if (Math.abs(row.values[i]) > RECONCILE_TOLERANCE) {
                    priorsZero = false;
                }

                if (Math.abs(row.values[i] - last) > RECONCILE_TOLERANCE) {
                    priorsDiffer = true;
                }
            }

            // The most recent period where the amount moved, and the level it moved
            // from - so the movement shown is the size of the change itself, even
            // when it happened two periods ago and then held
            var changeIndex = -1;

            for (var j = 1; j < count; j++) {

                if (Math.abs(row.values[j] - row.values[j - 1]) > RECONCILE_TOLERANCE) {
                    changeIndex = j;
                }
            }

            if (changeIndex > 0) {

                var baseline = row.values[changeIndex - 1];

                row.variance  = row.values[changeIndex] - baseline;
                row.changedIn = compactPeriod(periodKeys[changeIndex]);

                if (Math.abs(baseline) > RECONCILE_TOLERANCE) {
                    row.variancePct = (row.variance / Math.abs(baseline)) * 100;
                }
            }

            // Below the tolerance the movement is noise and stays unflagged
            if (withinTolerance(row, filters)) {
                return;
            }

            if (lastIsZero && !priorsZero) {
                row.status = 'Not billed';
                return;
            }

            if (priorsZero && !lastIsZero) {
                row.status = 'New';
                return;
            }

            if (priorsDiffer) {
                row.status = 'Changed';
                return;
            }

            // Amount steady but the unit rate behind it moved - a halved rate on a
            // doubled quantity nets out and would otherwise pass silently
            if (rateMoved(row)) {
                row.status = 'Rate changed';
            }
        }

        function withinTolerance(row, filters) {

            if (!filters || !filters.tolerancePct) {
                return false;
            }

            // A charge appearing or disappearing is always material, whatever the
            // tolerance is set to
            if (!row.variancePct) {
                return false;
            }

            if (Math.abs(row.variancePct) >= filters.tolerancePct) {
                return false;
            }

            return true;
        }

        // Did the set of unit rates change between the last two periods that
        // actually carried a rate?
        function rateMoved(row) {

            var populated = [];

            for (var i = 0; i < row.rates.length; i++) {

                if (row.rates[i]) {
                    populated.push(row.rates[i]);
                }
            }

            if (populated.length < 2) {
                return false;
            }

            return populated[populated.length - 1] !== populated[populated.length - 2];
        }

        // Every tenant's periods flattened into one grid, for spotting a systemic
        // miss - a charge that stopped billing across the whole selection
        function buildPortfolioGrid(tenants, periodKeys, filters) {

            var blocks = [];

            for (var i = 0; i < tenants.length; i++) {

                var periods = tenants[i].periods;

                for (var j = 0; j < periods.length; j++) {
                    blocks.push(periods[j]);
                }
            }

            return buildComparisonGrid(blocks, periodKeys, filters);
        }

        // The grid markup is valid in both the inline HTML field and the BFO
        // document, so screen and PDF share one builder
        function buildComparisonHtml(grid, periodKeys, filters) {

            var html = '';
            var i    = 0;

            html += '<table>';
            html += '<thead><tr>';
            html += '<th width="22%">Allocation</th>';

            for (i = 0; i < periodKeys.length; i++) {
                html += '<th class="num">' + escapeXml(compactPeriod(periodKeys[i])) + '</th>';
            }

            html += '<th class="num">Movement</th>';
            html += '<th class="num">%</th>';
            html += '<th>Changed In</th>';
            html += '<th>Flag</th>';
            html += '</tr></thead>';
            html += '<tbody>';

            for (i = 0; i < grid.rows.length; i++) {
                html += comparisonRowHtml(grid.rows[i], 'detail');
            }

            var totalsRow = {
                allocation:  'Total',
                values:      grid.totals,
                variance:    grid.totalVariance,
                variancePct: 0,
                changedIn:   '',
                status:      ''
            };

            html += comparisonRowHtml(totalsRow, 'total');

            // Filtering hides rows but never changes the totals, so say what is
            // missing rather than leave the two looking inconsistent
            if (grid.hidden) {
                html += '<tr class="detail"><td colspan="' + (periodKeys.length + 5) + '">' +
                        grid.hidden + ' unchanged allocation(s) hidden. Totals are the full ' +
                        'period totals.</td></tr>';
            }

            html += '</tbody></table>';

            return html;
        }

        function comparisonRowHtml(row, rowClass) {

            var html = '';

            html += '<tr class="' + rowClass + '">';
            html += '<td>' + escapeXml(row.allocation) + '</td>';

            for (var i = 0; i < row.values.length; i++) {
                html += '<td class="num">' + formatAmount(row.values[i]) + '</td>';
            }

            html += '<td class="num">' + formatAmount(row.variance) + '</td>';
            html += '<td class="num">' + formatPercent(row.variancePct) + '</td>';
            html += '<td>' + escapeXml(row.changedIn) + '</td>';
            html += '<td>' + escapeXml(row.status) + '</td>';
            html += '</tr>';

            return html;
        }

        // One decimal with a sign, blank when there is no movement
        function formatPercent(value) {

            var number = parseFloat(value);

            if (isNaN(number) || number === 0) {
                return '';
            }

            if (number > 0) {
                return '+' + number.toFixed(1) + '%';
            }

            return number.toFixed(1) + '%';
        }

        //-----------------------------------------------
        //Screen rendering (report content only)
        //-----------------------------------------------
        function buildReportHtml(data) {

            var html = '';

            html += '<style type="text/css">';
            html += '.bb1bh { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #333333; }';
            html += '.bb1bh table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }';
            html += '.bb1bh th { background-color: #eeeeee; text-align: left; padding: 4px; font-size: 10px; }';
            html += '.bb1bh td { padding: 3px 4px; border-bottom: 1px solid #ececec; }';
            html += '.bb1bh td.num, .bb1bh th.num { text-align: right; }';
            html += '.bb1bh tr.tenant td { background-color: #f3f6f9; font-weight: bold; font-size: 12px; }';
            html += '.bb1bh tr.period td { background-color: #fafafa; font-weight: bold; }';
            html += '.bb1bh tr.total td { border-top: 1px solid #999999; font-weight: bold; }';
            html += '.bb1bh tr.detail td { color: #555555; }';
            html += '.bb1bh .warn { color: #b8912f; font-weight: bold; margin-bottom: 8px; }';
            html += '.bb1bh h2 { font-size: 14px; color: #b8912f; font-weight: normal; margin: 6px 0; }';
            html += '</style>';

            html += '<div class="bb1bh">';

            for (var i = 0; i < data.warnings.length; i++) {
                html += '<div class="warn">' + escapeXml(data.warnings[i]) + '</div>';
            }

            html += '<h2>' + REPORT_TITLE + ' &ndash; ' +
                    escapeXml(compactPeriod(data.filters.fromPeriod)) + ' to ' +
                    escapeXml(compactPeriod(data.filters.toPeriod)) + '</h2>';

            html += buildPagingHtml(data);

            if (!data.tenants.length) {
                html += '<p>No tenant activity was found for the selection.</p></div>';
                return html;
            }

            html += buildSummaryHtml(data.summary);

            for (var j = 0; j < data.tenants.length; j++) {
                html += buildTenantHtml(data.tenants[j], data.filters);
            }

            if (data.filters.view === 'compare' && data.tenants.length > 1) {
                html += '<h2>All Tenants</h2>';
                html += buildComparisonHtml(buildPortfolioGrid(data.tenants, data.filters.periods, data.filters),
                                            data.filters.periods, data.filters);
            }

            html += buildSummaryTotalsHtml(data.summary);

            html += '</div>';

            return html;
        }

        // Where the reader is in the tenant list, and what the totals below cover -
        // only shown once there is more than one page to be on
        function buildPagingHtml(data) {

            if (data.pageCount < 2) {
                return '';
            }

            var pageEnd = (data.pageStart + data.pageTenants) - 1;

            var html = '';

            html += '<div class="warn">Page ' + data.page + ' of ' + data.pageCount +
                    ' &ndash; tenants ' + data.pageStart + ' to ' + pageEnd + ' of ' +
                    data.totalTenants + '. Totals on this screen cover this page only; ' +
                    'the PDF and CSV cover every tenant in the selection.</div>';

            return html;
        }

        function buildSummaryTotalsHtml(summary) {

            var html = '';

            html += '<table>';
            html += '<tr>';
            html += '<th width="55%">Summary Totals</th>';
            html += '<th class="num" width="15%">Exclusive</th>';
            html += '<th class="num" width="15%">Tax</th>';
            html += '<th class="num" width="15%">Inclusive</th>';
            html += '</tr>';

            html += summaryLineHtml('Balance B/f', '', '', summary.opening, 'total');

            html += summaryHeadingHtml('Receipts/Payments/Settlements');
            html += summaryGroupHtml(summary.settlement, summary.settlementTotal);

            html += summaryHeadingHtml('Other Charges');
            html += summaryGroupHtml(summary.charges, summary.chargeTotal);

            html += summaryLineHtml('Balance C/f', '', '', summary.closing, 'total');

            html += '</table>';

            if (Math.abs(summary.variance) > RECONCILE_TOLERANCE) {
                html += '<div class="warn">Summary does not prove: Balance C/f differs from ' +
                        'Balance B/f plus movement by ' + formatAmount(summary.variance) +
                        '. Please report this.</div>';
            }

            return html;
        }

        function summaryHeadingHtml(label) {
            return '<tr class="period"><td colspan="4">' + escapeXml(label) + '</td></tr>';
        }

        // Shared by both the HTML and BFO/XML summary tables
        function summaryGroupHtml(allocations, total) {

            var html = '';

            for (var i = 0; i < allocations.length; i++) {
                html += summaryLineHtml(allocations[i].allocation,
                                        allocations[i].exclusive,
                                        allocations[i].tax,
                                        allocations[i].inclusive,
                                        'detail');
            }

            html += summaryLineHtml('', total.exclusive, total.tax, total.inclusive, 'total');

            return html;
        }

        function summaryLineHtml(label, exclusive, tax, inclusive, rowClass) {

            var html = '';

            html += '<tr class="' + rowClass + '">';
            html += '<td>' + escapeXml(label) + '</td>';
            html += '<td class="num">' + formatAmount(exclusive) + '</td>';
            html += '<td class="num">' + formatAmount(tax) + '</td>';
            html += '<td class="num">' + formatAmount(inclusive) + '</td>';
            html += '</tr>';

            return html;
        }

        function buildSummaryHtml(summary) {

            var html = '';

            html += '<table>';
            html += '<tr><th colspan="8">Portfolio Movement</th></tr>';
            html += '<tr>';
            html += '<th class="num">Tenants</th>';
            html += '<th class="num">Opening</th>';
            html += '<th class="num">Charges</th>';
            html += '<th class="num">Receipts</th>';
            html += '<th class="num">Credits</th>';
            html += '<th class="num">Bad Debt W/Off</th>';
            html += '<th class="num">Bad Debt Recovered</th>';
            html += '<th class="num">Closing</th>';
            html += '</tr>';
            html += '<tr class="total">';
            html += '<td class="num">' + summary.tenants + '</td>';
            html += '<td class="num">' + formatAmount(summary.opening) + '</td>';
            html += '<td class="num">' + formatAmount(summary.movement[BUCKET_CHARGES]) + '</td>';
            html += '<td class="num">' + formatAmount(summary.movement[BUCKET_RECEIPTS]) + '</td>';
            html += '<td class="num">' + formatAmount(summary.movement[BUCKET_CREDITS]) + '</td>';
            html += '<td class="num">' + formatAmount(summary.movement[BUCKET_WRITEOFF]) + '</td>';
            html += '<td class="num">' + formatAmount(summary.movement[BUCKET_RECOVERY]) + '</td>';
            html += '<td class="num">' + formatAmount(summary.closing) + '</td>';
            html += '</tr>';
            html += '</table>';

            return html;
        }

        function buildTenantHtml(tenant, filters) {

            var html = '';

            html += '<table>';
            html += '<tr class="tenant"><td colspan="7">' +
                    escapeXml(tenant.property) + ' &nbsp;|&nbsp; ' +
                    escapeXml(tenant.customer_name) + ' &nbsp;|&nbsp; Unit ' +
                    escapeXml(tenant.unit_no) + '</td></tr>';
            html += '</table>';

            // Compare view replaces the transaction listing entirely
            if (filters.view === 'compare') {

                html += buildComparisonHtml(buildComparisonGrid(tenant.periods, filters.periods, filters),
                                            filters.periods, filters);

                if (filters.showAnalysis) {
                    html += buildMovementHtml(tenant);
                }

                return html;
            }

            html += '<table>';
            html += '<tr>';
            html += '<th width="10%">Date</th>';
            html += '<th width="13%">Document</th>';
            html += '<th width="17%">Allocation</th>';
            html += '<th width="24%">Remarks</th>';
            html += '<th class="num" width="12%">Exclusive</th>';
            html += '<th class="num" width="12%">Tax</th>';
            html += '<th class="num" width="12%">Inclusive</th>';
            html += '</tr>';

            for (var i = 0; i < tenant.periods.length; i++) {

                var period = tenant.periods[i];

                html += '<tr class="period">';
                html += '<td colspan="4">' + escapeXml(period.periodLabel) +
                        ' &nbsp; Balance B/f &nbsp; (' + escapeXml(period.monthLabel) + ')</td>';
                html += '<td class="num"></td><td class="num"></td>';
                html += '<td class="num">' + formatAmount(period.opening) + '</td>';
                html += '</tr>';

                for (var j = 0; j < period.rows.length; j++) {

                    var row = period.rows[j];

                    html += '<tr class="detail">';
                    html += '<td>' + escapeXml(formatDate(row.date)) + '</td>';
                    html += '<td>' + escapeXml(row.document) + '</td>';
                    html += '<td>' + escapeXml(row.allocation) + '</td>';
                    html += '<td>' + escapeXml(row.remarks) + buildTagHtml(row) + '</td>';
                    html += '<td class="num">' + formatAmount(row.exclusive) + '</td>';
                    html += '<td class="num">' + formatAmount(row.tax) + '</td>';
                    html += '<td class="num">' + formatAmount(row.inclusive) + '</td>';
                    html += '</tr>';
                }

                html += '<tr class="total">';
                html += '<td colspan="4"></td>';
                html += '<td class="num">' + formatAmount(period.exclusive) + '</td>';
                html += '<td class="num">' + formatAmount(period.tax) + '</td>';
                html += '<td class="num">' + formatAmount(period.closing) + '</td>';
                html += '</tr>';
            }

            html += '</table>';

            if (filters.showAnalysis) {
                html += buildMovementHtml(tenant);
            }

            return html;
        }

        function buildTagHtml(row) {

            if (row.bucket === BUCKET_WRITEOFF) {
                return ' <b>[Bad Debt Written Off]</b>';
            }

            if (row.bucket === BUCKET_RECOVERY) {
                return ' <b>[Bad Debt Recovered]</b>';
            }

            if (row.discount) {
                return ' <i>[Discount ' + formatAmount(row.discount) + ']</i>';
            }

            return '';
        }

        function buildMovementHtml(tenant) {

            var html = '';

            html += '<table>';
            html += '<tr>';
            html += '<th class="num">Opening</th>';
            html += '<th class="num">Charges</th>';
            html += '<th class="num">Receipts</th>';
            html += '<th class="num">Credits</th>';
            html += '<th class="num">Bad Debt W/Off</th>';
            html += '<th class="num">Bad Debt Recovered</th>';
            html += '<th class="num">Discounts</th>';
            html += '<th class="num">Other</th>';
            html += '<th class="num">Closing</th>';
            html += '</tr>';
            html += '<tr class="total">';
            html += '<td class="num">' + formatAmount(tenant.opening) + '</td>';
            html += '<td class="num">' + formatAmount(tenant.movement[BUCKET_CHARGES]) + '</td>';
            html += '<td class="num">' + formatAmount(tenant.movement[BUCKET_RECEIPTS]) + '</td>';
            html += '<td class="num">' + formatAmount(tenant.movement[BUCKET_CREDITS]) + '</td>';
            html += '<td class="num">' + formatAmount(tenant.movement[BUCKET_WRITEOFF]) + '</td>';
            html += '<td class="num">' + formatAmount(tenant.movement[BUCKET_RECOVERY]) + '</td>';
            html += '<td class="num">' + formatAmount(tenant.movement.discount) + '</td>';
            html += '<td class="num">' + formatAmount(tenant.movement[BUCKET_OTHER]) + '</td>';
            html += '<td class="num">' + formatAmount(tenant.closing) + '</td>';
            html += '</tr>';
            html += '</table>';

            return html;
        }

        //-----------------------------------------------
        //PDF rendering
        //-----------------------------------------------
        function renderPdf(response, data) {

            var rowCount = countRows(data);

            log.debug('PDF size', 'tenants ' + data.tenants.length + ', rows ' + rowCount);

            if (rowCount > MAX_PDF_ROWS) {
                throw error.create({
                    name:    'BB1_BH_PDF_TOO_LARGE',
                    message: 'This selection produces ' + rowCount + ' rows across ' +
                             data.tenants.length + ' tenants, which is too large to render ' +
                             'as a PDF (limit ' + MAX_PDF_ROWS + '). Narrow to fewer periods ' +
                             'or a single tenant, or use the CSV export.'
                });
            }

            try {
                var pdfFile = render.xmlToPdf({ xmlString: buildReportXml(data) });

                pdfFile.name = 'Billing_History_' +
                               compactPeriod(data.filters.fromPeriod) + '_' +
                               compactPeriod(data.filters.toPeriod) + '.pdf';

                response.writeFile({ file: pdfFile, isInline: true });

            } catch (e) {
                log.error('PDF render failed', e);
                throw error.create({
                    name:    'BB1_BH_PDF_FAILED',
                    message: 'Could not render the billing history PDF: ' + e.message
                });
            }
        }

        function countRows(data) {

            var rowCount = 0;

            for (var i = 0; i < data.tenants.length; i++) {

                var tenant = data.tenants[i];

                for (var j = 0; j < tenant.periods.length; j++) {
                    rowCount += tenant.periods[j].rows.length;
                }
            }

            return rowCount;
        }

        // Letterhead-style header repeated on every page: subsidiary logo, title and
        // period covered centred, Printed date/Page number right-aligned
        function buildHeaderBarXml(data) {

            var logo = data.subsidiaryLogo;

            var logoCell = '';
            if (logo) {
                logoCell = '<img src="' + logo.dataUri + '" style="width:' + logo.width +
                           'pt;height:' + logo.height + 'pt;"/>';
            }

            var titleText   = escapeXml(REPORT_TITLE);
            var periodText  = escapeXml(periodRangeLabel(data.filters.fromPeriod, data.filters.toPeriod));
            var printedText = escapeXml(formatDate(todayIsoDate()));

            // Matches the Tenancy Schedule report's proven header layout - inline
            // styles throughout, since a class-based stylesheet does not reliably
            // stretch/centre a nested table's cells in this renderer
            var xml = '';

            xml += '<table style="width:100%;border:0;">';
            xml += '<tr>';
            xml += '<td style="width:25%;vertical-align:middle;border:none;">' + logoCell + '</td>';
            xml += '<td style="width:45%;vertical-align:middle;border:none;">';
            xml += '<table style="width:100%;border:0;">';
            xml += '<tr><td align="center" style="text-align:center;border:none;">' +
                   '<span style="font-size:15pt;font-weight:bold;">' + titleText + '</span></td></tr>';
            xml += '<tr><td align="center" style="text-align:center;border:none;">' +
                   '<span style="font-size:9pt;font-weight:normal;">' + periodText + '</span></td></tr>';
            xml += '</table>';
            xml += '</td>';
            xml += '<td style="width:30%;text-align:right;vertical-align:middle;font-size:8pt;border:none;">' +
                   'Printed: ' + printedText + '<br/>' +
                   'Page: <pagenumber/>' +
                   '</td>';
            xml += '</tr>';
            xml += '</table>';

            return xml;
        }

        function buildReportXml(data) {

            var xml = '';

            xml += '<?xml version="1.0"?>';
            xml += '<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">';
            xml += '<pdf>';

            xml += '<head>';
            xml += '<style type="text/css">';
            xml += 'body { font-family: sans-serif; font-size: 7.5pt; color: #333333; }';
            xml += 'h1 { font-size: 13pt; color: #b8912f; font-weight: normal; }';
            xml += 'table { width: 100%; font-size: 7.5pt; }';
            xml += 'th { background-color: #eeeeee; text-align: left; padding: 3px; font-size: 7pt; }';
            xml += 'td { padding: 3px; border-bottom: 0.5px solid #ececec; }';
            xml += 'td.num, th.num { text-align: right; }';
            xml += 'tr.tenant td { background-color: #f3f6f9; font-weight: bold; border-bottom: none; }';
            xml += 'table.tenanthead { margin-top: 6pt; }';
            xml += 'table.summary { page-break-before: always; }';
            xml += 'table.tenanthead td { background-color: #f3f6f9; font-weight: bold; border-bottom: none; }';
            xml += 'tr.period td { background-color: #fafafa; font-weight: bold; }';
            xml += 'tr.total td { font-weight: bold; border-top: 0.5px solid #999999; }';
            xml += 'tr.detail td { color: #555555; }';
            xml += '.footnote { font-size: 6.5pt; color: #777777; }';
            xml += '</style>';
            xml += '<macrolist>';
            xml += '<macro id="bhheader">';
            xml += buildHeaderBarXml(data);
            xml += '</macro>';
            xml += '<macro id="bhfooter">';
            xml += '<table><tr>';
            xml += '<td class="footnote">' + escapeXml(REPORT_TITLE) +
                   ' - printed ' + escapeXml(formatDate(todayIsoDate())) + '</td>';
            xml += '<td class="footnote num">Page <pagenumber/> of <totalpages/></td>';
            xml += '</tr></table>';
            xml += '</macro>';
            xml += '</macrolist>';
            xml += '</head>';

            xml += '<body header="bhheader" header-height="90pt" ' +
                   'footer="bhfooter" footer-height="24pt" padding="0.4in" size="A4">';

            for (var i = 0; i < data.warnings.length; i++) {
                xml += '<p class="footnote">' + escapeXml(data.warnings[i]) + '</p>';
            }

            if (!data.tenants.length) {
                xml += '<p>No tenant activity was found for the selection.</p>';
                xml += '</body></pdf>';
                return xml;
            }

            for (var j = 0; j < data.tenants.length; j++) {
                xml += buildTenantXml(data.tenants[j], data.filters);
            }

            if (data.filters.view === 'compare' && data.tenants.length > 1) {
                xml += '<table class="tenanthead"><tr><td>All Tenants</td></tr></table>';
                xml += buildComparisonHtml(buildPortfolioGrid(data.tenants, data.filters.periods, data.filters),
                                           data.filters.periods, data.filters);
            }

            xml += buildSummaryTotalsXml(data.summary);

            xml += '</body></pdf>';

            return xml;
        }

        function buildSummaryTotalsXml(summary) {

            var xml = '';

            xml += '<table class="summary">';
            xml += '<thead><tr>';
            xml += '<th width="55%">Summary Totals</th>';
            xml += '<th class="num" width="15%">Exclusive</th>';
            xml += '<th class="num" width="15%">Tax</th>';
            xml += '<th class="num" width="15%">Inclusive</th>';
            xml += '</tr></thead>';
            xml += '<tbody>';

            xml += summaryLineHtml('Balance B/f', '', '', summary.opening, 'total');

            xml += summaryHeadingHtml('Receipts/Payments/Settlements');
            xml += summaryGroupHtml(summary.settlement, summary.settlementTotal);

            xml += summaryHeadingHtml('Other Charges');
            xml += summaryGroupHtml(summary.charges, summary.chargeTotal);

            xml += summaryLineHtml('Balance C/f', '', '', summary.closing, 'total');

            xml += '</tbody></table>';

            if (Math.abs(summary.variance) > RECONCILE_TOLERANCE) {
                xml += '<p class="footnote">Summary does not prove: Balance C/f differs from ' +
                       'Balance B/f plus movement by ' + formatAmount(summary.variance) + '.</p>';
            }

            return xml;
        }

        function buildTenantXml(tenant, filters) {

            var xml = '';

            // report-1.1.dtd requires thead as a table's first child - the tenant
            // heading gets its own table rather than riding as a bare row
            xml += '<table class="tenanthead"><tr><td>' +
                   escapeXml(tenant.property) + ' | ' +
                   escapeXml(tenant.customer_name) + ' | Unit ' +
                   escapeXml(tenant.unit_no) + '</td></tr></table>';

            // Compare view replaces the transaction listing entirely
            if (filters.view === 'compare') {

                xml += buildComparisonHtml(buildComparisonGrid(tenant.periods, filters.periods, filters),
                                           filters.periods, filters);

                if (filters.showAnalysis) {
                    xml += buildMovementXml(tenant);
                }

                return xml;
            }

            xml += '<table>';
            xml += '<thead><tr>';
            xml += '<th width="10%">Date</th>';
            xml += '<th width="13%">Document</th>';
            xml += '<th width="17%">Allocation</th>';
            xml += '<th width="24%">Remarks</th>';
            xml += '<th class="num" width="12%">Exclusive</th>';
            xml += '<th class="num" width="12%">Tax</th>';
            xml += '<th class="num" width="12%">Inclusive</th>';
            xml += '</tr></thead>';
            xml += '<tbody>';

            for (var i = 0; i < tenant.periods.length; i++) {

                var period = tenant.periods[i];

                xml += '<tr class="period">';
                xml += '<td colspan="4">' + escapeXml(period.periodLabel) + ' Balance B/f</td>';
                xml += '<td class="num"></td><td class="num"></td>';
                xml += '<td class="num">' + formatAmount(period.opening) + '</td>';
                xml += '</tr>';

                for (var j = 0; j < period.rows.length; j++) {

                    var row = period.rows[j];

                    xml += '<tr class="detail">';
                    xml += '<td>' + escapeXml(formatDate(row.date)) + '</td>';
                    xml += '<td>' + escapeXml(row.document) + '</td>';
                    xml += '<td>' + escapeXml(row.allocation) + '</td>';
                    xml += '<td>' + escapeXml(row.remarks) + escapeXml(buildTagText(row)) + '</td>';
                    xml += '<td class="num">' + formatAmount(row.exclusive) + '</td>';
                    xml += '<td class="num">' + formatAmount(row.tax) + '</td>';
                    xml += '<td class="num">' + formatAmount(row.inclusive) + '</td>';
                    xml += '</tr>';
                }

                xml += '<tr class="total">';
                xml += '<td colspan="4"></td>';
                xml += '<td class="num">' + formatAmount(period.exclusive) + '</td>';
                xml += '<td class="num">' + formatAmount(period.tax) + '</td>';
                xml += '<td class="num">' + formatAmount(period.closing) + '</td>';
                xml += '</tr>';
            }

            xml += '</tbody></table>';

            if (filters.showAnalysis) {
                xml += buildMovementXml(tenant);
            }

            return xml;
        }

        function buildMovementXml(tenant) {

            var xml = '';

            xml += '<table>';
            xml += '<thead><tr>';
            xml += '<th class="num">Opening</th>';
            xml += '<th class="num">Charges</th>';
            xml += '<th class="num">Receipts</th>';
            xml += '<th class="num">Credits</th>';
            xml += '<th class="num">Bad Debt W/Off</th>';
            xml += '<th class="num">Bad Debt Recovered</th>';
            xml += '<th class="num">Discounts</th>';
            xml += '<th class="num">Other</th>';
            xml += '<th class="num">Closing</th>';
            xml += '</tr></thead>';
            xml += '<tbody><tr class="total">';
            xml += '<td class="num">' + formatAmount(tenant.opening) + '</td>';
            xml += '<td class="num">' + formatAmount(tenant.movement[BUCKET_CHARGES]) + '</td>';
            xml += '<td class="num">' + formatAmount(tenant.movement[BUCKET_RECEIPTS]) + '</td>';
            xml += '<td class="num">' + formatAmount(tenant.movement[BUCKET_CREDITS]) + '</td>';
            xml += '<td class="num">' + formatAmount(tenant.movement[BUCKET_WRITEOFF]) + '</td>';
            xml += '<td class="num">' + formatAmount(tenant.movement[BUCKET_RECOVERY]) + '</td>';
            xml += '<td class="num">' + formatAmount(tenant.movement.discount) + '</td>';
            xml += '<td class="num">' + formatAmount(tenant.movement[BUCKET_OTHER]) + '</td>';
            xml += '<td class="num">' + formatAmount(tenant.closing) + '</td>';
            xml += '</tr></tbody></table>';

            return xml;
        }

        function buildTagText(row) {

            if (row.bucket === BUCKET_WRITEOFF) {
                return ' [Bad Debt Written Off]';
            }

            if (row.bucket === BUCKET_RECOVERY) {
                return ' [Bad Debt Recovered]';
            }

            return '';
        }

        //-----------------------------------------------
        //CSV rendering - flat, one row per movement line
        //-----------------------------------------------
        function renderCsv(response, data) {

            var csv = '';

            if (data.filters.view === 'compare') {
                csv = buildComparisonCsv(data);
            } else {
                csv = buildDetailCsv(data);
            }

            var csvFile = file.create({
                name:     'Billing_History_' + compactPeriod(data.filters.fromPeriod) + '_' +
                          compactPeriod(data.filters.toPeriod) + '.csv',
                fileType: file.Type.CSV,
                contents: csv
            });

            response.writeFile({ file: csvFile, isInline: false });
        }

        // One row per tenant and allocation, one column per period, so the whole
        // selection can be sorted on Flag or Movement in a spreadsheet
        function buildComparisonCsv(data) {

            var csv     = '';
            var periods = data.filters.periods;
            var header  = ['Property', 'Tenant', 'Unit', 'Allocation'];
            var i       = 0;

            for (i = 0; i < periods.length; i++) {
                header.push(compactPeriod(periods[i]));
            }

            header.push('Movement');
            header.push('Movement %');
            header.push('Changed In');
            header.push('Flag');

            csv += csvRow(header);

            for (i = 0; i < data.tenants.length; i++) {

                var tenant = data.tenants[i];
                var grid   = buildComparisonGrid(tenant.periods, periods, data.filters);

                for (var j = 0; j < grid.rows.length; j++) {
                    csv += comparisonCsvRow(tenant.property, tenant.customer_name,
                                            tenant.unit_no, grid.rows[j]);
                }

                var totalsRow = {
                    allocation:  'Total',
                    values:      grid.totals,
                    variance:    grid.totalVariance,
                    variancePct: 0,
                    changedIn:   '',
                    status:      ''
                };

                csv += comparisonCsvRow(tenant.property, tenant.customer_name,
                                        tenant.unit_no, totalsRow);
            }

            return csv;
        }

        function comparisonCsvRow(property, tenantName, unit, row) {

            var values = [property, tenantName, unit, row.allocation];

            for (var i = 0; i < row.values.length; i++) {
                values.push(row.values[i]);
            }

            values.push(row.variance);
            values.push(row.variancePct);
            values.push(row.changedIn);
            values.push(row.status);

            return csvRow(values);
        }

        function buildDetailCsv(data) {

            var csv = '';

            csv += 'Property,Tenant,Unit,Period,Date,Document,Allocation,Remarks,' +
                   'Exclusive,Tax,Inclusive,Classification,Charge Type,Charge Status,Discount\n';

            for (var i = 0; i < data.tenants.length; i++) {

                var tenant = data.tenants[i];

                for (var j = 0; j < tenant.periods.length; j++) {

                    var period = tenant.periods[j];

                    csv += csvRow([tenant.property, tenant.customer_name, tenant.unit_no,
                                   period.periodLabel, '', '', 'Balance B/f', '',
                                   '', '', period.opening, 'opening', '', '', '']);

                    for (var k = 0; k < period.rows.length; k++) {

                        var row = period.rows[k];

                        csv += csvRow([tenant.property, tenant.customer_name, tenant.unit_no,
                                       period.periodLabel, formatDate(row.date), row.document,
                                       row.allocation, row.remarks, row.exclusive, row.tax,
                                       row.inclusive, row.bucket, row.charge_type,
                                       row.charge_status, row.discount]);
                    }

                    csv += csvRow([tenant.property, tenant.customer_name, tenant.unit_no,
                                   period.periodLabel, '', '', 'Period Total', '',
                                   period.exclusive, period.tax, period.closing,
                                   'closing', '', '', '']);
                }
            }

            csv += buildSummaryCsv(data.summary);

            return csv;
        }

        function buildSummaryCsv(summary) {

            var csv = '';

            csv += summaryCsvRow('Balance B/f', 'Summary', '', '', summary.opening, 'opening');

            csv += summaryCsvSection('Receipts/Payments/Settlements',
                                     summary.settlement, summary.settlementTotal);

            csv += summaryCsvSection('Other Charges',
                                     summary.charges, summary.chargeTotal);

            csv += summaryCsvRow('Balance C/f', 'Summary', '', '', summary.closing, 'closing');

            return csv;
        }

        function summaryCsvSection(section, allocations, total) {

            var csv = '';

            for (var i = 0; i < allocations.length; i++) {
                csv += summaryCsvRow(allocations[i].allocation, section,
                                     allocations[i].exclusive, allocations[i].tax,
                                     allocations[i].inclusive, 'allocation');
            }

            csv += summaryCsvRow('Section Total', section, total.exclusive,
                                 total.tax, total.inclusive, 'subtotal');

            return csv;
        }

        function summaryCsvRow(label, section, exclusive, tax, inclusive, classification) {

            return csvRow(['SUMMARY', '', '', '', '', '', label, section,
                           exclusive, tax, inclusive, classification, '', '', '']);
        }

        function csvRow(values) {

            var cells = [];

            for (var i = 0; i < values.length; i++) {
                cells.push(csvCell(values[i]));
            }

            return cells.join(',') + '\n';
        }

        function csvCell(value) {

            if (value === null || value === undefined) {
                return '""';
            }

            return '"' + String(value).replace(/"/g, '""') + '"';
        }

        //-----------------------------------------------
        //Script parameters - cached, since the classifier
        //runs per line and getParameter is not free
        //-----------------------------------------------
        var parameterCache = {};

        function getMaxTenants() {

            var max = parseInt(runtime.getCurrentScript().getParameter(PARAM_MAX_TENANTS), 10);

            if (isNaN(max) || max < 1) {
                return MAX_TENANTS;
            }

            return max;
        }

        function getPageSize() {

            if (parameterCache.pageSize) {
                return parameterCache.pageSize;
            }

            var size = parseInt(runtime.getCurrentScript().getParameter(PARAM_PAGE_SIZE), 10);

            if (isNaN(size) || size < 1) {
                size = PAGE_SIZE;
            }

            parameterCache.pageSize = size;

            return size;
        }

        function getIdMap(parameterId, fallback) {

            if (parameterCache[parameterId]) {
                return parameterCache[parameterId];
            }

            var raw = runtime.getCurrentScript().getParameter(parameterId);

            if (!raw) {
                raw = fallback;
            }

            var map = {};

            parameterCache[parameterId] = map;

            if (!raw) {
                return map;
            }

            var ids = String(raw).split(',');

            for (var i = 0; i < ids.length; i++) {

                var id = ids[i].replace(/\s/g, '');

                if (id) {
                    map[id] = true;
                }
            }

            return map;
        }

        //-----------------------------------------------
        //SuiteQL execution
        //-----------------------------------------------
        function runQuery(sql, label) {

            try {
                return query.runSuiteQL({ query: sql }).asMappedResults();
            } catch (e) {
                // Full statement logged so it can be replayed in the query browser
                log.error('SuiteQL failed - ' + label, e);
                log.error('SuiteQL text - ' + label, sql);
                throw error.create({
                    name:    'BB1_BH_QUERY_FAILED',
                    message: label + ' query failed: ' + e.message
                });
            }
        }

        function chunkIds(ids) {

            var chunks = [];
            var buffer = [];

            for (var i = 0; i < ids.length; i++) {

                buffer.push(assertId(ids[i]));

                if (buffer.length === QUERY_CHUNK_SIZE) {
                    chunks.push(buffer.join(','));
                    buffer = [];
                }
            }

            if (buffer.length) {
                chunks.push(buffer.join(','));
            }

            return chunks;
        }

        //-----------------------------------------------
        //URL helper
        //-----------------------------------------------
        function suiteletUrl(filters) {

            var scriptUrl = url.resolveScript({
                scriptId:   runtime.getCurrentScript().id,
                deploymentId: runtime.getCurrentScript().deploymentId,
                returnExternalUrl: false
            });

            var parameters = [];

            for (var key in filters) {
                parameters.push(encodeURIComponent(key) + '=' + encodeURIComponent(filters[key]));
            }

            if (!parameters.length) {
                return scriptUrl;
            }

            return scriptUrl + '&' + parameters.join('&');
        }

        function overrideMode(filters, mode) {

            var parameters = {};

            parameters.custparam_mode      = mode;
            parameters.custparam_toperiod  = compactPeriod(filters.toPeriod);
            parameters.custparam_periods   = filters.periodCount;

            if (filters.propertyId) {
                parameters.custparam_property = filters.propertyId;
            }

            if (filters.customerId) {
                parameters.custparam_customer = filters.customerId;
            }

            if (filters.portfolioIds && filters.portfolioIds.length) {
                parameters.custparam_portfolio = filters.portfolioIds.join(',');
            }

            if (filters.accommTypeIds && filters.accommTypeIds.length) {
                parameters.custparam_accommtype = filters.accommTypeIds.join(',');
            }

            if (filters.showZero) {
                parameters.custparam_showzero = 'T';
            }

            if (!filters.showAnalysis) {
                parameters.custparam_analysis = 'F';
            }

            if (!filters.showLines) {
                parameters.custparam_lines = 'F';
            }

            if (filters.view) {
                parameters.custparam_view = filters.view;
            }

            if (filters.variancesOnly) {
                parameters.custparam_varonly = 'T';
            }

            if (filters.tolerancePct) {
                parameters.custparam_tolerance = filters.tolerancePct;
            }

            return parameters;
        }

        //-----------------------------------------------
        //Formatting and validation helpers
        //-----------------------------------------------
        function cleanAllocation(value) {

            if (!value) {
                return '';
            }

            var text     = String(value);
            var prefixes = getPrefixList();

            for (var i = 0; i < prefixes.length; i++) {

                if (text.indexOf(prefixes[i]) === 0) {
                    return text.substring(prefixes[i].length);
                }
            }

            return text;
        }

        function getPrefixList() {

            if (parameterCache.prefixes) {
                return parameterCache.prefixes;
            }

            var raw = runtime.getCurrentScript().getParameter(PARAM_ALLOC_PREFIX);

            if (!raw) {
                raw = ALLOCATION_PREFIXES;
            }

            var list  = [];
            var parts = String(raw).split(',');

            for (var i = 0; i < parts.length; i++) {

                var prefix = parts[i].trim();

                if (prefix) {
                    list.push(prefix);
                }
            }

            parameterCache.prefixes = list;

            return list;
        }

        function formatAmount(value) {

            if (value === null || value === undefined || value === '') {
                return '';
            }

            var number = parseFloat(value);

            if (isNaN(number)) {
                return '';
            }

            var fixed = number.toFixed(2);
            var parts = fixed.split('.');

            parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');

            return parts.join('.');
        }

        // ISO date shown as DD/MM/YYYY, matching MRI
        function formatDate(value) {

            if (!value) {
                return '';
            }

            var text = String(value).substring(0, 10);

            if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
                return String(value);
            }

            return text.substring(8, 10) + '/' + text.substring(5, 7) + '/' + text.substring(0, 4);
        }

        function sqlDate(value) {

            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
                throw error.create({
                    name:    'BB1_BH_BAD_DATE',
                    message: 'Rejected an invalid date value: ' + value
                });
            }

            return "TO_DATE('" + value + "', '" + SQL_DATE_MASK + "')";
        }

        function assertId(value) {

            if (!/^\d+$/.test(String(value))) {
                throw error.create({
                    name:    'BB1_BH_BAD_ID',
                    message: 'Rejected an invalid internal id: ' + value
                });
            }

            return String(value);
        }

        function assertIdList(ids) {

            var validated = [];

            for (var i = 0; i < ids.length; i++) {
                validated.push(assertId(ids[i]));
            }

            return validated.join(',');
        }

        // A native MULTISELECT form submission joins its values with the NetSuite
        // multi-value delimiter (), not a comma - the Download PDF/CSV button
        // URLs join with a comma instead, so both are accepted here
        function parseIdList(value) {

            if (!value) {
                return [];
            }

            var parts = String(value).split(/[,\u0005]/);
            var list  = [];

            for (var i = 0; i < parts.length; i++) {

                var id = parts[i].replace(/\s/g, '');

                if (id) {
                    list.push(id);
                }
            }

            return list;
        }

        // Accepts the MRI compact form (202607), YYYY-MM, or a date value from the
        // Latest Billing Period field - a date's day is accepted but ignored
        function normalisePeriod(value) {

            var text = String(value).replace(/\s/g, '');

            if (/^\d{4}-\d{2}$/.test(text)) {
                return text;
            }

            if (/^\d{6}$/.test(text)) {
                return text.substring(0, 4) + '-' + text.substring(4, 6);
            }

            var parsedDate = parseAccountDate(value);

            if (parsedDate) {
                return parsedDate.getFullYear() + '-' + padTwo(parsedDate.getMonth() + 1);
            }

            throw error.create({
                name:    'BB1_BH_BAD_PERIOD',
                message: 'Could not interpret the billing period "' + value +
                         '". Pick a date in the Latest Billing Period field, or pass the ' +
                         'MRI format, for example 202607.'
            });
        }

        // Date field values arrive per the user's NetSuite date format preference
        function parseAccountDate(value) {

            try {
                return format.parse({ value: value, type: format.Type.DATE });
            } catch (e) {
                return null;
            }
        }

        function periodToDate(yearMonth) {

            var year  = parseInt(String(yearMonth).substring(0, 4), 10);
            var month = parseInt(String(yearMonth).substring(5, 7), 10);

            return new Date(year, month - 1, 1);
        }

        function compactPeriod(yearMonth) {
            return String(yearMonth).replace('-', '');
        }

        function addMonths(yearMonth, months) {

            var year  = parseInt(String(yearMonth).substring(0, 4), 10);
            var month = parseInt(String(yearMonth).substring(5, 7), 10);

            var total    = (year * 12) + (month - 1) + months;
            var newYear  = Math.floor(total / 12);
            var newMonth = (total % 12) + 1;

            return newYear + '-' + padTwo(newMonth);
        }

        function endOfMonth(yearMonth) {

            var year  = parseInt(String(yearMonth).substring(0, 4), 10);
            var month = parseInt(String(yearMonth).substring(5, 7), 10);

            // Day 0 of the next month is the last day of this one
            var lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

            return yearMonth + '-' + padTwo(lastDay);
        }

        function monthLabel(yearMonth) {

            var year  = String(yearMonth).substring(0, 4);
            var month = parseInt(String(yearMonth).substring(5, 7), 10);

            return MONTH_NAMES[month - 1] + ' ' + year;
        }

        // 'July 2026 to October 2026', or just 'July 2026' for a single-period report
        function periodRangeLabel(fromPeriod, toPeriod) {

            if (fromPeriod === toPeriod) {
                return monthLabel(fromPeriod);
            }

            return monthLabel(fromPeriod) + ' to ' + monthLabel(toPeriod);
        }

        function todayYearMonth() {
            return todayIsoDate().substring(0, 7);
        }

        function todayIsoDate() {

            var now = new Date();

            return now.getFullYear() + '-' + padTwo(now.getMonth() + 1) + '-' + padTwo(now.getDate());
        }

        function padTwo(value) {

            if (value < 10) {
                return '0' + value;
            }

            return String(value);
        }

        function movementAmount(transaction, linesByTransaction) {

            var lines = linesByTransaction[transaction.transaction_id];

            if (!lines || !lines.length) {
                return toNumber(transaction.amount);
            }

            var total = 0;

            for (var i = 0; i < lines.length; i++) {
                total += toNumber(lines[i].inclusive);
            }

            var variance = toNumber(transaction.amount) - total;

            if (Math.abs(variance) > RECONCILE_TOLERANCE) {
                total += variance;
            }

            return total;
        }

        function toNumber(value) {

            var number = parseFloat(value);

            if (isNaN(number)) {
                return 0;
            }

            return number;
        }

        // BFO parses strict XML - an unescaped ampersand fails the render outright
        function escapeXml(value) {

            if (value === null || value === undefined) {
                return '';
            }

            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        }

        //-----------------------------------------------
        //Public surface - only what the Suitelet calls
        //-----------------------------------------------
        LIB_FX.readFilters     = readFilters;
        LIB_FX.buildHistory    = buildHistory;
        LIB_FX.buildReportHtml = buildReportHtml;
        LIB_FX.renderPdf       = renderPdf;
        LIB_FX.renderCsv       = renderCsv;
        LIB_FX.suiteletUrl     = suiteletUrl;
        LIB_FX.overrideMode    = overrideMode;
        LIB_FX.periodToDate    = periodToDate;
        LIB_FX.addMonths       = addMonths;
        LIB_FX.todayYearMonth  = todayYearMonth;

        var _CONST = {
            REPORT_TITLE:         REPORT_TITLE,
            BUILDING_RECORD:      BUILDING_RECORD,
            PORTFOLIO_LIST:       PORTFOLIO_LIST,
            ACCOMM_TYPE_LIST:     ACCOMM_TYPE_LIST,
            DEFAULT_PERIOD_COUNT: DEFAULT_PERIOD_COUNT,
            MAX_PERIOD_COUNT:     MAX_PERIOD_COUNT
        };

        return {
            LIB_FX: LIB_FX,
            _CONST: _CONST
        };

    });
