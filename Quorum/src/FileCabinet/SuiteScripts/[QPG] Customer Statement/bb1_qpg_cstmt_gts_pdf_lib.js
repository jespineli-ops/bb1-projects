/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library that queries and assembles the tenant statement data, then renders it into the
 * Generate Statement Suitelet's PDF - one merged PDF with a page per marked customer. The data layer
 * builds the header (entity/VAT/property/bank detail), AR activity rows with a running balance, invoice
 * item-line detail, and the aging summary. The render layer produces the header, statement date line,
 * AR activity table, totals block, and a Queries/aging-days strip.
 *
 * Date                 Author              Purpose
 * 03-September-2026    Jared Espineli      Initial Release - queries and assembles the statement data and renders the PDF header section.
 * 04-September-2026    Jared Espineli      Fixed address/entity field lookups, added the rest of the statement (activity table, totals, aging), and split PDF generation to run per customer in the background.
 * 07-September-2026    Jared Espineli      Folded gts_data_lib.js into this file and extracted buildCustomerStatement so all statement data and rendering logic live in one library.
 * 08-September-2026    Jared Espineli      Bolded key totals/headers, added a Payment Reference line and a clickable Peach Payments logo, and fixed related rendering bugs.
 * 08-September-2026    Jared Espineli      Sourced statement author/queries email/whatsapp from the customer's subsidiary, and added getDefaultPeriodDates() (Statement Date 20th of the month, Start Date 2 months prior) for the Email Statement job's Scheduled deployment.
 * 15-September-2026    Jared Espineli      Restyled the Entity/Property panel to a stacked label/value layout. Also logs the full XML on a render.xmlToPdf failure (chunked, since log.error truncates at 4000 chars) - render.xmlToPdf gives the same generic "unexpected error" message as SuiteQL on failure, so the markup itself needs logging to find a malformed-XML bug.
 * 16-September-2026    Jared Espineli      Added getOpenBalance() so Amount Due/aging reflect the true AR balance (unapplied payments/credits included), with the residual folded into the Current bucket so the aging strip still sums to Amount Due.
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/query', 'N/search', 'N/record', 'N/error', 'N/render', 'N/file', 'N/url', 'N/log', './bb1_qpg_cstmt_gts_lib_helper'],
    /**
     * @param{query} query
     * @param{search} search
     * @param{record} record
     * @param{error} error
     * @param{render} render
     * @param{file} file
     * @param{url} url
     * @param{log} log
     * @param{helperLib} helperLib
     */
    (query, search, record, error, render, file, url, log, helperLib) => {

        const _FIELDS = helperLib._FIELDS;

        const LIB_FX = {};

        //=================================================
        //STATEMENT DATA - queries and assembles the tenant statement data set
        //=================================================

        //-----------------------------------------------
        //Account-specific constants
        //Never hardcode inline - all account values live here
        //-----------------------------------------------

        // Months the billing period runs ahead of the statement date; set to 0 for arrears billing.
        const ADVANCE_MONTHS = 1;

        const AR_ACCOUNT_TYPE = 'AcctRec';
        const SQL_DATE_MASK = 'YYYY-MM-DD';
        const AR_TRAN_TYPES = "'CustInvc','CustCred','CustPymt','CustDep','CustRfnd'";

        // Transaction types folded into Balance B/f when roll-up is enabled.
        const ROLLUP_TYPES = "'CustInvc','CustCred'";

        // How many months back payments stay itemised before folding into Balance B/f.
        const PAYMENT_MONTHS = 1;

        const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];

        //-----------------------------------------------
        //General helpers
        //-----------------------------------------------

        // Runs a SuiteQL statement and returns its rows.
        const runQuery = (sql, label) => {
            try {
                return query.runSuiteQL({query: sql}).asMappedResults();
            } catch (e) {
                // SuiteQL sets e.message to a generic string on failure, so the full statement is logged too.
                log.error(`SuiteQL failed - ${label}`, e);
                log.error(`SuiteQL text - ${label}`, sql);
                throw error.create({
                    name: 'BB1_CSTMT_QUERY_FAILED',
                    message: `${label} query failed: ${e.message}`
                });
            }
        }

        // Wraps a validated YYYY-MM-DD date as a SQL TO_DATE literal.
        const sqlDate = (value) => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
                throw error.create({
                    name: 'BB1_CSTMT_BAD_DATE',
                    message: `Rejected an invalid date value: ${value}`
                });
            }
            return `TO_DATE('${value}', '${SQL_DATE_MASK}')`;
        }

        // Rejects anything that is not a plain internal id before it is used
        const assertId = (value) => {
            if (!/^\d+$/.test(String(value))) {
                throw error.create({
                    name: 'BB1_CSTMT_BAD_ID',
                    message: `Rejected an invalid internal id: ${value}`
                });
            }
            return String(value);
        }

        // Converts a form date (DD/MM/YYYY, D/M/YYYY, or already YYYY-MM-DD) into the YYYY-MM-DD mask the queries use.
        const normaliseDate = (value) => {
            if (!value) return value;

            const text = String(value).trim();

            // Already YYYY-MM-DD
            if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

            const parts = text.split(/[\/\-.]/);
            if (parts.length !== 3) {
                throw error.create({
                    name: 'BB1_CSTMT_BAD_DATE',
                    message: `Could not interpret the date "${text}".`
                });
            }

            const day = parts[0].length === 1 ? `0${parts[0]}` : parts[0];
            const month = parts[1].length === 1 ? `0${parts[1]}` : parts[1];
            const year = parts[2];

            return `${year}-${month}-${day}`;
        }

        // Shifts a YYYY-MM value by a whole number of months
        const addMonths = (yearMonth, months) => {
            const year = parseInt(yearMonth.substring(0, 4), 10);
            const month = parseInt(yearMonth.substring(5, 7), 10);

            const total = (year * 12) + (month - 1) + months;
            const newYear = Math.floor(total / 12);
            const newMonth = (total % 12) + 1;

            return `${newYear}-${newMonth < 10 ? '0' + newMonth : newMonth}`;
        }

        // Last calendar day of a YYYY-MM value, as YYYY-MM-DD
        const endOfMonth = (yearMonth) => {
            const year = parseInt(yearMonth.substring(0, 4), 10);
            const month = parseInt(yearMonth.substring(5, 7), 10);

            // Day 0 of the following month is the last day of this one
            const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

            return `${yearMonth}-${lastDay < 10 ? '0' + lastDay : lastDay}`;
        }

        // Shifts a full YYYY-MM-DD date by whole months, clamping the day to the target month's length.
        const addMonthsToDate = (date, months) => {
            let day = parseInt(String(date).substring(8, 10), 10);
            const yearMonth = addMonths(String(date).substring(0, 7), months);
            const lastDay = parseInt(endOfMonth(yearMonth).substring(8, 10), 10);

            if (day > lastDay) day = lastDay;

            return `${yearMonth}-${day < 10 ? '0' + day : day}`;
        }

        // 'June 2026' from '2026-06'
        const monthLabel = (yearMonth) => {
            const year = yearMonth.substring(0, 4);
            const month = parseInt(yearMonth.substring(5, 7), 10);

            return `${MONTH_NAMES[month - 1]} ${year}`;
        }

        // Numeric coercion for totalling, treating null/blank as zero
        const toNumber = (value) => {
            const number = parseFloat(value);
            return isNaN(number) ? 0 : number;
        }

        //-----------------------------------------------
        //Statement header - entity, VAT, property/unit and bank details from the latest invoice in the period
        //-----------------------------------------------
        const getStatementHeader = (customerId, startDate, periodEnd) => {

            // Transaction table only - joins to customer/subsidiary were removed (an INNER JOIN matched no
            // rows, a LEFT JOIN errored outright), so entity-level fields are looked up separately.
            const sql =
                'SELECT ' +
                '    t.id                                    AS transaction_id, ' +
                '    t.tranid                                AS document_number, ' +
                '    t.entity                                AS customer_id, ' +
                '    BUILTIN.DF(t.entity)                    AS customer_name, ' +
                '    t.custbody_alf_subsidiary_legal_name    AS entity_name, ' +
                '    t.custbody_alf_subsidiary_address       AS entity_address, ' +
                '    t.custbody_alf_currency_symbol          AS currency_symbol, ' +
                '    t.custbody_alf_payment_reference        AS payment_reference, ' +
                '    t.custbody_alf_bank_det_to_print        AS bank_details, ' +
                '    BUILTIN.DF(t.cseg_bb1_building)         AS property, ' +
                '    BUILTIN.DF(t.cseg_bb1_unit)             AS unit_no, ' +
                '    (SELECT MAX(tl.subsidiary) FROM transactionline tl ' +
                '      WHERE tl.transaction = t.id)          AS subsidiary_id ' +
                'FROM transaction t ' +
                `WHERE t.entity = ${customerId} ` +
                "  AND t.type = 'CustInvc' " +
                "  AND t.voided = 'F' " +
                `  AND t.trandate BETWEEN ${sqlDate(startDate)} ` +
                `                     AND ${sqlDate(periodEnd)} ` +
                'ORDER BY t.trandate DESC, t.id DESC';

            const results = runQuery(sql, 'Statement header');

            log.debug('Header row count', results.length);

            // No invoice in the period still produces a valid statement, just without the invoice-sourced detail -
            // resolve the customer/subsidiary fields anyway so the sender/queries panel still populate.
            if (!results.length) {
                log.debug('No invoice in period for header', `customer ${customerId}`);
                const entityFields = getEntityFields(customerId, null);
                return {
                    customer_name: '', entity_name: '', currency_symbol: 'R',
                    statement_author_id: entityFields.statement_author_id,
                    email_template_id: entityFields.email_template_id,
                    queries_email: entityFields.queries_email,
                    queries_whatsapp: entityFields.queries_whatsapp,
                    terms_and_conditions: entityFields.terms_and_conditions,
                    company_logo_url: entityFields.company_logo_url
                };
            }

            const headerRow = results[0];

            // Customer/subsidiary fields, fetched by lookup so no join is needed and a missing field can't break the statement.
            const entityFields = getEntityFields(customerId, headerRow.subsidiary_id);
            headerRow.recipient_vat_no = entityFields.recipient_vat_no;
            headerRow.recipient_reg_no = entityFields.recipient_reg_no;
            headerRow.bank_guarantee = entityFields.bank_guarantee;
            headerRow.deposit = entityFields.deposit;
            headerRow.entity_vat_no = entityFields.entity_vat_no;
            headerRow.entity_reg_no = entityFields.entity_reg_no;
            headerRow.payment_url = entityFields.payment_url;
            headerRow.payment_image_url = entityFields.payment_image_url;
            headerRow.company_logo_url = entityFields.company_logo_url;
            headerRow.customer_entity_id = entityFields.customer_entity_id;
            headerRow.statement_author_id = entityFields.statement_author_id;
            headerRow.email_template_id = entityFields.email_template_id;
            headerRow.queries_email = entityFields.queries_email;
            headerRow.queries_whatsapp = entityFields.queries_whatsapp;
            headerRow.terms_and_conditions = entityFields.terms_and_conditions;
            headerRow.bill_address = getBillingAddress(customerId);

            return headerRow;
        }

        //-----------------------------------------------
        //Bill-to address - the customer record's default billing address
        //-----------------------------------------------
        const getBillingAddress = (customerId) => {

            if (!customerId) return '';

            // Preferred: the address flagged as default billing on the customer (addrtext is NetSuite's own
            // formatted block).
            try {
                const sql =
                    'SELECT ea.addrtext AS bill_address ' +
                    'FROM customerAddressbook cab ' +
                    'JOIN customerAddressbookEntityAddress ea ' +
                    '       ON ea.nkey = cab.addressbookaddress ' +
                    `WHERE cab.entity = ${assertId(customerId)} ` +
                    "  AND cab.defaultbilling = 'T'";

                const rows = query.runSuiteQL({query: sql}).asMappedResults();

                if (rows.length && rows[0].bill_address) return rows[0].bill_address;

            } catch (e) {
                log.error(`Billing address query failed for customer ${customerId}`, e.message);
            }

            // Fallback: no address flagged default billing - use whichever address book entry comes first.
            // 'defaultaddress' isn't a valid search.lookupFields column on Customer, so this stays SuiteQL too.
            try {
                const sql =
                    'SELECT ea.addrtext AS bill_address ' +
                    'FROM customerAddressbook cab ' +
                    'JOIN customerAddressbookEntityAddress ea ' +
                    '       ON ea.nkey = cab.addressbookaddress ' +
                    `WHERE cab.entity = ${assertId(customerId)} ` +
                    'FETCH FIRST 1 ROWS ONLY';

                const rows = query.runSuiteQL({query: sql}).asMappedResults();

                return (rows.length && rows[0].bill_address) || '';

            } catch (e) {
                log.error(`Fallback address query failed for customer ${customerId}`, e.message);
                return '';
            }
        }

        //-----------------------------------------------
        //Customer and subsidiary fields used on the header
        //-----------------------------------------------
        const getEntityFields = (customerId, subsidiaryFromInvoice) => {

            let values = {
                recipient_vat_no: '',
                recipient_reg_no: '',
                bank_guarantee: '',
                deposit: '',
                entity_vat_no: '',
                // Entity Registration No., distinct from Entity VAT No./Recipient Registration No. - sourced
                // from the subsidiary's custrecord_alf_company_reg_num field.
                entity_reg_no: '',
                payment_url: '',
                payment_image_url: '',
                // Subsidiary's own logo (standard "logo" field) - falls back to LOGO_URL when not configured.
                company_logo_url: '',
                // Customer's own Entity ID (NetSuite's customer-facing number, e.g. "C000123") - printed as the
                // statement's Payment Reference so a tenant's bank transfer can be matched back to their account.
                customer_entity_id: '',
                // Subsidiary-level Customer Statement Author/Queries fields - left blank when not configured on
                // the subsidiary, rather than falling back to a hardcoded value (see gts_email_mr.js/QUERIES panel).
                statement_author_id: '',
                // Subsidiary's Email Template (custrecord_bb1_cus_state_email_template, List/Record(Email
                // Template)) - subject/body come from this template per subsidiary; blank falls back to the
                // fixed wording in gts_email_lib.js (see LIB_FX.buildSubject/buildBody there).
                email_template_id: '',
                queries_email: '',
                queries_whatsapp: '',
                // Subsidiary-level terms/payment instructions, printed where the old freeform bank details
                // block used to sit, beside the totals box.
                terms_and_conditions: ''
            };

            let subsidiaryId = subsidiaryFromInvoice || null;

            // Customer record
            try {
                const customerFields = search.lookupFields({
                    type: search.Type.CUSTOMER,
                    id: customerId,
                    columns: ['entityid', 'vatregnumber', 'custentity_alf_company_reg_num',
                        'custentity_bb1_bank_guarantee', 'depositbalance', 'subsidiary']
                });

                values.customer_entity_id = customerFields.entityid || '';
                values.recipient_vat_no = customerFields.vatregnumber || '';
                values.recipient_reg_no = customerFields.custentity_alf_company_reg_num || '';
                values.bank_guarantee = customerFields.custentity_bb1_bank_guarantee || '';
                values.deposit = customerFields.depositbalance || '';

                // Fallback only - the invoice's own subsidiary is preferred. Select fields come back as {value, text}.
                if (!subsidiaryId && customerFields.subsidiary && customerFields.subsidiary.length) {
                    subsidiaryId = customerFields.subsidiary[0].value;
                }

            } catch (e) {
                log.error(`Customer lookup failed for ${customerId}`, e.message);
            }

            if (!subsidiaryId) {
                log.error('No subsidiary resolved',
                    `Entity VAT No and the payment link cannot be fetched for customer ${customerId}`);
            }

            // Subsidiary record - source of the VAT number, registration number and payment URL.
            // 'federalidnumber' isn't a valid search.lookupFields column on Subsidiary, so this goes straight
            // through SuiteQL instead (no joins - a join from transaction to subsidiary fails on this account).
            if (subsidiaryId) {
                values = fillFromSubsidiaryQuery(subsidiaryId, values);
                // Looked up separately (cached, via record.load) rather than folded into the SuiteQL above -
                // 'logo' is a File-type native field that isn't reliably queryable through SuiteQL, and one
                // bad column there would silently blank out every other subsidiary field on the statement.
                values.company_logo_url = getSubsidiaryLogoUrl(subsidiaryId);
            }

            return values;
        }

        //-----------------------------------------------
        //Subsidiary fallback - fills in subsidiary-level values via SuiteQL
        //-----------------------------------------------
        const fillFromSubsidiaryQuery = (subsidiaryId, values) => {

            try {
                const sql =
                    'SELECT ' +
                    '    s.federalidnumber                       AS entity_vat_no, ' +
                    '    s.custrecord_alf_company_reg_num         AS entity_reg_no, ' +
                    '    s.custrecord_bb1_peach_payment_url       AS payment_url, ' +
                    // List/Record(File) fields - SuiteQL returns the File Cabinet internal id, not a URL.
                    '    s.custrecord_bb1_peach_payment_image     AS payment_image_id, ' +
                    // Employee this subsidiary's statement emails are sent as (List/Record(Employee) field).
                    '    s.custrecord_bb1_cust_statement_author   AS statement_author_id, ' +
                    // Email Template this subsidiary's statement emails are merged from (List/Record(Email Template) field).
                    '    s.custrecord_bb1_cus_state_email_template AS email_template_id, ' +
                    '    s.custrecord_bb1_queries_email           AS queries_email, ' +
                    '    s.custrecord_bb1_queries_whatsapp        AS queries_whatsapp, ' +
                    '    s.custrecord_bb1_termsandconditions      AS terms_and_conditions ' +
                    'FROM subsidiary s ' +
                    `WHERE s.id = ${assertId(subsidiaryId)}`;

                const rows = query.runSuiteQL({query: sql}).asMappedResults();

                if (rows.length) {
                    values.entity_vat_no = values.entity_vat_no || rows[0].entity_vat_no || '';
                    values.entity_reg_no = values.entity_reg_no || rows[0].entity_reg_no || '';
                    values.payment_url = values.payment_url || rows[0].payment_url || '';
                    values.payment_image_url = values.payment_image_url ||
                        resolveFileCabinetImageUrl(rows[0].payment_image_id);
                    values.statement_author_id = rows[0].statement_author_id || '';
                    values.email_template_id = rows[0].email_template_id || '';
                    values.queries_email = rows[0].queries_email || '';
                    values.queries_whatsapp = rows[0].queries_whatsapp || '';
                    values.terms_and_conditions = rows[0].terms_and_conditions || '';
                }

            } catch (e) {
                // A failure here leaves the looked-up values in place
                log.error(`Subsidiary query fallback failed for ${subsidiaryId}`, e.message);
            }

            return values;
        }

        // Per-execution cache of resolved subsidiary logo URLs, keyed by subsidiary id - a merged statement
        // run maps one customer at a time, and many customers typically share a subsidiary, so this avoids
        // repeating record.load() + file.load() for every one of them.
        const subsidiaryLogoUrlCache = {};

        // Looks up and resolves the subsidiary's own logo (standard "logo"/"Subsidiary Logo (Forms)" field)
        // to an absolute URL, via a full record.load - "logo" is a File-type native field that isn't
        // reliably exposed through search.lookupFields or SuiteQL. Returns '' if unset/unresolvable.
        const getSubsidiaryLogoUrl = (subsidiaryId) => {
            if (Object.prototype.hasOwnProperty.call(subsidiaryLogoUrlCache, subsidiaryId)) {
                return subsidiaryLogoUrlCache[subsidiaryId];
            }

            let logoUrl = '';
            try {
                const subsidiaryRecord = record.load({type: record.Type.SUBSIDIARY, id: subsidiaryId});
                logoUrl = resolveFileCabinetImageUrl(subsidiaryRecord.getValue({fieldId: 'logo'}));
            } catch (e) {
                log.error(`Subsidiary logo lookup failed for ${subsidiaryId}`, e.message);
            }

            subsidiaryLogoUrlCache[subsidiaryId] = logoUrl;
            return logoUrl;
        }

        // Turns a File Cabinet image id (the payment logo, or the subsidiary's own logo) into an absolute
        // URL. Returns '' if it can't be resolved.
        const resolveFileCabinetImageUrl = (fileId) => {
            if (!fileId) return '';

            try {
                const imageFile = file.load({id: fileId});
                const domain = url.resolveDomain({hostType: url.HostType.APPLICATION});

                return `https://${domain}${imageFile.url}`;

            } catch (e) {
                log.error(`File Cabinet image lookup failed for file ${fileId}`, e.message);
                return '';
            }
        }

        //-----------------------------------------------
        //Statement body - Balance B/f plus AR activity in the period, with a running balance
        //-----------------------------------------------
        const getStatementRows = (customerId, startDate, periodEnd, statementDate, billingStart, paymentStart) => {

            const asOf = sqlDate(statementDate);   // ageing reference
            const to = sqlDate(periodEnd);         // includes advance-dated charges
            const from = sqlDate(startDate);

            // With roll-up on, charges before the billing month move out of the itemised rows and into Balance
            // B/f. The two filters are exact complements, so nothing is counted twice or dropped.
            let activityFilter = '';
            let broughtForward = '';

            if (billingStart) {

                // Charges are itemised from the billing month onward; payments/refunds only since the previous
                // statement - everything earlier rolls into Balance B/f.
                const chargeBoundary = sqlDate(billingStart);
                const paymentBoundary = sqlDate(paymentStart);

                activityFilter =
                    ` AND ( (t.type IN (${ROLLUP_TYPES}) AND t.trandate >= ${chargeBoundary}) ` +
                    `    OR (t.type NOT IN (${ROLLUP_TYPES}) AND t.trandate > ${paymentBoundary}) ) `;

                broughtForward =
                    ` OR ( t.trandate >= ${from}` +
                    `  AND ( (t.type IN (${ROLLUP_TYPES}) AND t.trandate < ${chargeBoundary}) ` +
                    `     OR (t.type NOT IN (${ROLLUP_TYPES}) AND t.trandate <= ${paymentBoundary}) ) ) `;
            }

            const sql =
                'SELECT ' +
                '    x.transaction_id, ' +
                '    x.transaction_type, ' +
                '    x.document_number, ' +
                '    x.trandate      AS transaction_date, ' +
                '    x.duedate       AS due_date, ' +
                '    x.memo, ' +
                '    x.aging_bucket, ' +
                '    x.amount, ' +
                '    SUM(NVL(x.amount, 0)) OVER (ORDER BY x.sort_seq, x.trandate, x.transaction_id) AS running_balance ' +
                'FROM ( ' +
                '    SELECT ' +
                '        1                   AS sort_seq, ' +
                '        t.id                AS transaction_id, ' +
                '        t.tranid            AS document_number, ' +
                '        BUILTIN.DF(t.type)  AS transaction_type, ' +
                '        t.trandate          AS trandate, ' +
                '        t.duedate           AS duedate, ' +
                '        t.memo              AS memo, ' +
                '        CASE ' +
                '            WHEN NVL(t.foreignamountunpaid, 0) = 0 THEN TO_CHAR(NULL) ' +
                `            WHEN NVL(t.duedate, t.trandate) >= ${asOf} THEN 'Current' ` +
                `            WHEN ${asOf} - NVL(t.duedate, t.trandate) <= 30 THEN '30' ` +
                `            WHEN ${asOf} - NVL(t.duedate, t.trandate) <= 60 THEN '60' ` +
                `            WHEN ${asOf} - NVL(t.duedate, t.trandate) <= 90 THEN '90' ` +
                "            ELSE '120+' " +
                '        END                 AS aging_bucket, ' +
                '        tal.amount          AS amount ' +
                '    FROM transaction t ' +
                '    JOIN transactionline tl ' +
                '           ON tl.transaction = t.id ' +
                '    JOIN transactionaccountingline tal ' +
                '           ON tal.transaction = t.id ' +
                '          AND tal.transactionline = tl.id ' +
                '    JOIN account a ' +
                '           ON a.id = tal.account ' +
                `    WHERE a.accttype = '${AR_ACCOUNT_TYPE}' ` +
                "      AND tal.posting = 'T' " +
                "      AND t.voided = 'F' " +
                `      AND NVL(tl.entity, t.entity) = ${customerId} ` +
                `      AND t.trandate BETWEEN ${from} AND ${to} ` +
                activityFilter +
                '    UNION ALL ' +
                '    SELECT ' +
                '        0, ' +
                '        0, ' +
                '        TO_CHAR(NULL), ' +
                "        'Balance B/f', " +
                `        ${from}, ` +
                '        TO_DATE(NULL), ' +
                '        TO_CHAR(NULL), ' +
                '        TO_CHAR(NULL), ' +
                '        NVL(SUM(tal.amount), 0) ' +
                '    FROM transaction t ' +
                '    JOIN transactionline tl ' +
                '           ON tl.transaction = t.id ' +
                '    JOIN transactionaccountingline tal ' +
                '           ON tal.transaction = t.id ' +
                '          AND tal.transactionline = tl.id ' +
                '    JOIN account a ' +
                '           ON a.id = tal.account ' +
                `    WHERE a.accttype = '${AR_ACCOUNT_TYPE}' ` +
                "      AND tal.posting = 'T' " +
                "      AND t.voided = 'F' " +
                `      AND NVL(tl.entity, t.entity) = ${customerId} ` +
                `      AND ( t.trandate < ${from} ${broughtForward} ) ` +
                ') x ' +
                'ORDER BY x.sort_seq, x.trandate, x.transaction_id';

            return runQuery(sql, 'Statement body');
        }

        //-----------------------------------------------
        //Invoice item lines - line-level detail behind each invoice
        //-----------------------------------------------
        const getInvoiceLines = (customerId, startDate, periodEnd, billingMonth, billingStart) => {

            // Charges belonging to the month being billed drive the Current Month Charges total; anything
            // earlier in the period is arrears
            const yearMonth = billingMonth;

            // Invoices folded into Balance B/f must not also be itemised
            const lineFilter = billingStart ? `  AND t.trandate >= ${sqlDate(billingStart)} ` : '';

            const sql =
                'SELECT ' +
                '    t.id                            AS transaction_id, ' +
                '    t.tranid                        AS document_number, ' +
                '    t.trandate                      AS transaction_date, ' +
                '    tl.linesequencenumber           AS line_sequence, ' +
                '    i.itemid                        AS allocation, ' +
                '    tl.memo                         AS remarks, ' +
                '    -tl.quantity                    AS quantity, ' +
                '    tl.rate                         AS rate, ' +
                '    tl.taxrate1 * 100               AS tax_rate_pct, ' +
                '    -tl.foreignamount               AS exclusive, ' +
                '    -tl.tax1amt                     AS tax, ' +
                '    -(tl.foreignamount + tl.tax1amt) AS inclusive, ' +
                `    CASE WHEN TO_CHAR(t.trandate, 'YYYY-MM') = '${yearMonth}' ` +
                '         THEN 1 ELSE 0 END           AS is_current_month ' +
                'FROM transaction t ' +
                'JOIN transactionline tl ON tl.transaction = t.id ' +
                'LEFT JOIN item i        ON i.id = tl.item ' +
                "WHERE t.voided = 'F' " +
                `  AND t.entity = ${customerId} ` +
                "  AND t.type = 'CustInvc' " +
                "  AND tl.mainline = 'F' " +
                "  AND tl.taxline = 'F' " +
                '  AND tl.item IS NOT NULL ' +
                `  AND t.trandate BETWEEN ${sqlDate(startDate)} ` +
                `                     AND ${sqlDate(periodEnd)} ` +
                lineFilter +
                'ORDER BY t.trandate, t.id, tl.linesequencenumber';

            return runQuery(sql, 'Invoice lines');
        }

        //-----------------------------------------------
        //Aging summary - Current/30/60/90/120+ day buckets
        //-----------------------------------------------
        const getAgingSummary = (customerId, statementDate, periodEnd) => {

            const asOf = sqlDate(statementDate);

            const sql =
                'SELECT ' +
                `    SUM(CASE WHEN NVL(t.duedate, t.trandate) >= ${asOf} ` +
                '             THEN t.foreignamountunpaid ELSE 0 END)   AS current_amt, ' +
                `    SUM(CASE WHEN ${asOf} - NVL(t.duedate, t.trandate) BETWEEN 1 AND 30 ` +
                '             THEN t.foreignamountunpaid ELSE 0 END)   AS days_30, ' +
                `    SUM(CASE WHEN ${asOf} - NVL(t.duedate, t.trandate) BETWEEN 31 AND 60 ` +
                '             THEN t.foreignamountunpaid ELSE 0 END)   AS days_60, ' +
                `    SUM(CASE WHEN ${asOf} - NVL(t.duedate, t.trandate) BETWEEN 61 AND 90 ` +
                '             THEN t.foreignamountunpaid ELSE 0 END)   AS days_90, ' +
                `    SUM(CASE WHEN ${asOf} - NVL(t.duedate, t.trandate) > 90 ` +
                '             THEN t.foreignamountunpaid ELSE 0 END)   AS days_120_plus, ' +
                '    SUM(t.foreignamountunpaid)                        AS total_due ' +
                'FROM transaction t ' +
                `WHERE t.entity = ${customerId} ` +
                `  AND t.type IN (${AR_TRAN_TYPES}) ` +
                "  AND t.posting = 'T' " +
                "  AND t.voided = 'F' " +
                `  AND t.trandate <= ${sqlDate(periodEnd)} ` +
                '  AND NVL(t.foreignamountunpaid, 0) <> 0';

            const results = runQuery(sql, 'Aging summary');

            if (!results.length) {
                return {current_amt: 0, days_30: 0, days_60: 0, days_90: 0, days_120_plus: 0, total_due: 0};
            }

            return results[0];
        }

        //-----------------------------------------------
        //True AR balance - taken from the accounting lines, like the statement body, so unapplied payments,
        //credits and AR journals are included. foreignamountunpaid exists only on invoices, so the aging
        //summary above alone overstates the balance whenever a receipt or credit is left unapplied.
        //-----------------------------------------------
        const getOpenBalance = (customerId, periodEnd) => {

            const sql =
                'SELECT NVL(SUM(tal.amount), 0) AS balance ' +
                'FROM transaction t ' +
                'JOIN transactionline tl ' +
                '       ON tl.transaction = t.id ' +
                'JOIN transactionaccountingline tal ' +
                '       ON tal.transaction = t.id ' +
                '      AND tal.transactionline = tl.id ' +
                'JOIN account a ' +
                '       ON a.id = tal.account ' +
                `WHERE a.accttype = '${AR_ACCOUNT_TYPE}' ` +
                "  AND tal.posting = 'T' " +
                "  AND t.voided = 'F' " +
                `  AND NVL(tl.entity, t.entity) = ${customerId} ` +
                `  AND t.trandate <= ${sqlDate(periodEnd)}`;

            const results = runQuery(sql, 'Open balance');

            return results.length ? toNumber(results[0].balance) : 0;
        }

        //-----------------------------------------------
        //Statement period - date boundaries shared by both public entry points
        //-----------------------------------------------

        // Validates and normalises the start/statement date filters.
        const resolveDates = (f) => {
            const startDate = normaliseDate(f.startDate);
            const statementDate = normaliseDate(f.statementDate);

            if (!startDate || !statementDate) {
                throw error.create({
                    name: 'BB1_CSTMT_MISSING_DATES',
                    message: 'Both a start date and a statement date are required.'
                });
            }

            return {startDate, statementDate};
        }

        // Computes the billing month, period end, and rollup boundaries from the statement date.
        const resolvePeriod = (statementDate) => {
            const billingMonth = addMonths(String(statementDate).substring(0, 7), ADVANCE_MONTHS);

            return {
                billingMonth,
                periodEnd: endOfMonth(billingMonth),
                billingStart: `${billingMonth}-01`,
                paymentStart: addMonthsToDate(statementDate, -PAYMENT_MONTHS)
            };
        }

        // Default Start Date/Statement Date for a run with no explicit dates - the Email Statement job's
        // Scheduled deployment, which fires on the 20th of each month (see gts_email_mr.js). Statement Date is
        // the 20th of the current month, Start Date the first day of the month two months before - e.g. a run
        // on 20 September produces Start=1 July/Statement=20 September, which resolvePeriod() above then bills
        // one month ahead, as October.
        LIB_FX.getDefaultPeriodDates = () => {
            const today = new Date();
            const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

            return {
                startDate: `${addMonths(currentYearMonth, -2)}-01`,
                statementDate: `${currentYearMonth}-20`
            };
        }

        //-----------------------------------------------
        //Public entry point - header only, for a lighter preview than the full statement
        //-----------------------------------------------

        /**
         * Builds the statement header only, for a customer/date range.
         *
         * @param {Object} filters
         * @param {string|number} filters.customerId - customer internal id
         * @param {string} filters.startDate - statement period start date, in the account's display format or YYYY-MM-DD
         * @param {string} filters.statementDate - statement date, same format rules as startDate
         * @returns {Object} statement - {header, startDate, statementDate, billingMonth, periodEnd}
         */
        LIB_FX.buildStatementHeader = (filters) => {

            const f = filters || {};
            const customerId = assertId(f.customerId);
            const {startDate, statementDate} = resolveDates(f);
            const period = resolvePeriod(statementDate);

            return {
                header: getStatementHeader(customerId, startDate, period.periodEnd),
                startDate,
                statementDate,
                billingMonth: monthLabel(period.billingMonth),
                periodEnd: period.periodEnd
            };
        }

        //-----------------------------------------------
        //Public entry point - full statement, assembling header, rows, lines and aging
        //-----------------------------------------------

        /**
         * Builds the full statement data set for a customer/date range.
         *
         * @param {Object} filters
         * @param {string|number} filters.customerId - customer internal id
         * @param {string} filters.startDate - statement period start date, in the account's display format or YYYY-MM-DD
         * @param {string} filters.statementDate - statement date, same format rules as startDate
         * @param {boolean} [filters.rollup=true] - when true (the default), invoices/credit memos before the
         *   billing month and payments/deposits/refunds before the previous statement are folded into
         *   Balance B/f instead of being itemised
         * @returns {Object} statement - {header, rows, lines, aging, totals, startDate, statementDate, billingMonth, periodEnd}
         */
        LIB_FX.buildStatementData = (filters) => {

            const f = filters || {};

            const customerId = assertId(f.customerId);
            const {startDate, statementDate} = resolveDates(f);
            const rollup = f.rollup !== false; // defaults to on, matching the Generate Statement form's checkbox default

            const statement = {};

            const {billingMonth, periodEnd, billingStart, paymentStart} = resolvePeriod(statementDate);

            statement.header = getStatementHeader(customerId, startDate, periodEnd);
            statement.rows = getStatementRows(customerId, startDate, periodEnd, statementDate,
                rollup ? billingStart : null, rollup ? paymentStart : null);
            statement.lines = getInvoiceLines(customerId, startDate, periodEnd, billingMonth,
                rollup ? billingStart : null);
            statement.aging = getAgingSummary(customerId, statementDate, periodEnd);
            statement.startDate = startDate;
            statement.statementDate = statementDate;
            statement.billingMonth = monthLabel(billingMonth);
            statement.periodEnd = periodEnd;

            // Nest the invoice item lines under the transaction they belong to, as a plain object (not an
            // Array) so it can be enumerated.
            const linesByTransaction = {};
            for (let i = 0; i < statement.lines.length; i++) {
                const line = statement.lines[i];
                if (!linesByTransaction[line.transaction_id]) {
                    linesByTransaction[line.transaction_id] = [];
                }
                linesByTransaction[line.transaction_id].push(line);
            }

            for (let j = 0; j < statement.rows.length; j++) {
                const row = statement.rows[j];
                row.lines = linesByTransaction[row.transaction_id] || [];
            }

            // Amount Due is taken from the AR lines rather than the aging summary, so unapplied receipts and
            // credits are reflected.
            statement.aging.total_due = getOpenBalance(customerId, periodEnd);

            // Unapplied amounts carry no due date and so never land in a bucket. The residual between the
            // bucketed invoices and the true balance is shown as Current, which keeps the aging strip summing
            // to Amount Due.
            const bucketed = toNumber(statement.aging.current_amt) +
                toNumber(statement.aging.days_30) +
                toNumber(statement.aging.days_60) +
                toNumber(statement.aging.days_90) +
                toNumber(statement.aging.days_120_plus);

            statement.aging.current_amt =
                toNumber(statement.aging.current_amt) + (statement.aging.total_due - bucketed);

            // Current month charges - restricted to the statement month, so a statement spanning several
            // months still shows this month's billing
            let totalExclusive = 0;
            let totalTax = 0;

            for (let k = 0; k < statement.lines.length; k++) {
                if (toNumber(statement.lines[k].is_current_month) === 1) {
                    totalExclusive += toNumber(statement.lines[k].exclusive);
                    totalTax += toNumber(statement.lines[k].tax);
                }
            }

            const currentInclusive = totalExclusive + totalTax;

            statement.totals = {
                exclusive: totalExclusive,
                tax: totalTax,
                inclusive: currentInclusive,
                // Anything still owing from earlier periods. Negative means the tenant is in credit, which
                // prints as Prepaid on the statement.
                arrears: toNumber(statement.aging.total_due) - currentInclusive
            };

            return statement;
        }

        //=================================================
        //PDF RENDERING - turns statement data into the merged Generate Statement Suitelet PDF
        //=================================================

        // Fallback File Cabinet URL, used only when a subsidiary has no logo of its own set (see
        // company_logo_url). Escape any & as &amp; if this URL changes.
        const LOGO_URL = 'https://11536405.app.netsuite.com/core/media/media.nl' +
            '?id=5936&amp;c=11536405' +
            '&amp;h=ShdVNtHtCNZxRziqz5XaCmH8XthcQqu1MScOaMoTvGlWj9lm';

        // Logo bounding box, in points. This renderer does not support CSS auto-height on images (tried -
        // omitting height rendered the image at a hugely oversized, disproportionate size instead of scaling
        // it), so both dimensions must be explicit; a taller box than the original 180x65 (sized for the old,
        // wide Quorum wordmark) gives a vertically-oriented subsidiary logo more room before it's squished.
        const LOGO_WIDTH_PT = 140;
        const LOGO_HEIGHT_PT = 100;

        // Peach Payments logo size in points, shown below the Whatsapp line.
        const PEACH_LOGO_WIDTH_PT = 48;
        const PEACH_LOGO_HEIGHT_PT = 48;

        //-----------------------------------------------
        //Formatting helpers
        //-----------------------------------------------

        // Escapes XML special characters before the value reaches the PDF renderer.
        const escapeXml = (value) => {
            if (value === null || value === undefined) return '';
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        }

        // Two decimals with thousands separators, blank for null/blank/NaN
        const formatAmount = (value) => {
            if (value === null || value === undefined || value === '') return '';
            const number = Number(value);
            return isNaN(number) ? '' : number.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        }

        // Maps a "Label: Value" line from custbody_alf_bank_det_to_print onto a Bank Details table column -
        // the field's own labels (left) don't match the printed column headers (right, see buildBankDetailsSection).
        const BANK_DETAIL_LABELS = {
            'account name': 'accountName',
            'bank name': 'bank',
            'branch': 'branchNo',
            'account number': 'accountNo'
        };

        // Parses the free-text bank details block ("Account Name: ...\nBank Name: ...\n...") into the Bank
        // Details table columns. Unrecognised or missing lines are left blank rather than breaking the table.
        const parseBankDetails = (bankDetailsText) => {
            const parsed = {accountName: '', bank: '', branchNo: '', accountNo: ''};
            if (!bankDetailsText) return parsed;

            String(bankDetailsText).split(/\r\n|\r|\n/).forEach((line) => {
                const separatorIndex = line.indexOf(':');
                if (separatorIndex === -1) return;

                const key = BANK_DETAIL_LABELS[line.slice(0, separatorIndex).trim().toLowerCase()];
                if (key) parsed[key] = line.slice(separatorIndex + 1).trim();
            });

            return parsed;
        }

        //-----------------------------------------------
        //Header section - logo + title + customer block left, Entity/Property panel right
        //-----------------------------------------------

        // Renders one label or value cell in the Entity/Property panel's stacked layout, spanning both
        // columns when colspan is set.
        const panelLabelCell = (label, colspan) => `<td class="cstmt-label"${colspan ? ' colspan="2"' : ''}><p style="text-align: left; margin: 0;">${escapeXml(label)}</p></td>`;
        const panelValueCell = (value, colspan) => `<td class="cstmt-value"${colspan ? ' colspan="2"' : ''}><p style="text-align: left; margin: 0;">${escapeXml(value)}</p></td>`;

        // Renders a full-width label/value block (label row, then value row below it).
        const panelBlock = (label, value) => `
                <tr>${panelLabelCell(label, true)}</tr>
                <tr>${panelValueCell(value, true)}</tr>`;

        // Renders a side-by-side pair of label/value blocks sharing one row of columns.
        const panelPair = (label1, value1, label2, value2) => `
                <tr>${panelLabelCell(label1)}${panelLabelCell(label2)}</tr>
                <tr>${panelValueCell(value1)}${panelValueCell(value2)}</tr>`;

        // Renders the Entity/Property panel's rows.
        const buildEntityPanel = (header) => `
            <table class="cstmt-panel">${panelBlock('Entity', header.entity_name)}${panelBlock('Entity VAT No.', header.entity_vat_no)}${panelBlock('Entity Registration No.', header.entity_reg_no)}
                <tr><td colspan="2" class="cstmt-panel-divider"></td></tr>${panelPair('Property', header.property, 'Unit No.', header.unit_no)}
                <tr><td colspan="2" class="cstmt-panel-divider"></td></tr>${panelPair('Recipient VAT No.', header.recipient_vat_no, 'Recipient Registration No.', header.recipient_reg_no)}${panelPair('Deposit', formatAmount(header.deposit), 'Bank Guarantee', formatAmount(header.bank_guarantee))}
            </table>
        `;

        const buildHeaderSection = (statement) => {
            const header = statement.header;
            const addressHtml = header.bill_address
                ? escapeXml(header.bill_address).replace(/\r\n|\r|\n/g, '<br/>')
                : '';
            // LOGO_URL is a hardcoded constant, pre-escaped at its declaration - a resolved subsidiary logo
            // URL is not, so only that branch needs escapeXml.
            const logoUrl = header.company_logo_url ? escapeXml(header.company_logo_url) : LOGO_URL;

            return `
                <table class="cstmt-plain" style="width: 100%;">
                    <tr>
                        <td style="width: 55%; vertical-align: top; border: none;">
                            <img src="${logoUrl}" alt="Company Logo" width="${LOGO_WIDTH_PT}" height="${LOGO_HEIGHT_PT}"
                                 style="width: ${LOGO_WIDTH_PT}pt; height: ${LOGO_HEIGHT_PT}pt;" />
                            <h1 class="cstmt-title">Tax Invoice &amp; Statement</h1>
                            <p class="cstmt-tenant-name">${escapeXml(header.customer_name)}</p>
                            <p>${addressHtml}</p>
                        </td>
                        <td style="width: 45%; vertical-align: top; border: none;">
                            ${buildEntityPanel(header)}
                        </td>
                    </tr>
                </table>
            `;
        }

        //-----------------------------------------------
        //Statement date/invoice no/for-the-month line
        //-----------------------------------------------
        const buildMetaLine = (statement) => `
            <p class="cstmt-meta">
                Statement Date: <span class="cstmt-meta-value">${escapeXml(statement.statementDate)}</span>&nbsp;&nbsp;&nbsp;&nbsp;
                Invoice No: <span class="cstmt-meta-value">${escapeXml(statement.header.document_number)}</span>&nbsp;&nbsp;&nbsp;&nbsp;
                For the Month: <span class="cstmt-meta-value">${escapeXml(statement.billingMonth)}</span>
            </p>
        `;

        //-----------------------------------------------
        //AR activity table
        //-----------------------------------------------

        // Activity table column widths, shared with buildTotalsSection so columns line up.
        const COL_DATE = 12;
        const COL_ALLOCATION = 18;
        const COL_REMARKS = 40;
        const COL_NUM = 10; // Exclusive / Tax / Inclusive, each

        // Renders a left-aligned text cell and a right-aligned numeric cell.
        const textCell = (value) => `<td><p style="text-align: left; margin: 0;">${escapeXml(value)}</p></td>`;
        const numCell = (value) => `<td class="num">${value}</td>`;

        // Renders one activity table row, striped by rowIndex.
        const activityRow = (entry, rowIndex) => {
            const rowClass = rowIndex % 2 === 1 ? ' class="cstmt-row-alt"' : '';
            return `<tr${rowClass}>${textCell(entry.date)}${textCell(entry.allocation)}${textCell(entry.remarks)}` +
                `${numCell(entry.exclusive)}${numCell(entry.tax)}${numCell(entry.inclusive)}</tr>`;
        }

        // Flattens statement rows and their nested invoice lines into one display-ordered list.
        const flattenActivityRows = (rows) => {
            const flat = [];

            rows.forEach((row) => {
                if (row.lines && row.lines.length) {
                    row.lines.forEach((line) => flat.push({
                        date: line.transaction_date,
                        allocation: line.allocation,
                        remarks: line.remarks,
                        exclusive: formatAmount(line.exclusive),
                        tax: formatAmount(line.tax),
                        inclusive: formatAmount(line.inclusive)
                    }));
                    return;
                }

                const allocation = row.transaction_type;
                const isBroughtForward = allocation === 'Balance B/f';

                flat.push({
                    date: isBroughtForward ? '' : row.transaction_date,
                    allocation: allocation,
                    // Payment lines show the payment's own memo instead of the document number - everything
                    // else keeps the document number.
                    remarks: allocation === 'Payment' ? row.memo : row.document_number,
                    exclusive: isBroughtForward ? '' : formatAmount(0),
                    tax: isBroughtForward ? '' : formatAmount(0),
                    inclusive: formatAmount(row.amount)
                });
            });

            return flat;
        }

        const buildActivityTable = (statement) => `
            <table class="cstmt-activity">
                <thead>
                    <tr>
                        <th style="width: ${COL_DATE}%;">Date</th>
                        <th style="width: ${COL_ALLOCATION}%;">Allocation</th>
                        <th style="width: ${COL_REMARKS}%;">Remarks</th>
                        <th class="num" style="width: ${COL_NUM}%;">Exclusive</th>
                        <th class="num" style="width: ${COL_NUM}%;">Tax</th>
                        <th class="num" style="width: ${COL_NUM}%;">Inclusive</th>
                    </tr>
                </thead>
                <tbody>
                    ${flattenActivityRows(statement.rows).map(activityRow).join('')}
                </tbody>
            </table>
        `;

        //-----------------------------------------------
        //Totals block - Arrears/Current Month Charges/Amount Due
        //-----------------------------------------------
        const buildTotalsSection = (statement, symbol) => {
            // Builds the totals box, aligned under the activity table's columns.
            const boxWidth = COL_REMARKS + (3 * COL_NUM);
            const labelWidthPct = (COL_REMARKS / boxWidth * 100).toFixed(2);
            const numWidthPct = (COL_NUM / boxWidth * 100).toFixed(2);

            return `
                <table class="cstmt-plain" style="width: 100%; margin-top: 6pt;">
                    <tr>
                        <td style="width: ${COL_DATE + COL_ALLOCATION}%; vertical-align: top; border: none; padding-right: 10pt;">
                            ${statement.header.terms_and_conditions
                                ? `<p style="text-align: left; margin: 0;">${escapeXml(statement.header.terms_and_conditions).replace(/\r\n|\r|\n/g, '<br/>')}</p>`
                                : ''}
                        </td>
                        <td style="width: ${boxWidth}%; vertical-align: top; border: none;">
                            <table class="cstmt-totals">
                                <tr>
                                    <td class="cstmt-total-bold" style="width: ${labelWidthPct}%;">Arrears/Prepaid</td>
                                    <td class="num" style="width: ${numWidthPct}%;"></td>
                                    <td class="num" style="width: ${numWidthPct}%;"></td>
                                    <td class="num cstmt-total-bold" style="width: ${numWidthPct}%;">${formatAmount(statement.totals.arrears)}</td>
                                </tr>
                                <tr>
                                    <td class="cstmt-total-bold" style="width: ${labelWidthPct}%;">Current Month Charges</td>
                                    <td class="num cstmt-total-bold" style="width: ${numWidthPct}%;">${formatAmount(statement.totals.exclusive)}</td>
                                    <td class="num cstmt-total-bold" style="width: ${numWidthPct}%;">${formatAmount(statement.totals.tax)}</td>
                                    <td class="num cstmt-total-bold" style="width: ${numWidthPct}%;">${formatAmount(statement.totals.inclusive)}</td>
                                </tr>
                                <tr class="cstmt-total-row">
                                    <td class="cstmt-total-strong" style="width: ${labelWidthPct}%;">Amount Due</td>
                                    <td class="num" style="width: ${numWidthPct}%;"></td>
                                    <td class="num" style="width: ${numWidthPct}%;"></td>
                                    <td class="num cstmt-total-strong" style="width: ${numWidthPct}%;">${escapeXml(symbol)}${formatAmount(statement.aging.total_due)}</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            `;
        }

        //-----------------------------------------------
        //Queries + aging strip - email/Whatsapp sourced from the customer's subsidiary
        //(custrecord_bb1_queries_email/custrecord_bb1_queries_whatsapp), left blank if not configured
        //-----------------------------------------------
        const buildQueriesAgingSection = (statement) => `
            <table class="cstmt-plain" style="width: 100%; margin-top: 8pt;">
                <tr>
                    <td style="width: 55%; vertical-align: top; border: none;">
                        <table class="cstmt-queries-table">
                            <thead>
                                <tr><th>Queries</th></tr>
                            </thead>
                            <tbody>
                                <tr><td>${escapeXml(statement.header.queries_email)}</td></tr>
                                <tr><td>Whatsapp Nr: ${escapeXml(statement.header.queries_whatsapp)}</td></tr>
                            </tbody>
                        </table>
                    </td>
                    <td style="width: 45%; vertical-align: top; border: none; padding-left: 8pt;">
                        <table class="cstmt-aging">
                            <thead>
                                <tr>
                                    <th class="num">120 Days +</th>
                                    <th class="num">90 Days</th>
                                    <th class="num">60 Days</th>
                                    <th class="num">30 Days</th>
                                    <th class="num">Current</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td class="num">${formatAmount(statement.aging.days_120_plus)}</td>
                                    <td class="num">${formatAmount(statement.aging.days_90)}</td>
                                    <td class="num">${formatAmount(statement.aging.days_60)}</td>
                                    <td class="num">${formatAmount(statement.aging.days_30)}</td>
                                    <td class="num">${formatAmount(statement.aging.current_amt)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </td>
                </tr>
            </table>
        `;

        //-----------------------------------------------
        //Bank details table - Account Name/Bank/Branch No./Account No., parsed from custbody_alf_bank_det_to_print
        //(whose own field labels are Account Name/Bank Name/Branch/Account Number - see BANK_DETAIL_LABELS),
        //plus a highlighted Payment Reference column from the customer's own Entity ID. The clickable payment
        //logo (subsidiary's custrecord_bb1_peach_payment_image, linking to custrecord_bb1_peach_payment_url)
        //prints below, left-aligned.
        //-----------------------------------------------
        const buildBankDetailsSection = (statement) => {
            const bank = parseBankDetails(statement.header.bank_details);

            return `
                <table class="cstmt-bank">
                    <thead>
                        <tr>
                            <th>Account Name</th>
                            <th>Bank</th>
                            <th>Branch No.</th>
                            <th>Account No.</th>
                            <th class="cstmt-bank-highlight">Payment Reference</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>${escapeXml(bank.accountName)}</td>
                            <td>${escapeXml(bank.bank)}</td>
                            <td>${escapeXml(bank.branchNo)}</td>
                            <td>${escapeXml(bank.accountNo)}</td>
                            <td class="cstmt-bank-highlight">${escapeXml(statement.header.customer_entity_id)}</td>
                        </tr>
                    </tbody>
                </table>
                ${statement.header.payment_image_url && statement.header.payment_url
                    // Kept inside a table cell (not a bare <p>) - every other image on this page lives inside
                    // a <td>, and a free-floating <img> outside a table triggered a render.xmlToPdf failure.
                    // BFO's <a> wraps text runs reliably, but rarely creates a link annotation over a replaced
                    // element (an <img>, with no text of its own) - href goes on the <img> itself too, which is
                    // the more reliable target for a clickable image in this renderer. The <a> wrapper is kept
                    // as a harmless belt-and-suspenders in case this account's BFO build does honour it.
                    ? `<table class="cstmt-plain" style="width: 100%; margin-top: 8pt;"><tr><td style="border: none;">` +
                      `<a href="${escapeXml(statement.header.payment_url)}">` +
                      `<img src="${escapeXml(statement.header.payment_image_url)}" alt="Peach Payments" ` +
                      `href="${escapeXml(statement.header.payment_url)}" ` +
                      `width="${PEACH_LOGO_WIDTH_PT}" height="${PEACH_LOGO_HEIGHT_PT}" /></a>` +
                      `</td></tr></table>`
                    : ''}
            `;
        }

        // Builds one customer's statement data and rendered page XML together. Throws on failure.
        LIB_FX.buildCustomerStatement = (customerId, filters) => {
            const statement = LIB_FX.buildStatementData(Object.assign({}, filters, {customerId}));
            const symbol = statement.header.currency_symbol || 'R';

            const pageXml = buildHeaderSection(statement) +
                buildMetaLine(statement) +
                buildActivityTable(statement) +
                buildTotalsSection(statement, symbol) +
                buildQueriesAgingSection(statement) +
                buildBankDetailsSection(statement);

            return {statement, pageXml};
        }

        // Builds one customer's page XML. Returns a short error page instead of throwing on failure.
        LIB_FX.buildCustomerPageXml = (customerId, filters) => {
            try {
                return LIB_FX.buildCustomerStatement(customerId, filters).pageXml;
            } catch (e) {
                log.error(`Statement failed for customer ${customerId}`, e.message);
                return `<p>Could not generate the statement for customer ${escapeXml(customerId)}: ${escapeXml(e.message)}</p>`;
            }
        }

        //-----------------------------------------------
        //PDF assembly
        //-----------------------------------------------

        // Merges already-built customer pages into one PDF, separated by a page break.
        LIB_FX.wrapPagesAsPdf = (pages) => {
            const body = pages.join('<pbr/>');

            const xml = `
                <?xml version="1.0"?>
                <!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">
                <pdf>
                    <head>
                        <macrolist>
                            <macro id="cstmtfooter">
                                <table style="width: 100%; border: none;">
                                    <tr><td style="border: none; text-align: left; font-size: 7pt; color: #777777;">Page <pagenumber/></td></tr>
                                </table>
                            </macro>
                        </macrolist>
                        <style>
                            * { font-family: Arial, Helvetica, sans-serif; }
                            body { font-size: 8pt; color: #333333; }
                            h1.cstmt-title { font-size: 15pt; color: #B8912F; font-weight: normal; margin: 4pt 0; }
                            .cstmt-tenant-name { font-weight: bold; font-size: 9pt; }
                            .cstmt-meta { font-size: 8pt; margin: 10pt 0 6pt 0; }
                            .cstmt-meta-value { font-weight: bold; }
                            table.cstmt-plain td { border: none; padding: 0; }
                            table.cstmt-panel { width: 100%; border-collapse: collapse; }
                            table.cstmt-panel td { background-color: #F6F6F6; border: none; padding: 0 8pt; vertical-align: top; }
                            table.cstmt-panel .cstmt-label { font-weight: bold; font-size: 7pt; color: #222222; padding-top: 6pt; }
                            table.cstmt-panel .cstmt-value { font-size: 8.5pt; padding-bottom: 6pt; }
                            table.cstmt-panel .cstmt-panel-divider { height: 1pt; padding: 0 8pt; border-top: 0.5pt solid #DDDDDD; }
                            table.cstmt-activity { width: 100%; border-collapse: collapse; }
                            table.cstmt-activity th { text-align: left; padding: 4pt; font-size: 7.5pt; font-weight: bold; border-bottom: 1pt solid #333333; }
                            table.cstmt-activity td { padding: 4pt; font-size: 7.5pt; vertical-align: top; border: none; }
                            table.cstmt-activity .num { text-align: right; }
                            table.cstmt-activity .cstmt-row-alt td { background-color: #F2F2F2; }
                            table.cstmt-totals { width: 100%; border-collapse: collapse; border: 0.5pt solid #CCCCCC; }
                            table.cstmt-totals td { border: none; padding: 4pt 6pt; font-size: 8pt; }
                            table.cstmt-totals .num { text-align: right; }
                            table.cstmt-totals .cstmt-total-row td { border-top: 1pt solid #333333; padding-top: 6pt; }
                            .cstmt-total-strong { font-weight: bold; font-size: 10pt; }
                            .cstmt-total-bold { font-weight: bold; }
                            table.cstmt-queries-table { width: 100%; border-collapse: collapse; }
                            table.cstmt-queries-table th { background-color: #EEEEEE; padding: 4pt; font-size: 7.5pt; font-weight: bold; text-align: left; }
                            table.cstmt-queries-table td { padding: 4pt; font-size: 8pt; }
                            table.cstmt-aging { width: 100%; border-collapse: collapse; }
                            table.cstmt-aging th { background-color: #EEEEEE; padding: 4pt; font-size: 7.5pt; font-weight: bold; }
                            table.cstmt-aging td { padding: 4pt; font-size: 8pt; }
                            table.cstmt-aging .num { text-align: right; }
                            table.cstmt-bank { width: 100%; border-collapse: collapse; margin-top: 10pt; border-top: 0.5pt solid #CCCCCC; }
                            table.cstmt-bank th { text-align: left; padding: 4pt; font-size: 7.5pt; font-weight: bold; border-bottom: 1pt solid #333333; }
                            table.cstmt-bank td { padding: 4pt; font-size: 8pt; border: none; }
                            table.cstmt-bank .cstmt-bank-highlight { background-color: #EEEEEE; text-align: center; }
                        </style>
                    </head>
                    <body footer="cstmtfooter" footer-height="20pt" size="A4" padding="0.5in">
                        ${body}
                    </body>
                </pdf>
            `;

            // xml.trim() strips the leading newline/indentation so <?xml ?> is the first character
            const trimmedXml = xml.trim();

            try {
                return render.xmlToPdf({xmlString: trimmedXml});
            } catch (e) {
                // render.xmlToPdf sets e.message    to a generic string on failure (same as SuiteQL), so the
                // full XML is logged too, in ~3800-char chunks (log.error truncates a single details value at
                // 4000 chars) - otherwise a malformed-markup bug is unfindable from the error alone.
                log.error('render.xmlToPdf failed', e.message);
                const CHUNK_SIZE = 3800;
                for (let i = 0; i < trimmedXml.length; i += CHUNK_SIZE) {
                    log.error(`render.xmlToPdf XML input (chars ${i}-${i + CHUNK_SIZE})`,
                        trimmedXml.slice(i, i + CHUNK_SIZE));
                }
                throw e;
            }
        }

        // Builds the merged PDF straight from request params, one page per marked customer.
        LIB_FX.buildPdf = (params) => {
            const customerIds = helperLib.LIB_FX.parseIdListParam(params && params[_FIELDS.ACTION.CUSTOMER_IDS]);

            const filters = {
                startDate: params && params[_FIELDS.FORM.START_DATE],
                statementDate: params && params[_FIELDS.FORM.STATEMENT_DATE],
                rollup: !(params && params[_FIELDS.FORM.ROLL_PRIOR_CHARGES] === 'F')
            };

            const pages = customerIds.map((customerId) => LIB_FX.buildCustomerPageXml(customerId, filters));
            return LIB_FX.wrapPagesAsPdf(pages);
        }

        return {LIB_FX};
    });
