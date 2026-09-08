/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library backing the Email Statement flow - reads each
 * customer's statement recipient/cc addresses and builds/sends the statement
 * email. Used by gts_email_mr.js. The sender (author) is resolved per
 * customer in gts_pdf_lib.js from the customer's subsidiary
 * (custrecord_bb1_cust_statement_author), not by this library.
 *
 * Date                 Author              Purpose
 * 07-September-2026    Jared Espineli      Initial Release - sends statement emails using a static employee id as the sender.
 * 08-September-2026    Jared Espineli      Removed the static sender - author is now resolved per customer from the subsidiary record.
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

        // Free-form, comma-separated address fields on the Customer record.
        const CUSTOMER_FIELD = {
            EMAIL:    'custentity_bb1_statement_email',
            EMAIL_CC: 'custentity_bb1_statement_email_cc'
        };

        const LIB_FX = {};

        //-----------------------------------------------
        //Address parsing - both custentity fields are
        //free-form, comma-separated
        //-----------------------------------------------

        // Splits a comma-separated address field into a trimmed, de-duplicated list.
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
        //Per-customer recipient/cc addresses
        //-----------------------------------------------

        // Gets this customer's statement recipient/cc addresses. Returns empty lists instead of throwing on failure.
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

        // N/email.send allows at most 10 recipients total (to + cc + bcc).
        const MAX_RECIPIENTS_TOTAL = 10;

        // Sends one customer's statement email, trimming cc first if the recipient count is over the limit.
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
