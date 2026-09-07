/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library backing the Email Statement flow - resolves the
 * static From address to an employee internal id (N/email.send's author
 * param requires one, not a raw address - see resolveAuthorId), reads each
 * customer's statement recipient/cc addresses (custentity_bb1_statement_
 * email / custentity_bb1_statement_email_cc, both free-form text fields
 * that may hold several comma-separated addresses), and builds/sends the
 * statement email itself. Used by gts_task_lib.js (author resolved once,
 * at submission) and gts_email_mr.js (everything else, per customer).
 *
 * Date                 Author              Purpose
 * 07-September-2026    Jared Espineli      Initial Release.
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/email', 'N/log'],
    /**
     * @param{search} search
     * @param{email} email
     * @param{log} log
     */
    (search, email, log) => {

        // Static "from" address, per project spec (kept as a single named constant, not scattered inline, in
        // case it later becomes configurable). N/email.send's author must be an employee internal id, not a
        // raw address, so this is only ever resolved to one via resolveAuthorId - never passed to email.send
        // directly.
        const FROM_EMAIL_ADDRESS = 'jespineli@bluebridgeone.com';

        // custentity_bb1_statement_email/_cc are both free-form text fields on the Customer record (added
        // directly in the NetSuite UI - not tracked in this project's SDF source) - may hold several addresses
        // separated by commas.
        const CUSTOMER_FIELD = {
            EMAIL:    'custentity_bb1_statement_email',
            EMAIL_CC: 'custentity_bb1_statement_email_cc'
        };

        const LIB_FX = {};

        LIB_FX.FROM_EMAIL_ADDRESS = FROM_EMAIL_ADDRESS;

        //-----------------------------------------------
        //Address parsing - both custentity fields are
        //free-form, comma-separated
        //-----------------------------------------------

        // Splits a free-form, comma-separated address field into a trimmed, de-duplicated list. '' / null /
        // undefined -> [].
        LIB_FX.parseAddressList = (value) => {
            if (!value) return [];

            const seen = new Set();
            const addresses = [];

            String(value).split(',').forEach((raw) => {
                const address = raw.trim();
                if (!address || seen.has(address.toLowerCase())) return;

                seen.add(address.toLowerCase());
                addresses.push(address);
            });

            return addresses;
        }

        //-----------------------------------------------
        //Sender - resolved ONCE per run (see
        //gts_task_lib.js), not once per customer
        //-----------------------------------------------

        // Resolves FROM_EMAIL_ADDRESS to an active employee's internal id - N/email.send's author param
        // requires one, not a raw address. Returns null (logging why) if no matching active employee is found.
        LIB_FX.resolveAuthorId = () => {
            try {
                const results = search.create({
                    type: search.Type.EMPLOYEE,
                    filters: [['email', 'is', FROM_EMAIL_ADDRESS], 'AND', ['isinactive', 'is', 'F']],
                    columns: ['internalid']
                }).run().getRange({start: 0, end: 1});

                if (!results.length) {
                    log.error('Email Statement sender not found', `No active employee has email ${FROM_EMAIL_ADDRESS}`);
                    return null;
                }

                return results[0].getValue({name: 'internalid'});
            } catch (e) {
                log.error('resolveAuthorId failed', e.message);
                return null;
            }
        }

        //-----------------------------------------------
        //Per-customer recipient/cc addresses
        //-----------------------------------------------

        // This customer's statement recipient/cc addresses, parsed from the free-form entity fields. Isolated
        // in its own try/catch, same as gts_data_lib.js's entity field lookups - a lookup failure degrades to
        // "no addresses" (the map stage skips the customer) rather than failing the whole run.
        LIB_FX.getStatementEmailFields = (customerId) => {
            try {
                const fields = search.lookupFields({
                    type: search.Type.CUSTOMER,
                    id: customerId,
                    columns: [CUSTOMER_FIELD.EMAIL, CUSTOMER_FIELD.EMAIL_CC]
                });

                return {
                    to: LIB_FX.parseAddressList(fields[CUSTOMER_FIELD.EMAIL]),
                    cc: LIB_FX.parseAddressList(fields[CUSTOMER_FIELD.EMAIL_CC])
                };
            } catch (e) {
                log.error(`Statement email fields lookup failed for customer ${customerId}`, e.message);
                return {to: [], cc: []};
            }
        }

        //-----------------------------------------------
        //Subject/body - fixed wording per project spec,
        //only customer name/billing month vary
        //-----------------------------------------------

        // HTML-escapes record data (customer name/billing month) dropped into the email body below.
        const escapeHtml = (value) => {
            if (value === null || value === undefined) return '';
            return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        LIB_FX.buildSubject = (billingMonth) => `Statement for ${billingMonth}`;

        LIB_FX.buildBody = (customerName, billingMonth) => `
            Dear ${escapeHtml(customerName)},<br/><br/>
            Please find attached the statement for ${escapeHtml(billingMonth)}, together with the corresponding
            payment details for your review and reference.<br/><br/>
            Should you have any questions or require any clarification regarding the statement or payment
            information, please do not hesitate to contact me.<br/><br/>
            Thank you for your attention.<br/><br/>
            Kind regards,<br/>
            Accounting Team
        `.trim();

        //-----------------------------------------------
        //Send
        //-----------------------------------------------

        // N/email.send's own hard limit - at most 10 recipients total across to/cc/bcc combined. Both
        // custentity fields are free-form, so a long pasted list could exceed it.
        const MAX_RECIPIENTS_TOTAL = 10;

        // Sends one customer's statement email. authorId must already be resolved (see resolveAuthorId) - not
        // done here, so it's only looked up once per run, not once per customer. relatedRecords.entityId logs
        // the email against the customer's own communication history. If to+cc together exceed
        // MAX_RECIPIENTS_TOTAL, cc is trimmed to fit (to takes priority - it's the customer's own primary
        // recipient field) rather than letting N/email.send reject the whole send outright.
        LIB_FX.sendStatementEmail = (options) => {
            const to = options.to || [];
            let cc = options.cc || [];

            if (to.length + cc.length > MAX_RECIPIENTS_TOTAL) {
                const ccLimit = Math.max(0, MAX_RECIPIENTS_TOTAL - to.length);
                log.error('Too many statement email recipients',
                    `Customer ${options.customerId}: ${to.length} to + ${cc.length} cc exceeds N/email.send's ` +
                    `${MAX_RECIPIENTS_TOTAL}-recipient limit - cc trimmed to ${ccLimit}.`);
                cc = cc.slice(0, ccLimit);
            }

            email.send({
                author: options.authorId,
                recipients: to,
                cc: cc.length ? cc : undefined,
                subject: options.subject,
                body: options.body,
                attachments: [options.pdfFile],
                relatedRecords: {entityId: options.customerId}
            });
        }

        return {LIB_FX};
    });
