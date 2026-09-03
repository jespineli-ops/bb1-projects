/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library that queries and assembles the tenant statement data -
 * header (entity/VAT/property/bank detail), the AR activity rows with a
 * running balance and Balance B/f roll-up, invoice item-line detail, and the
 * aging summary. Ported from the standalone Quorum tenant statement Suitelet
 * (bb1_qpg_stmt_sl.js, v23-2026-08-30) and adapted to this project's
 * LIB_FX/_FIELDS conventions. PDF/XML rendering is intentionally out of
 * scope here - see bb1_qpg_tschd_report_pdf_lib.js for this project's
 * established PDF-builder pattern once the Generate/Print Statement actions
 * are scoped.
 *
 * Date                 Author              Purpose
 * 03-September-2026    Jared Espineli      Initial Release - ported the query/lookup engine (buildStatementData,
 *                                          getStatementHeader, getBillingAddress, getEntityFields,
 *                                          fillFromSubsidiaryQuery, getStatementRows, getInvoiceLines,
 *                                          getAgingSummary) from bb1_qpg_stmt_sl.js
 * 03-September-2026    Jared Espineli      Extracted resolvePeriod() (billing month/period end/roll-up
 *                                          boundaries) out of buildStatementData so it can be shared with the
 *                                          new buildStatementHeader() - a lighter entry point that runs only
 *                                          the header query, for gts_pdf_lib.js's statement PDF header section
 *                                          (AR activity/invoice-line/aging queries aren't needed until the rest
 *                                          of the statement is scoped). Also added an entity_reg_no slot to
 *                                          getEntityFields' return value - left blank for now, no source field
 *                                          is wired up yet (see the field's own comment)
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/query', 'N/search', 'N/error', 'N/log'],
    /**
     * @param{query} query
     * @param{search} search
     * @param{error} error
     * @param{log} log
     */
    (query, search, error, log) => {

        //-----------------------------------------------
        //Account-specific constants
        //Never hardcode inline - all account values live here
        //-----------------------------------------------

        // Quorum invoices in advance: a statement dated in May bills June, and
        // those charges carry a June transaction date. So the statement period
        // runs to the end of the billing month, while ageing is still measured
        // as at the statement date - which is what puts advance charges in
        // Current rather than overdue. Set to 0 for arrears billing.
        const ADVANCE_MONTHS = 1;

        const AR_ACCOUNT_TYPE = 'AcctRec';
        const SQL_DATE_MASK = 'YYYY-MM-DD';
        const AR_TRAN_TYPES = "'CustInvc','CustCred','CustPymt','CustDep','CustRfnd'";

        // Charges folded into Balance B/f when roll-up is enabled. Payments,
        // deposits and refunds follow the separate rule below.
        const ROLLUP_TYPES = "'CustInvc','CustCred'";

        // How far back payments stay itemised, in months before the statement
        // date. Only receipts since the previous statement are itemised, so a
        // statement dated 20/05 lists the 30/04 receipt and folds anything
        // older into Balance B/f. Charges use the billing month boundary
        // instead (see ADVANCE_MONTHS above).
        const PAYMENT_MONTHS = 1;

        const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];

        const LIB_FX = {};

        //-----------------------------------------------
        //General helpers
        //-----------------------------------------------

        // Runs a SuiteQL statement and returns its rows. Values reaching this
        // helper have already been validated by assertId/sqlDate before being
        // concatenated in, so no raw input is ever passed through unchecked.
        const runQuery = (sql, label) => {
            try {
                return query.runSuiteQL({query: sql}).asMappedResults();
            } catch (e) {
                // SuiteQL sets e.message to a generic string on failure, so the
                // full statement is logged to allow it to be replayed directly
                // in the query browser.
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

        // Converts a form date into the YYYY-MM-DD mask the queries use.
        // Handles DD/MM/YYYY and D/M/YYYY; anything already in the target
        // format is passed through untouched.
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

        // Shifts a full YYYY-MM-DD date by whole months. The day is clamped to
        // the target month's length, so 31 March less one month gives 28 or 29
        // February rather than rolling into March.
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
        //Statement header
        //Entity, VAT numbers, property/unit and the
        //pre-formatted bank block all sit on the most
        //recent invoice in the period
        //-----------------------------------------------
        const getStatementHeader = (customerId, startDate, periodEnd) => {

            // Transaction table only. Joins to customer and subsidiary were
            // removed - an INNER JOIN matched no rows and a LEFT JOIN errored
            // outright, so the entity-level fields are looked up separately.
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

            // No invoice in the period still produces a valid statement, just
            // without the invoice-sourced header detail.
            if (!results.length) {
                log.debug('No invoice in period for header', `customer ${customerId}`);
                return {customer_name: '', entity_name: '', currency_symbol: 'R'};
            }

            const headerRow = results[0];

            // Customer-level and subsidiary-level fields, fetched by lookup so
            // no join is needed and a missing field cannot break the statement.
            const entityFields = getEntityFields(customerId, headerRow.subsidiary_id);
            headerRow.recipient_vat_no = entityFields.recipient_vat_no;
            headerRow.recipient_reg_no = entityFields.recipient_reg_no;
            headerRow.bank_guarantee = entityFields.bank_guarantee;
            headerRow.deposit = entityFields.deposit;
            headerRow.entity_vat_no = entityFields.entity_vat_no;
            headerRow.entity_reg_no = entityFields.entity_reg_no;
            headerRow.payment_url = entityFields.payment_url;
            headerRow.bill_address = getBillingAddress(customerId);

            return headerRow;
        }

        //-----------------------------------------------
        //Bill-to address
        //Taken from the customer record rather than the
        //invoice, so a tenant who has moved gets their
        //current address. Queried on its own so a failure
        //here cannot take the whole statement down
        //-----------------------------------------------
        const getBillingAddress = (customerId) => {

            if (!customerId) return '';

            // Preferred: the address flagged as default billing on the customer.
            // addrtext is the formatted block as NetSuite renders it.
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

            // Fallback: the customer's default address, whichever that is
            try {
                const fields = search.lookupFields({
                    type: search.Type.CUSTOMER,
                    id: customerId,
                    columns: ['defaultaddress']
                });

                return fields.defaultaddress || '';

            } catch (e) {
                log.error(`Default address lookup failed for customer ${customerId}`, e.message);
                return '';
            }
        }

        //-----------------------------------------------
        //Customer and subsidiary fields
        //Each lookup is isolated so one unavailable field
        //degrades that value only, never the statement
        //-----------------------------------------------
        const getEntityFields = (customerId, subsidiaryFromInvoice) => {

            let values = {
                recipient_vat_no: '',
                recipient_reg_no: '',
                bank_guarantee: '',
                deposit: '',
                entity_vat_no: '',
                // The statement design also shows an "Entity Registration
                // No." distinct from Entity VAT No. (federalidnumber, above)
                // and Recipient Registration No. (the customer's own
                // custentity_alf_company_reg_num, below) - no subsidiary-
                // level field for this has been confirmed yet, so it stays
                // blank rather than guessing a field id. Wire it up here
                // once BB1/the client confirm which field holds it.
                entity_reg_no: '',
                payment_url: ''
            };

            let subsidiaryId = subsidiaryFromInvoice || null;

            // Customer record
            try {
                const customerFields = search.lookupFields({
                    type: search.Type.CUSTOMER,
                    id: customerId,
                    columns: ['vatregnumber', 'custentity_alf_company_reg_num',
                        'custentity_bb1_bank_guarantee', 'depositbalance', 'subsidiary']
                });

                values.recipient_vat_no = customerFields.vatregnumber || '';
                values.recipient_reg_no = customerFields.custentity_alf_company_reg_num || '';
                values.bank_guarantee = customerFields.custentity_bb1_bank_guarantee || '';
                values.deposit = customerFields.depositbalance || '';

                // Fallback only - the invoice's own subsidiary is preferred.
                // Select fields come back as an array of {value, text}
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

            // Subsidiary record - source of the VAT number and payment URL
            if (subsidiaryId) {
                try {
                    const subsidiaryFields = search.lookupFields({
                        type: search.Type.SUBSIDIARY,
                        id: subsidiaryId,
                        columns: ['federalidnumber', 'custrecord_bb1_peach_payment_url']
                    });

                    values.entity_vat_no = subsidiaryFields.federalidnumber || '';
                    values.payment_url = subsidiaryFields.custrecord_bb1_peach_payment_url || '';

                } catch (e) {
                    log.error(`Subsidiary lookup failed for ${subsidiaryId}`, e.message);
                }

                // lookupFields does not return every custom field type on every
                // account, so anything still missing is retried through SuiteQL
                // against the subsidiary table directly. No joins - a join from
                // transaction to subsidiary fails on this account.
                if (!values.payment_url || !values.entity_vat_no) {
                    values = fillFromSubsidiaryQuery(subsidiaryId, values);
                }
            }

            return values;
        }

        //-----------------------------------------------
        //Subsidiary fallback
        //Second attempt at the subsidiary-level values,
        //queried directly rather than looked up
        //-----------------------------------------------
        const fillFromSubsidiaryQuery = (subsidiaryId, values) => {

            try {
                const sql =
                    'SELECT ' +
                    '    s.federalidnumber                    AS entity_vat_no, ' +
                    '    s.custrecord_bb1_peach_payment_url   AS payment_url ' +
                    'FROM subsidiary s ' +
                    `WHERE s.id = ${assertId(subsidiaryId)}`;

                const rows = query.runSuiteQL({query: sql}).asMappedResults();

                if (rows.length) {
                    values.entity_vat_no = values.entity_vat_no || rows[0].entity_vat_no || '';
                    values.payment_url = values.payment_url || rows[0].payment_url || '';
                }

            } catch (e) {
                // A failure here leaves the looked-up values in place
                log.error(`Subsidiary query fallback failed for ${subsidiaryId}`, e.message);
            }

            return values;
        }

        //-----------------------------------------------
        //Statement body
        //Balance brought forward plus all AR activity in
        //the period, with a running balance
        //-----------------------------------------------
        const getStatementRows = (customerId, startDate, periodEnd, statementDate, billingStart, paymentStart) => {

            const asOf = sqlDate(statementDate);   // ageing reference
            const to = sqlDate(periodEnd);         // includes advance-dated charges
            const from = sqlDate(startDate);

            // With roll-up on, charges before the billing month move out of the
            // itemised rows and into Balance B/f. The two filters are exact
            // complements, so nothing is counted twice or dropped.
            let activityFilter = '';
            let broughtForward = '';

            if (billingStart) {

                // Charges are itemised from the billing month onward; payments
                // and refunds only since the previous statement. Everything
                // earlier rolls into Balance B/f.
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
        //Invoice item lines
        //Item lines are stored negative against income, so
        //every amount is negated for display. Tax comes
        //from tax1amt - taxamount is removed in SuiteQL
        //-----------------------------------------------
        const getInvoiceLines = (customerId, startDate, periodEnd, billingMonth, billingStart) => {

            // Charges belonging to the month being billed drive the Current
            // Month Charges total; anything earlier in the period is arrears
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
        //Aging summary
        //Current / 30 / 60 / 90 / 120+ buckets - 120+ is
        //the catch-all for anything over 90 days
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
        //Statement period
        //Shared by both public entry points - the billing
        //month/period end/roll-up boundaries only depend
        //on the statement date, not on which parts of the
        //statement are actually being built
        //-----------------------------------------------

        // Validates and normalises the two date filters every entry point
        // needs, throwing the same error either would have thrown inline.
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

        // Billing month sits ADVANCE_MONTHS after the statement date's own
        // month, and the period runs to the last day of that month so
        // advance-dated charges are picked up. Payments on or before
        // paymentStart are folded into Balance B/f.
        const resolvePeriod = (statementDate) => {
            const billingMonth = addMonths(String(statementDate).substring(0, 7), ADVANCE_MONTHS);

            return {
                billingMonth,
                periodEnd: endOfMonth(billingMonth),
                billingStart: `${billingMonth}-01`,
                paymentStart: addMonthsToDate(statementDate, -PAYMENT_MONTHS)
            };
        }

        //-----------------------------------------------
        //Public entry point - header only
        //Runs just the header query - no AR activity/
        //invoice-line/aging queries - for gts_pdf_lib.js's
        //statement PDF header section
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
        //Public entry point - full statement
        //Assembles header + rows + invoice lines + aging
        //into one statement object, with invoice lines
        //nested under their parent transaction row and the
        //Current Month Charges/Arrears totals computed
        //-----------------------------------------------

        /**
         * Builds the full statement data set for a customer/date range.
         *
         * @param {Object} filters
         * @param {string|number} filters.customerId - customer internal id
         * @param {string} filters.startDate - statement period start date, in the account's display format or YYYY-MM-DD
         * @param {string} filters.statementDate - statement date, same format rules as startDate
         * @param {boolean} [filters.rollup=true] - when true (the default - matches the form's own default),
         *   invoices/credit memos before the billing month and payments/deposits/refunds before the previous
         *   statement are folded into Balance B/f instead of being itemised
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

            // Nest the invoice item lines under the transaction they belong to.
            // Built as a plain object rather than an Array so it can be enumerated.
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

            // Current month charges - restricted to the statement month, so a
            // statement spanning several months still shows this month's billing
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
                // Anything still owing from earlier periods. Negative means the
                // tenant is in credit, which prints as Prepaid on the statement.
                arrears: toNumber(statement.aging.total_due) - currentInclusive
            };

            return statement;
        }

        return {LIB_FX};
    });
