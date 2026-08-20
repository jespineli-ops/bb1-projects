/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Helper library for the Tenancy Schedule report Suitelet and its client script
 *
 * Date        	  Author		        Purpose
 * 08/20/2026     Jared Espineli        Initial Version
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/ui/serverWidget', 'N/search'],
    /**
     * @param{serverWidget} serverWidget
     * @param{search} search
     */
    (serverWidget, search) => {

        // field/button ids used on the Suitelet form itself
        const _FIELDS = {
            FORM: {
                BUTTON_STYLE:           'custpage_qpg_button_style',
                PRINT_PDF:              'custpage_qpg_print_pdf',
                EXPORT_CSV:             'custpage_qpg_export_csv',
                PROPERTY_PORTFOLIO:     'custpage_qpg_property_portfolio',
                BUILDING:               'customrecord_cseg_bb1_building',
                ACCOMM_TYPE:            'custpage_qpg_accomm_type',
                BLOCK:                  'custpage_qpg_block',
                FLOOR:                  'custpage_qpg_floor',
                UNIT:                   'custpage_qpg_unit',
                AS_OF_DATE:             'custpage_qpg_as_of_date'
            },
            //Building has no parent segment - it sources every building unfiltered
            BUILDING: {
                REC_ID: 'customrecord_cseg_bb1_building'
            },
            //Block is filtered by the selected Building(s)
            BLOCK: {
                REC_ID: 'customrecord_cseg_bb1_block',
                FILTERBY_BUILDING: 'cseg_bb1_block_filterby_cseg_bb1_building'
            },
            //Floor is filtered by the selected Block(s)
            FLOOR: {
                REC_ID: 'customrecord_cseg_bb1_floor',
                FILTERBY_BLOCK: 'cseg_bb1_floor_filterby_cseg_bb1_block'
            },
            //hierarchy unconfirmed for Unit yet, so it stays statically sourced for now
            UNIT: {
                REC_ID: 'customrecord_cseg_bb1_unit'
            }
        }

        const LIB_FX = {};

        const BUTTON_STYLE = `
            <style>
                #${_FIELDS.FORM.PRINT_PDF}, #${_FIELDS.FORM.EXPORT_CSV} {
                    background-color: #2C5266;
                    border-color: #2C5266;
                    color: #FFFFFF;
                }
            </style>
        `;

        /**
         * handles the form design and builds
         */
        LIB_FX.buildForm = () => {
            const form = serverWidget.createForm({title: 'Tenancy Schedule Report'});

            // Cascading filter behavior (Building -> Block -> Floor) lives in the client
            // script, mirroring the custom segment "filtered by" hierarchy configured on
            // those segments.
            form.clientScriptModulePath = './bb1_qpg_tschd_report_cs.js';

            form.addField({
                id: _FIELDS.FORM.BUTTON_STYLE,
                type: serverWidget.FieldType.INLINEHTML,
                label: 'Button Style'
            }).defaultValue = BUTTON_STYLE;

            form.addButton({
                id: _FIELDS.FORM.PRINT_PDF,
                label: 'Print PDF'
            });

            form.addButton({
                id: _FIELDS.FORM.EXPORT_CSV,
                label: 'Export CSV'
            });

            // Left column
            form.addField({
                id: _FIELDS.FORM.PROPERTY_PORTFOLIO,
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Property Portfolio',
                source: 'customlist_bb1_building_prop_portfolio'
            });

            form.addField({
                id: _FIELDS.FORM.BUILDING,
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Building/s',
                source: _FIELDS.BUILDING.REC_ID
            });

            form.addField({
                id: _FIELDS.FORM.ACCOMM_TYPE,
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Accommodation Type/s',
                source: 'customlist_bb1_building_accommoda_type'
            });

            // Right column — STARTCOL on the first field breaks into a second column.
            // Block and Floor have no static source: they start empty and are populated
            // by the client script once their parent (Building / Block) is selected.
            const blockField = form.addField({
                id: _FIELDS.FORM.BLOCK,
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Block/s'
            });
            blockField.updateBreakType({breakType: serverWidget.FieldBreakType.STARTCOL});

            form.addField({
                id: _FIELDS.FORM.FLOOR,
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Floor/s'
            });

            form.addField({
                id: _FIELDS.FORM.UNIT,
                type: serverWidget.FieldType.MULTISELECT,
                label: 'Unit/s',
                source: _FIELDS.UNIT.REC_ID
            });

            form.addField({
                id: _FIELDS.FORM.AS_OF_DATE,
                type: serverWidget.FieldType.DATE,
                label: 'As of Date'
            });

            return form;
        }

        /**
         * clears the value in a multi select field
         */
        LIB_FX.clearFieldOptions = (currentRecord, fieldId) => {
            currentRecord.getField({fieldId: fieldId}).removeSelectOption({value: null});
        }

        /**
         * Repopulates a select/multiselect field with the child records whose "filtered by"
         * field points at one of the given parent ids. Leaves the field empty when there are
         * no parent ids selected.
         */
        LIB_FX.populateChildOptions = (currentRecord, fieldId, recordType, filterFieldId, parentIds) => {
            LIB_FX.clearFieldOptions(currentRecord, fieldId);

            if (!parentIds || !parentIds.length) {
                return;
            }

            const field = currentRecord.getField({fieldId: fieldId});
            search.create({
                type: recordType,
                filters: [[filterFieldId, 'anyof', parentIds]],
                columns: ['name']
            }).run().each((result) => {
                field.insertSelectOption({
                    value: result.id,
                    text: result.getValue({name: 'name'})
                });
                return true;
            });
        }

        return {LIB_FX, _FIELDS};
    });