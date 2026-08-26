/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Server-only library that queries the Tenancy Schedule workbook data and
 * shapes it for the PDF (grouped, with totals) and CSV (flat) builders.
 *
 * Date        	  Author		        Purpose
 * 08/25/2026     Jared Espineli        Initial version - query + row mapping
 * 08/26/2026     Jared Espineli        Group by Accommodation Type/Unit, add Gross Income/Gross Rate and subtotals, drop hardcoded type filter
 * 08/26/2026     Jared Espineli        Re-added Accommodation Type filter (id 5) temporarily for testing
 * 08/26/2026     Jared Espineli        Other Chargings shows display text instead of internal id
 * 08/26/2026     Jared Espineli        Fixed blank Rent Rate/Rate/Gross Rate - now divide by unit counter, same as the Area column
 * 08/26/2026     Jared Espineli        Added getFlatRows() for CSV export - same formulas, no grouping/totals
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/query'],
    /**
     * @param{query} query
     */
    (query) => {

        // TODO: temporary - limits results to one Accommodation Type for
        // testing. Remove once the Suitelet's own filter drives this instead.
        const TEST_ACCOMMODATION_TYPE_FILTER = 5;

        // Maps each report column to its query field. Gross Income/Gross
        // Rate (formula_3/formula_4) are computed in JS, not SQL - see
        // getAccommodationGroups/getFlatRows. Area uses the unit counter
        // field, not custrecord_bb1_unit_area (that field is empty here).
        const ROW_COLUMNS = [
            'name',
            'custrecord_bb1_unit_counter',
            'name_1',
            'fullname',
            'custrecord_bb1_lease_start_date',
            'custrecord_bb1_lease_end_date',
            'custrecord_bb1_lease_review_date',
            'custrecord_bb1_lease_opt_months',
            'formula_1',
            'formula_2',
            'custrecord_bb1_lease_rent_escalation',
            'custrecord_bb1_utilised_type',
            'custrecord_bb1_utilised_description',
            'custrecord_bb1_utilised_rate_ex_vat',
            'formula_5',
            'formula_3',
            'formula_4',
            'custrecord_bb1_unit_budget_rate'
        ];

        // Columns blanked on a unit's 2nd+ charge row, so unit details print
        // once per unit in the PDF (not used by getFlatRows/CSV).
        const CONTINUATION_BLANK_COLUMNS = [
            'name',
            'custrecord_bb1_unit_counter',
            'name_1',
            'fullname',
            'custrecord_bb1_lease_start_date',
            'custrecord_bb1_lease_end_date',
            'custrecord_bb1_lease_review_date',
            'custrecord_bb1_lease_opt_months',
            'formula_1',
            'formula_2',
            'custrecord_bb1_lease_rent_escalation',
            'custrecord_bb1_unit_budget_rate'
        ];

        //derived from this workbook: https://11536405.app.netsuite.com/app/common/report/report.nl?workbook=9
        const QUERY = `
            SELECT
              MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.name_0_0_0_0 AS name,
              CUSTOMRECORD_CSEG_BB1_UNIT."ID" AS unit_id,
              CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_counter AS custrecord_bb1_unit_counter,
              MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.custrecord_bb1_building_portfolio_0_0_0_0 AS custrecord_bb1_building_portfolio,
              CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_accommodation_type AS custrecord_bb1_unit_accommodation_type,
              BUILTIN.DF(CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_accommodation_type) AS accommodation_type_name,
              CUSTOMRECORD_CSEG_BB1_UNIT.name AS name_1,
              CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.name AS name_2,
              CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.fullname AS fullname,
              CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_start_date AS custrecord_bb1_lease_start_date,
              CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_end_date AS custrecord_bb1_lease_end_date,
              CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_review_date AS custrecord_bb1_lease_review_date,
              CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_opt_months AS custrecord_bb1_lease_opt_months,
              CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_rent_escalation AS custrecord_bb1_lease_rent_escalation,
              CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) END AS formula_1,
              CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) / CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_counter END AS formula_2,
              CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rateareaexcl_vat AS custrecord_bb1_utilised_rateareaexcl_vat,
              CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) <> 'Rent' THEN CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat END AS custrecord_bb1_utilised_rate_ex_vat,
              CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) <> 'Rent' THEN CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat / CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_counter END AS formula_5,
              CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_amt_inclusiv_vat AS custrecord_bb1_utilised_amt_inclusiv_vat,
              CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) <> 'Rent' THEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) END AS custrecord_bb1_utilised_type,
              CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) <> 'Rent' THEN CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_description END AS custrecord_bb1_utilised_description,
              CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_budget_rate AS custrecord_bb1_unit_budget_rate,
              CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_status AS custrecord_bb1_unit_status
            FROM
              CUSTOMRECORD_CSEG_BB1_UNIT,
              (SELECT
                CUSTOMRECORD_BB1_LEASE_CONTRACT.cseg_bb1_unit AS cseg_bb1_unit,
                CUSTOMRECORD_BB1_LEASE_CONTRACT.cseg_bb1_unit AS cseg_bb1_unit_join,
                CUSTOMRECORD_BB1_LEASE_CONTRACT.name AS name,
                Customer.fullname AS fullname,
                CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_start_date AS custrecord_bb1_lease_start_date,
                CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_end_date AS custrecord_bb1_lease_end_date,
                CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_review_date AS custrecord_bb1_lease_review_date,
                CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_opt_months AS custrecord_bb1_lease_opt_months,
                CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_rent_escalation AS custrecord_bb1_lease_rent_escalation,
                CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_type AS custrecord_bb1_utilised_type,
                CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_rate_ex_vat AS custrecord_bb1_utilised_rate_ex_vat,
                CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_rateareaexcl_vat AS custrecord_bb1_utilised_rateareaexcl_vat,
                CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_amt_inclusiv_vat AS custrecord_bb1_utilised_amt_inclusiv_vat,
                CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_description AS custrecord_bb1_utilised_description
              FROM
                CUSTOMRECORD_BB1_LEASE_CONTRACT,
                Customer,
                CUSTOMRECORD_BB1_UTILISED_CHARGES
              WHERE
                CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_tenant = Customer."ID"(+)
                 AND CUSTOMRECORD_BB1_LEASE_CONTRACT."ID" = CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_lease(+)
              ) CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB,
              (SELECT
                MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor.mapone AS mapone,
                CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.name_0_0_0 AS name_0_0_0_0,
                CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.custrecord_bb1_building_portfolio_0_0_0 AS custrecord_bb1_building_portfolio_0_0_0_0
              FROM
                MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor,
                (SELECT
                  CUSTOMRECORD_CSEG_BB1_FLOOR."ID" AS id_0,
                  CUSTOMRECORD_CSEG_BB1_FLOOR."ID" AS id_join,
                  MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.name_0_0 AS name_0_0_0,
                  MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.custrecord_bb1_building_portfolio_0_0 AS custrecord_bb1_building_portfolio_0_0_0
                FROM
                  CUSTOMRECORD_CSEG_BB1_FLOOR,
                  (SELECT
                    MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block.mapone AS mapone,
                    CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.name_0 AS name_0_0,
                    CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.custrecord_bb1_building_portfolio_0 AS custrecord_bb1_building_portfolio_0_0
                  FROM
                    MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block,
                    (SELECT
                      CUSTOMRECORD_CSEG_BB1_BLOCK."ID" AS "ID",
                      CUSTOMRECORD_CSEG_BB1_BLOCK."ID" AS id_join,
                      MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.name AS name_0,
                      MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.custrecord_bb1_building_portfolio AS custrecord_bb1_building_portfolio_0
                    FROM
                      CUSTOMRECORD_CSEG_BB1_BLOCK,
                      (SELECT
                        MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building.mapone AS mapone,
                        CUSTOMRECORD_CSEG_BB1_BUILDING.name AS name,
                        CUSTOMRECORD_CSEG_BB1_BUILDING.custrecord_bb1_building_portfolio AS custrecord_bb1_building_portfolio
                      FROM
                        MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building,
                        CUSTOMRECORD_CSEG_BB1_BUILDING
                      WHERE
                        MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building.maptwo = CUSTOMRECORD_CSEG_BB1_BUILDING."ID"
                      ) MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB
                    WHERE
                      CUSTOMRECORD_CSEG_BB1_BLOCK."ID" = MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.mapone(+)
                    ) CUSTOMRECORD_CSEG_BB1_BLOCK_SUB
                  WHERE
                    MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block.maptwo = CUSTOMRECORD_CSEG_BB1_BLOCK_SUB."ID"
                  ) MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB
                WHERE
                  CUSTOMRECORD_CSEG_BB1_FLOOR."ID" = MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.mapone(+)
                ) CUSTOMRECORD_CSEG_BB1_FLOOR_SUB
              WHERE
                MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor.maptwo = CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.id_0
              ) MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB
            WHERE
              CUSTOMRECORD_CSEG_BB1_UNIT."ID" = CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.cseg_bb1_unit(+)
               AND CUSTOMRECORD_CSEG_BB1_UNIT."ID" = MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.mapone(+)
               AND CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_accommodation_type = ?
            ORDER BY
              accommodation_type_name,
              name_1,
              CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN 0 ELSE 1 END,
              CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_description
        `;

        const LIB_FX = {};

        LIB_FX.ROW_COLUMNS = ROW_COLUMNS;

        const toNumberOrNull = (value) => {
            if (value === null || value === undefined || value === '') return null;
            const num = Number(value);
            return isNaN(num) ? null : num;
        }

        // Turns one query row into a plain array, in ROW_COLUMNS order.
        LIB_FX.mapRowToColumns = (row) => ROW_COLUMNS.map((column) => {
            const value = row[column];
            return value === null || value === undefined ? '' : value;
        });

        // Runs the query - one row per unit/charge line, ordered by
        // Accommodation Type, then Unit, then Rent line first.
        const runQuery = () => query.runSuiteQL({
            query: QUERY,
            params: [TEST_ACCOMMODATION_TYPE_FILTER]
        }).asMappedResults();

        /**
         * CSV export rows: same query/formulas as the PDF, but flat - no
         * Accommodation Type totals, no blanking of repeat unit details.
         * Gross Income/Gross Rate are still computed per unit, but written
         * onto every row of that unit instead of just the last one, so each
         * CSV row is self-contained.
         *
         * Returns: [ [...ROW_COLUMNS order values...], ... ]
         */
        LIB_FX.getFlatRows = () => {
            const rows = runQuery();

            const unitsById = new Map();
            rows.forEach((row) => {
                const unitId = row.unit_id;
                if (!unitsById.has(unitId)) unitsById.set(unitId, []);
                unitsById.get(unitId).push(row);
            });

            unitsById.forEach((unitRows) => {
                const area = toNumberOrNull(unitRows[0].custrecord_bb1_unit_counter) || 0;
                let currentRent = null;
                let amountSum = 0;
                let hasCharge = false;

                unitRows.forEach((row) => {
                    const rent = toNumberOrNull(row.formula_1);
                    if (rent !== null) currentRent = rent;

                    const amount = toNumberOrNull(row.custrecord_bb1_utilised_rate_ex_vat);
                    if (amount !== null) {
                        amountSum += amount;
                        hasCharge = true;
                    }
                });

                const grossIncome = (currentRent !== null || hasCharge) ? (currentRent || 0) + amountSum : null;
                const grossRate = (grossIncome !== null && area) ? grossIncome / area : null;

                unitRows.forEach((row) => {
                    row.formula_3 = grossIncome;
                    row.formula_4 = grossRate;
                });
            });

            return rows.map(LIB_FX.mapRowToColumns);
        }

        /**
         * PDF export rows: groups by Unit first (to compute each unit's
         * Gross Income/Gross Rate, shown on its last charge row only), then
         * by Accommodation Type (to compute that type's subtotal row).
         * A unit is "occupied" if it has a Current Rent value - only
         * occupied units' area counts as "Occupied Area", which Rent
         * Rate/Rate/Gross Rate divide by instead of the type's full area.
         *
         * Returns: [{ accommodationType, totals: {...}, rows: [[...], ...] }]
         */
        LIB_FX.getAccommodationGroups = () => {
            const rows = runQuery();

            // group rows by unit, keeping the order they came back in
            const unitOrder = [];
            const unitsById = new Map();

            rows.forEach((row) => {
                const unitId = row.unit_id;

                if (!unitsById.has(unitId)) {
                    unitsById.set(unitId, {
                        accommodationType: row.accommodation_type_name || '',
                        area: toNumberOrNull(row.custrecord_bb1_unit_counter) || 0,
                        rows: []
                    });
                    unitOrder.push(unitId);
                }

                unitsById.get(unitId).rows.push(row);
            });

            // compute each unit's Current Rent, occupancy and Gross Income/
            // Gross Rate, then attach the gross figures to its last row only
            unitOrder.forEach((unitId) => {
                const unit = unitsById.get(unitId);
                let currentRent = null;
                let amountSum = 0;
                let hasCharge = false;

                unit.rows.forEach((row, index) => {
                    const rent = toNumberOrNull(row.formula_1);
                    if (rent !== null) currentRent = rent;

                    const amount = toNumberOrNull(row.custrecord_bb1_utilised_rate_ex_vat);
                    if (amount !== null) {
                        amountSum += amount;
                        hasCharge = true;
                    }

                    if (index > 0) {
                        CONTINUATION_BLANK_COLUMNS.forEach((column) => {
                            row[column] = null;
                        });
                    }
                });

                unit.occupied = currentRent !== null;
                unit.currentRent = currentRent || 0;
                unit.amountSum = amountSum;

                const grossIncome = (currentRent !== null || hasCharge) ? (currentRent || 0) + amountSum : null;
                unit.grossIncome = grossIncome || 0;
                const grossRate = (grossIncome !== null && unit.area) ? grossIncome / unit.area : null;

                const lastRow = unit.rows[unit.rows.length - 1];
                lastRow.formula_3 = grossIncome;
                lastRow.formula_4 = grossRate;
            });

            // group units by accommodation type, keeping the order they came back in
            const typeOrder = [];
            const typesByName = new Map();

            unitOrder.forEach((unitId) => {
                const unit = unitsById.get(unitId);

                if (!typesByName.has(unit.accommodationType)) {
                    typesByName.set(unit.accommodationType, []);
                    typeOrder.push(unit.accommodationType);
                }

                typesByName.get(unit.accommodationType).push(unit);
            });

            return typeOrder.map((accommodationType) => {
                const units = typesByName.get(accommodationType);
                const totals = {area: 0, occupiedArea: 0, currentRent: 0, amount: 0, grossIncome: 0};

                units.forEach((unit) => {
                    totals.area += unit.area;
                    totals.currentRent += unit.currentRent;
                    totals.amount += unit.amountSum;
                    totals.grossIncome += unit.grossIncome;
                    if (unit.occupied) totals.occupiedArea += unit.area;
                });

                totals.rentRate = totals.occupiedArea ? totals.currentRent / totals.occupiedArea : null;
                totals.rate = totals.occupiedArea ? totals.amount / totals.occupiedArea : null;
                totals.grossRate = totals.occupiedArea ? totals.grossIncome / totals.occupiedArea : null;

                const flatRows = units.reduce((acc, unit) => acc.concat(unit.rows), []);

                return {
                    accommodationType,
                    totals,
                    rows: flatRows.map(LIB_FX.mapRowToColumns)
                };
            });
        }

        return {LIB_FX};
    });
