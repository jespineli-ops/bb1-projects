/**
 * Project: J&K Ross - P102821
 *
 * Teamwork task: P102821 - Production Order
 *
 * Adds the Manufacture Document and Picking Ticket buttons (QZ print queue/library) to the
 * Project Order record
 *
 * Date                Author              Purpose
 * 29-September-2026   Jared Espineli     Initial Release
 * 01-October-2026      Jared Espineli     Added Picking Ticket button
 *
 * Copyright (c) 2026 BlueBridge One Business Solutions, All Rights Reserved
 * support@bluebridgeone.com, UK Support: +44 (0)1932 300007 SA Support: +27 (0)10 500 8674
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 */
define([],

    function () {

        /**
         * @param {Object} scriptContext
         * @param {Form} scriptContext.form
         * @param {string} scriptContext.type
         */
        function beforeLoad(scriptContext) {
            var form = scriptContext.form;
            var type = scriptContext.type;


            if (type === scriptContext.UserEventType.VIEW || type === scriptContext.UserEventType.EDIT) {
                form.clientScriptModulePath = './bb1_jkr_prod_order_print_cs.js';

                //renders via the QZ print queue/library
                form.addButton({
                    id: 'custpage_bb1_jkr_prjord_mfgdoc_btn',
                    label: 'Manufacture Document',
                    functionName: 'openManufactureDocument'
                });

                //renders via the QZ print queue/library
                form.addButton({
                    id: 'custpage_bb1_jkr_prjord_pickdoc_btn',
                    label: 'Picking Ticket',
                    functionName: 'openPickingTicket'
                });
            }
        }

        return {
            beforeLoad: beforeLoad
        };

    });
