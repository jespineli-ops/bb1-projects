/**
 * Project: Quorum Customer Statement - P102843 Quorum NetSuite Implementation
 *
 * Teamwork task: N/A
 *
 * Server-only library that builds the Generate Tenant Statements Suitelet
 * form. Fields only for now - the customer/tenant list (carried over from
 * Customer List Search) and the actual statement generation logic haven't
 * been scoped yet. See the TODO in bb1_qpg_cstmt_gts_sl.js.
 *
 * Date             Author              Purpose
 * 01-September-2026    Jared Espineli      Initial Release - Statement Date/Start Date/Roll Prior Charges
 *                                          checkbox only, no generation logic yet
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 */
define(['N/ui/serverWidget'],
    /**
     * @param{serverWidget} serverWidget
     */
    (serverWidget) => {

        // field ids used on the Generate Tenant Statements Suitelet form
        const _FIELDS = {
            FORM: {
                STATEMENT_DATE:     'custpage_qpg_cstmt_statement_date',
                START_DATE:         'custpage_qpg_cstmt_start_date',
                ROLL_PRIOR_CHARGES: 'custpage_qpg_cstmt_roll_prior_charges'
            }
        }

        const LIB_FX = {};

        // Builds the Generate Tenant Statements Suitelet form
        LIB_FX.buildForm = () => {
            const form = serverWidget.createForm({title: 'Generate Tenant Statements'});

            form.addField({
                id: _FIELDS.FORM.STATEMENT_DATE,
                type: serverWidget.FieldType.DATE,
                label: 'Statement Date'
            });

            form.addField({
                id: _FIELDS.FORM.START_DATE,
                type: serverWidget.FieldType.DATE,
                label: 'Start Date'
            });

            form.addField({
                id: _FIELDS.FORM.ROLL_PRIOR_CHARGES,
                type: serverWidget.FieldType.CHECKBOX,
                label: 'Roll Prior Chargers into Balance B/f'
            });

            return form;
        }

        return {LIB_FX, _FIELDS};
    });
