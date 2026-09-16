/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Project: Quorum Tenancy Schedule - P102843 Quorum NetSuite Implementation
 * Server-only library that queries the Tenancy Schedule workbook data and
 * shapes it for the PDF (grouped, with totals) and CSV (flat) builders.
 *
 * Date           Author                Purpose
 * 08/25/2026     Jared Espineli        Initial version - query + row mapping
 * 08/26/2026     Jared Espineli        Added Accommodation Type/Unit grouping with subtotals, Gross Income/Gross Rate, and CSV/Property Totals exports.
 * 08/27/2026     Jared Espineli        Replaced the test filter with real Suitelet-driven location/type filters and added active-lease-based vacancy/occupancy totals.
 * 08/28/2026     Jared Espineli        Fixed DD/MM/YYYY date misparsing and made As of Date drive lease activity throughout via getCsvRows().
 * 09/02/2026     Jared Espineli        Reworked unit rows to fold Rent into one row per unit, sum charges by Type+Description+Charge Date, and scope the report to the As of Date's month.
 * 09/03/2026     Jared Espineli        Fixed CSV double-counting and per-unit divisor bugs, and switched vacancy/occupancy to real, area-based percentages.
 * 09/04/2026     Jared Espineli        Fixed several field/filter bugs and replaced getAccommodationGroups with getPropertyGroups to group the PDF by Building then Accommodation Type with per-Building and Grand Totals.
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/query'],
    /**
     * @param{query} query
     */
    (query) => {

        // Query fields for each PDF column, in order. Area uses the unit counter field, not custrecord_bb1_unit_area.
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
            'custrecord_bb1_lease_rentescalation_per',
            'custrecord_bb1_utlised_item',
            'custrecord_bb1_utilised_description',
            'custrecord_bb1_utilised_rate_ex_vat',
            'formula_5',
            'formula_3',
            'formula_4',
            'custrecord_bb1_unit_budget_rate'
        ];

        // Columns blanked on a unit's continuation rows, so unit details print once per unit.
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
            'custrecord_bb1_lease_rentescalation_per',
            'custrecord_bb1_unit_budget_rate'
        ];

        // Lease/Tenant/Charge columns, blanked when the unit's lease isn't active as of the As of Date.
        const LEASE_DERIVED_COLUMNS = ROW_COLUMNS.filter((column) =>
            !['name', 'custrecord_bb1_unit_counter', 'name_1', 'custrecord_bb1_unit_budget_rate'].includes(column));

        // Charge-line-only columns, blanked on a unit's header row.
        const CHARGE_LINE_COLUMNS = ROW_COLUMNS.filter((column) =>
            !CONTINUATION_BLANK_COLUMNS.includes(column) && column !== 'formula_3' && column !== 'formula_4');

        // CSV export columns in print order. Type/Description are excluded since they can't collapse into one row per unit.
        const CSV_ROW_COLUMNS = [
            'name', 'addr1', 'addr2', 'zip', 'city', 'dropdownstate', 'country',
            'custrecord_bb1_unit_counter', 'custrecord_bb1_unit_area', 'custrecord_bb1_unit_status',
            'custrecord_bb1_building_portfolio', 'custrecord_bb1_unit_accommodation_type', 'name_1',
            'formula_6', 'cseg_bb1_bed', 'name_2',
            'custrecord_bb1_lease_future', 'entityid',
            'fullname', 'custentity_bb1_group_tenant', 'email', 'phone', 'addressbookaddress', 'addr1_1', 'addr2_1', 'zip_1', 'city_1',
            'dropdownstate_1', 'country_1',
            'custrecord_bb1_lease_start_date', 'custrecord_bb1_lease_end_date', 'custrecord_bb1_lease_review_date',
            'custrecord_bb1_lease_opt_months', 'custrecord_bb1_lease_rentescalation_per',
            'formula_1', 'formula_2', 'custrecord_bb1_utilised_rateareaexcl_vat', 'custrecord_bb1_utilised_rate_ex_vat',
            'formula_5', 'custrecord_bb1_utilised_amt_inclusiv_vat', 'formula_3', 'formula_4',
            'custrecord_bb1_unit_budget_rate'
        ];

        // Amount columns summed across a unit's charge lines into one CSV row.
        const CSV_SUM_COLUMNS = new Set([
            'formula_1', 'formula_2', 'custrecord_bb1_utilised_rateareaexcl_vat',
            'custrecord_bb1_utilised_rate_ex_vat', 'formula_5', 'custrecord_bb1_utilised_amt_inclusiv_vat',
            'formula_3', 'formula_4'
        ]);

        // Unit/Building-level columns that stay on the row regardless of lease status.
        const CSV_UNIT_LEVEL_COLUMNS = new Set([
            'name', 'addr1', 'addr2', 'zip', 'city', 'dropdownstate', 'country',
            'custrecord_bb1_unit_counter', 'custrecord_bb1_unit_area', 'custrecord_bb1_unit_status',
            'custrecord_bb1_building_portfolio', 'custrecord_bb1_unit_accommodation_type', 'name_1',
            'custrecord_bb1_unit_budget_rate'
        ]);
        const CSV_LEASE_DERIVED_COLUMNS = CSV_ROW_COLUMNS.filter((column) =>
            column !== 'formula_6' && !CSV_UNIT_LEVEL_COLUMNS.has(column));

        // Builds an "AND <column> IN (...)" filter fragment and pushes its ids onto params.
        // Must be called in the same order the fragments appear in the query text.
        const buildInFilter = (params, column, ids) => {
            if (!ids || !ids.length) return '';
            params.push(...ids);
            return ` AND ${column} IN (${ids.map(() => '?').join(', ')})`;
        }

        /**
         * Builds the SuiteQL query + params for the PDF's Unit/Lease/Charge data, given optional location/type filters.
         *
         * @param {Object} [filters]
         * @param {Array} [filters.portfolioIds]
         * @param {Array} [filters.buildingIds]
         * @param {Array} [filters.blockIds]
         * @param {Array} [filters.floorIds]
         * @param {Array} [filters.unitIds]
         * @param {Array} [filters.accommTypeIds]
         * @returns {{sql: string, params: Array}}
         */
        const buildQuery = (filters) => {
            const f = filters || {};
            const params = [];

            // Order must match how these filters appear in the query text below.
            const buildingFilter = buildInFilter(params, 'CUSTOMRECORD_CSEG_BB1_BUILDING."ID"', f.buildingIds);
            const blockFilter = buildInFilter(params, 'CUSTOMRECORD_CSEG_BB1_BLOCK."ID"', f.blockIds);
            const floorFilter = buildInFilter(params, 'CUSTOMRECORD_CSEG_BB1_FLOOR."ID"', f.floorIds);
            const unitFilter = buildInFilter(params, 'CUSTOMRECORD_CSEG_BB1_UNIT."ID"', f.unitIds);
            const portfolioFilter = buildInFilter(params,
                'MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.custrecord_bb1_building_portfolio_0_0_0_0',
                f.portfolioIds);
            const accommTypeFilter = buildInFilter(params, 'CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_accommodation_type', f.accommTypeIds);

            const sql = `
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
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_date AS custrecord_bb1_utilised_date,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_opt_months AS custrecord_bb1_lease_opt_months,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_rentescalation_per AS custrecord_bb1_lease_rentescalation_per,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) END AS formula_1,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) / CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_counter END AS formula_2,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rateareaexcl_vat AS custrecord_bb1_utilised_rateareaexcl_vat,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) <> 'Rent' THEN CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat END AS custrecord_bb1_utilised_rate_ex_vat,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) <> 'Rent' THEN CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat / CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_counter END AS formula_5,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_amt_inclusiv_vat AS custrecord_bb1_utilised_amt_inclusiv_vat,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) <> 'Rent' THEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) END AS custrecord_bb1_utilised_type,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) <> 'Rent' THEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utlised_item) END AS custrecord_bb1_utlised_item,
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
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_rentescalation_per AS custrecord_bb1_lease_rentescalation_per,
                    CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_type AS custrecord_bb1_utilised_type,
                    CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utlised_item AS custrecord_bb1_utlised_item,
                    CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_rate_ex_vat AS custrecord_bb1_utilised_rate_ex_vat,
                    CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_rateareaexcl_vat AS custrecord_bb1_utilised_rateareaexcl_vat,
                    CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_amt_inclusiv_vat AS custrecord_bb1_utilised_amt_inclusiv_vat,
                    CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_date AS custrecord_bb1_utilised_date,
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
                            MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building.maptwo = CUSTOMRECORD_CSEG_BB1_BUILDING."ID"${buildingFilter}
                          ) MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB
                        WHERE
                          CUSTOMRECORD_CSEG_BB1_BLOCK."ID" = MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.mapone(+)${blockFilter}
                        ) CUSTOMRECORD_CSEG_BB1_BLOCK_SUB
                      WHERE
                        MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block.maptwo = CUSTOMRECORD_CSEG_BB1_BLOCK_SUB."ID"
                      ) MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB
                    WHERE
                      CUSTOMRECORD_CSEG_BB1_FLOOR."ID" = MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.mapone(+)${floorFilter}
                    ) CUSTOMRECORD_CSEG_BB1_FLOOR_SUB
                  WHERE
                    MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor.maptwo = CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.id_0
                  ) MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB
                WHERE
                  CUSTOMRECORD_CSEG_BB1_UNIT."ID" = CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.cseg_bb1_unit(+)
                   AND CUSTOMRECORD_CSEG_BB1_UNIT."ID" = MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.mapone(+)${unitFilter}${portfolioFilter}${accommTypeFilter}
                ORDER BY
                  name,
                  accommodation_type_name,
                  name_1,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN 0 ELSE 1 END,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_description
            `;

            return {sql, params};
        }

        /**
         * Builds the SuiteQL query + params for the CSV export (Building/Unit/Tenant address, Occupied/Vacant, Bed).
         *
         * @param {Object} [filters] see buildQuery
         * @returns {{sql: string, params: Array}}
         */
        const buildCsvQuery = (filters) => {
            const f = filters || {};
            const params = [];

            // Order must match how these filters appear in the query text below.
            const buildingFilter = buildInFilter(params, 'CUSTOMRECORD_CSEG_BB1_BUILDING."ID"', f.buildingIds);
            const blockFilter = buildInFilter(params, 'CUSTOMRECORD_CSEG_BB1_BLOCK."ID"', f.blockIds);
            const floorFilter = buildInFilter(params, 'CUSTOMRECORD_CSEG_BB1_FLOOR."ID"', f.floorIds);
            const unitFilter = buildInFilter(params, 'CUSTOMRECORD_CSEG_BB1_UNIT."ID"', f.unitIds);
            const portfolioFilter = buildInFilter(params,
                'MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.custrecord_bb1_building_portfolio_0_0_0_0_0',
                f.portfolioIds);
            const accommTypeFilter = buildInFilter(params, 'CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_accommodation_type', f.accommTypeIds);

            const sql = `
                SELECT
                  MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.name_0_0_0_0_0 AS name,
                  CUSTOMRECORD_CSEG_BB1_UNIT."ID" AS unit_id,
                  MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.addr1_0_0_0_0_0_0_0 AS addr1,
                  MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.addr2_0_0_0_0_0_0_0 AS addr2,
                  MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.zip_0_0_0_0_0_0_0 AS zip,
                  MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.city_0_0_0_0_0_0_0 AS city,
                  MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.dropdownstate_0_0_0_0_0_0_0 AS dropdownstate,
                  MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.country_0_0_0_0_0_0_0 AS country,
                  CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_counter AS custrecord_bb1_unit_counter,
                  CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_area AS custrecord_bb1_unit_area,
                  BUILTIN.DF(CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_status) AS custrecord_bb1_unit_status,
                  MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.custrecord_bb1_building_portfolio_name_0_0_0_0_0 AS custrecord_bb1_building_portfolio,
                  BUILTIN.DF(CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_accommodation_type) AS custrecord_bb1_unit_accommodation_type,
                  CUSTOMRECORD_CSEG_BB1_UNIT.name AS name_1,
                  NVL2(BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_tenant), 'Occupied', 'Vacant') AS formula_6,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.cseg_bb1_bed AS cseg_bb1_bed,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.name AS name_2,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_future AS custrecord_bb1_lease_future,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.entityid_0 AS entityid,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.fullname_0 AS fullname,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custentity_bb1_group_tenant_0 AS custentity_bb1_group_tenant,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.email_0 AS email,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.phone_0 AS phone,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.addressbookaddress_0_0 AS addressbookaddress,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.addr1_0_0 AS addr1_1,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.addr2_0_0 AS addr2_1,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.zip_0_0 AS zip_1,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.city_0_0 AS city_1,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.dropdownstate_0_0 AS dropdownstate_1,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.country_0_0 AS country_1,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_start_date AS custrecord_bb1_lease_start_date,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_end_date AS custrecord_bb1_lease_end_date,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_review_date AS custrecord_bb1_lease_review_date,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_opt_months AS custrecord_bb1_lease_opt_months,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_rentescalation_per AS custrecord_bb1_lease_rentescalation_per,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_date AS custrecord_bb1_utilised_date,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) END AS formula_1,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) / CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_area END AS formula_2,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rateareaexcl_vat AS custrecord_bb1_utilised_rateareaexcl_vat,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) <> 'Rent' THEN CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat END AS custrecord_bb1_utilised_rate_ex_vat,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) <> 'Rent' THEN CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat / CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_area END AS formula_5,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_amt_inclusiv_vat AS custrecord_bb1_utilised_amt_inclusiv_vat,
                  TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) AS formula_3,
                  TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) / CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_area AS formula_4,
                  CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_budget_rate AS custrecord_bb1_unit_budget_rate
                FROM
                  CUSTOMRECORD_CSEG_BB1_UNIT,
                  (SELECT
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.cseg_bb1_unit AS cseg_bb1_unit,
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.cseg_bb1_unit AS cseg_bb1_unit_join,
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_tenant AS custrecord_bb1_lease_tenant,
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.cseg_bb1_bed AS cseg_bb1_bed,
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.name AS name,
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_future AS custrecord_bb1_lease_future,
                    Customer_SUB.entityid AS entityid_0,
                    Customer_SUB.fullname AS fullname_0,
                    Customer_SUB.custentity_bb1_group_tenant AS custentity_bb1_group_tenant_0,
                    Customer_SUB.email AS email_0,
                    Customer_SUB.phone AS phone_0,
                    Customer_SUB.addressbookaddress_0 AS addressbookaddress_0_0,
                    Customer_SUB.addr1_0 AS addr1_0_0,
                    Customer_SUB.addr2_0 AS addr2_0_0,
                    Customer_SUB.zip_0 AS zip_0_0,
                    Customer_SUB.city_0 AS city_0_0,
                    Customer_SUB.dropdownstate_0 AS dropdownstate_0_0,
                    Customer_SUB.country_0 AS country_0_0,
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_start_date AS custrecord_bb1_lease_start_date,
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_end_date AS custrecord_bb1_lease_end_date,
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_review_date AS custrecord_bb1_lease_review_date,
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_opt_months AS custrecord_bb1_lease_opt_months,
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_rentescalation_per AS custrecord_bb1_lease_rentescalation_per,
                    CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_type AS custrecord_bb1_utilised_type,
                    CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_rate_ex_vat AS custrecord_bb1_utilised_rate_ex_vat,
                    CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_rateareaexcl_vat AS custrecord_bb1_utilised_rateareaexcl_vat,
                    CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_amt_inclusiv_vat AS custrecord_bb1_utilised_amt_inclusiv_vat,
                    CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_date AS custrecord_bb1_utilised_date
                  FROM
                    CUSTOMRECORD_BB1_LEASE_CONTRACT,
                    (SELECT
                      Customer."ID" AS "ID",
                      Customer."ID" AS id_join,
                      Customer.entityid AS entityid,
                      Customer.fullname AS fullname,
                      Customer.custentity_bb1_group_tenant AS custentity_bb1_group_tenant,
                      Customer.email AS email,
                      Customer.phone AS phone,
                      customerAddressbook_SUB.addressbookaddress AS addressbookaddress_0,
                      customerAddressbook_SUB.addr1 AS addr1_0,
                      customerAddressbook_SUB.addr2 AS addr2_0,
                      customerAddressbook_SUB.zip AS zip_0,
                      customerAddressbook_SUB.city AS city_0,
                      customerAddressbook_SUB.dropdownstate AS dropdownstate_0,
                      customerAddressbook_SUB.country AS country_0
                    FROM
                      Customer,
                      (SELECT
                        customerAddressbook.entity AS entity,
                        customerAddressbook.entity AS entity_join,
                        customerAddressbook.addressbookaddress AS addressbookaddress,
                        customerAddressbookEntityAddress.addr1 AS addr1,
                        customerAddressbookEntityAddress.addr2 AS addr2,
                        customerAddressbookEntityAddress.zip AS zip,
                        customerAddressbookEntityAddress.city AS city,
                        customerAddressbookEntityAddress.dropdownstate AS dropdownstate,
                        customerAddressbookEntityAddress.country AS country
                      FROM
                        customerAddressbook,
                        customerAddressbookEntityAddress
                      WHERE
                        customerAddressbook.addressbookaddress = customerAddressbookEntityAddress.nkey(+)
                      ) customerAddressbook_SUB
                    WHERE
                      Customer."ID" = customerAddressbook_SUB.entity(+)
                    ) Customer_SUB,
                    CUSTOMRECORD_BB1_UTILISED_CHARGES
                  WHERE
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_tenant = Customer_SUB."ID"(+)
                     AND CUSTOMRECORD_BB1_LEASE_CONTRACT."ID" = CUSTOMRECORD_BB1_UTILISED_CHARGES.custrecord_bb1_utilised_lease(+)
                  ) CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB,
                  (SELECT
                    MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor.mapone AS mapone,
                    CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.name_0_0_0_0 AS name_0_0_0_0_0,
                    CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.addr1_0_0_0_0_0_0 AS addr1_0_0_0_0_0_0_0,
                    CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.addr2_0_0_0_0_0_0 AS addr2_0_0_0_0_0_0_0,
                    CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.zip_0_0_0_0_0_0 AS zip_0_0_0_0_0_0_0,
                    CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.city_0_0_0_0_0_0 AS city_0_0_0_0_0_0_0,
                    CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.dropdownstate_0_0_0_0_0_0 AS dropdownstate_0_0_0_0_0_0_0,
                    CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.country_0_0_0_0_0_0 AS country_0_0_0_0_0_0_0,
                    CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.custrecord_bb1_building_portfolio_0_0_0_0 AS custrecord_bb1_building_portfolio_0_0_0_0_0,
                    CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.custrecord_bb1_building_portfolio_name_0_0_0_0 AS custrecord_bb1_building_portfolio_name_0_0_0_0_0
                  FROM
                    MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor,
                    (SELECT
                      CUSTOMRECORD_CSEG_BB1_FLOOR."ID" AS id_2,
                      CUSTOMRECORD_CSEG_BB1_FLOOR."ID" AS id_join,
                      MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.name_0_0_0 AS name_0_0_0_0,
                      MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.addr1_0_0_0_0_0 AS addr1_0_0_0_0_0_0,
                      MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.addr2_0_0_0_0_0 AS addr2_0_0_0_0_0_0,
                      MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.zip_0_0_0_0_0 AS zip_0_0_0_0_0_0,
                      MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.city_0_0_0_0_0 AS city_0_0_0_0_0_0,
                      MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.dropdownstate_0_0_0_0_0 AS dropdownstate_0_0_0_0_0_0,
                      MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.country_0_0_0_0_0 AS country_0_0_0_0_0_0,
                      MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.custrecord_bb1_building_portfolio_0_0_0 AS custrecord_bb1_building_portfolio_0_0_0_0,
                      MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.custrecord_bb1_building_portfolio_name_0_0_0 AS custrecord_bb1_building_portfolio_name_0_0_0_0
                    FROM
                      CUSTOMRECORD_CSEG_BB1_FLOOR,
                      (SELECT
                        MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block.mapone AS mapone,
                        CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.name_0_0 AS name_0_0_0,
                        CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.addr1_0_0_0_0 AS addr1_0_0_0_0_0,
                        CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.addr2_0_0_0_0 AS addr2_0_0_0_0_0,
                        CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.zip_0_0_0_0 AS zip_0_0_0_0_0,
                        CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.city_0_0_0_0 AS city_0_0_0_0_0,
                        CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.dropdownstate_0_0_0_0 AS dropdownstate_0_0_0_0_0,
                        CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.country_0_0_0_0 AS country_0_0_0_0_0,
                        CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.custrecord_bb1_building_portfolio_0_0 AS custrecord_bb1_building_portfolio_0_0_0,
                        CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.custrecord_bb1_building_portfolio_name_0_0 AS custrecord_bb1_building_portfolio_name_0_0_0
                      FROM
                        MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block,
                        (SELECT
                          CUSTOMRECORD_CSEG_BB1_BLOCK."ID" AS id_1,
                          CUSTOMRECORD_CSEG_BB1_BLOCK."ID" AS id_join,
                          MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.name_0 AS name_0_0,
                          MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.addr1_0_0_0 AS addr1_0_0_0_0,
                          MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.addr2_0_0_0 AS addr2_0_0_0_0,
                          MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.zip_0_0_0 AS zip_0_0_0_0,
                          MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.city_0_0_0 AS city_0_0_0_0,
                          MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.dropdownstate_0_0_0 AS dropdownstate_0_0_0_0,
                          MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.country_0_0_0 AS country_0_0_0_0,
                          MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.custrecord_bb1_building_portfolio_0 AS custrecord_bb1_building_portfolio_0_0,
                          MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.custrecord_bb1_building_portfolio_name_0 AS custrecord_bb1_building_portfolio_name_0_0
                        FROM
                          CUSTOMRECORD_CSEG_BB1_BLOCK,
                          (SELECT
                            MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building.mapone AS mapone,
                            CUSTOMRECORD_CSEG_BB1_BUILDING_SUB.name AS name_0,
                            CUSTOMRECORD_CSEG_BB1_BUILDING_SUB.addr1_0_0 AS addr1_0_0_0,
                            CUSTOMRECORD_CSEG_BB1_BUILDING_SUB.addr2_0_0 AS addr2_0_0_0,
                            CUSTOMRECORD_CSEG_BB1_BUILDING_SUB.zip_0_0 AS zip_0_0_0,
                            CUSTOMRECORD_CSEG_BB1_BUILDING_SUB.city_0_0 AS city_0_0_0,
                            CUSTOMRECORD_CSEG_BB1_BUILDING_SUB.dropdownstate_0_0 AS dropdownstate_0_0_0,
                            CUSTOMRECORD_CSEG_BB1_BUILDING_SUB.country_0_0 AS country_0_0_0,
                            CUSTOMRECORD_CSEG_BB1_BUILDING_SUB.custrecord_bb1_building_portfolio AS custrecord_bb1_building_portfolio_0,
                            CUSTOMRECORD_CSEG_BB1_BUILDING_SUB.custrecord_bb1_building_portfolio_name AS custrecord_bb1_building_portfolio_name_0
                          FROM
                            MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building,
                            (SELECT
                              CUSTOMRECORD_CSEG_BB1_BUILDING."ID" AS id_0,
                              CUSTOMRECORD_CSEG_BB1_BUILDING."ID" AS id_join,
                              CUSTOMRECORD_CSEG_BB1_BUILDING.name AS name,
                              MAP_customrecord_cseg_bb1_building_cseg_bb1_building_filterby_subsidiary_SUB.addr1_0 AS addr1_0_0,
                              MAP_customrecord_cseg_bb1_building_cseg_bb1_building_filterby_subsidiary_SUB.addr2_0 AS addr2_0_0,
                              MAP_customrecord_cseg_bb1_building_cseg_bb1_building_filterby_subsidiary_SUB.zip_0 AS zip_0_0,
                              MAP_customrecord_cseg_bb1_building_cseg_bb1_building_filterby_subsidiary_SUB.city_0 AS city_0_0,
                              MAP_customrecord_cseg_bb1_building_cseg_bb1_building_filterby_subsidiary_SUB.dropdownstate_0 AS dropdownstate_0_0,
                              MAP_customrecord_cseg_bb1_building_cseg_bb1_building_filterby_subsidiary_SUB.country_0 AS country_0_0,
                              CUSTOMRECORD_CSEG_BB1_BUILDING.custrecord_bb1_building_portfolio AS custrecord_bb1_building_portfolio,
                              BUILTIN.DF(CUSTOMRECORD_CSEG_BB1_BUILDING.custrecord_bb1_building_portfolio) AS custrecord_bb1_building_portfolio_name
                            FROM
                              CUSTOMRECORD_CSEG_BB1_BUILDING,
                              (SELECT
                                MAP_customrecord_cseg_bb1_building_cseg_bb1_building_filterby_subsidiary.mapone AS mapone,
                                Subsidiary_SUB.addr1 AS addr1_0,
                                Subsidiary_SUB.addr2 AS addr2_0,
                                Subsidiary_SUB.zip AS zip_0,
                                Subsidiary_SUB.city AS city_0,
                                Subsidiary_SUB.dropdownstate AS dropdownstate_0,
                                Subsidiary_SUB.country AS country_0
                              FROM
                                MAP_customrecord_cseg_bb1_building_cseg_bb1_building_filterby_subsidiary,
                                (SELECT
                                  Subsidiary."ID" AS "ID",
                                  Subsidiary."ID" AS id_join,
                                  SubsidiaryMainAddress.addr1 AS addr1,
                                  SubsidiaryMainAddress.addr2 AS addr2,
                                  SubsidiaryMainAddress.zip AS zip,
                                  SubsidiaryMainAddress.city AS city,
                                  BUILTIN.DF(SubsidiaryMainAddress.dropdownstate) AS dropdownstate,
                                  BUILTIN.DF(SubsidiaryMainAddress.country) AS country
                                FROM
                                  Subsidiary,
                                  SubsidiaryMainAddress
                                WHERE
                                  Subsidiary.mainaddress = SubsidiaryMainAddress.nkey(+)
                                ) Subsidiary_SUB
                              WHERE
                                MAP_customrecord_cseg_bb1_building_cseg_bb1_building_filterby_subsidiary.maptwo = Subsidiary_SUB."ID"
                              ) MAP_customrecord_cseg_bb1_building_cseg_bb1_building_filterby_subsidiary_SUB
                            WHERE
                              CUSTOMRECORD_CSEG_BB1_BUILDING."ID" = MAP_customrecord_cseg_bb1_building_cseg_bb1_building_filterby_subsidiary_SUB.mapone(+)${buildingFilter}
                            ) CUSTOMRECORD_CSEG_BB1_BUILDING_SUB
                          WHERE
                            MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building.maptwo = CUSTOMRECORD_CSEG_BB1_BUILDING_SUB.id_0
                          ) MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB
                        WHERE
                          CUSTOMRECORD_CSEG_BB1_BLOCK."ID" = MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.mapone(+)${blockFilter}
                        ) CUSTOMRECORD_CSEG_BB1_BLOCK_SUB
                      WHERE
                        MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block.maptwo = CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.id_1
                      ) MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB
                    WHERE
                      CUSTOMRECORD_CSEG_BB1_FLOOR."ID" = MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.mapone(+)${floorFilter}
                    ) CUSTOMRECORD_CSEG_BB1_FLOOR_SUB
                  WHERE
                    MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor.maptwo = CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.id_2
                  ) MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB
                WHERE
                  CUSTOMRECORD_CSEG_BB1_UNIT."ID" = CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.cseg_bb1_unit(+)
                   AND CUSTOMRECORD_CSEG_BB1_UNIT."ID" = MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.mapone(+)${unitFilter}${portfolioFilter}${accommTypeFilter}
            `;

            return {sql, params};
        }

        const LIB_FX = {};

        LIB_FX.ROW_COLUMNS = ROW_COLUMNS;

        const toNumberOrNull = (value) => {
            if (value === null || value === undefined || value === '') return null;
            const num = Number(value);
            return isNaN(num) ? null : num;
        }

        // Matches SuiteQL's DD/MM/YYYY date strings, which JS's native Date parser would misread as MM/DD/YYYY.
        const DATE_DMY_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

        // Matches the As of Date param's YYYY-MM-DD format.
        const DATE_YMD_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

        // Strips the time off a date value for date-only comparisons. Returns null if unparseable.
        const toDateOnly = (value) => {
            if (value === null || value === undefined || value === '') return null;

            if (value instanceof Date) {
                return isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
            }

            const text = String(value).trim();

            const dmyMatch = DATE_DMY_PATTERN.exec(text);
            if (dmyMatch) {
                const day = Number(dmyMatch[1]);
                const month = Number(dmyMatch[2]);
                const year = Number(dmyMatch[3]);
                const date = new Date(year, month - 1, day);
                return isNaN(date.getTime()) ? null : date;
            }

            const ymdMatch = DATE_YMD_PATTERN.exec(text);
            if (ymdMatch) {
                const year = Number(ymdMatch[1]);
                const month = Number(ymdMatch[2]);
                const day = Number(ymdMatch[3]);
                const date = new Date(year, month - 1, day);
                return isNaN(date.getTime()) ? null : date;
            }

            // fallback for any other shape
            const date = new Date(text);
            return isNaN(date.getTime()) ? null : new Date(date.getFullYear(), date.getMonth(), date.getDate());
        }

        // Exposes toDateOnly for the PDF/CSV builders.
        LIB_FX.toDateOnly = toDateOnly;

        const roundTo2 = (num) => Math.round(num * 100) / 100;

        // True when a lease's Start Date has passed and its End Date (if any) hasn't.
        const isLeaseActive = (startDateValue, endDateValue, asOfDate) => {
            const start = toDateOnly(startDateValue);
            if (!start || start.getTime() > asOfDate.getTime()) return false;

            const end = toDateOnly(endDateValue);
            return !end || asOfDate.getTime() < end.getTime();
        }

        // True when a Charge Date falls in the same calendar month/year as the As of Date.
        const isSameMonth = (dateValue, asOfDate) => {
            const date = toDateOnly(dateValue);
            if (!date) return false;
            return date.getFullYear() === asOfDate.getFullYear() && date.getMonth() === asOfDate.getMonth();
        }

        // Turns one query row into a plain array, in ROW_COLUMNS order.
        LIB_FX.mapRowToColumns = (row) => ROW_COLUMNS.map((column) => {
            const value = row[column];
            return value === null || value === undefined ? '' : value;
        });

        // Runs the query, returning one row per unit/charge line.
        const runQuery = (filters) => {
            const {sql, params} = buildQuery(filters);
            return query.runSuiteQL({query: sql, params: params}).asMappedResults();
        }

        /**
         * CSV export rows, one per Unit per linked Building, with charge-line amounts summed into each row.
         *
         * @param {Object} [filters] see buildQuery
         * @param {Date} [asOfDate] date to evaluate lease activity/month scope against - defaults to today
         * Returns: [ [...CSV_ROW_COLUMNS order values...], ... ]
         */
        LIB_FX.getCsvRows = (filters, asOfDate) => {
            const {sql, params} = buildCsvQuery(filters);
            const rows = query.runSuiteQL({query: sql, params: params}).asMappedResults();
            const referenceDate = toDateOnly(asOfDate) || toDateOnly(new Date());

            // Group by Unit+Building, not Unit alone - a Unit's Block can link to more than one Building, so keying
            // on unit_id alone would merge/double-count charges across Buildings.
            const unitOrder = [];
            const unitsById = new Map();

            rows.forEach((row) => {
                const unitKey = `${row.unit_id}|${row.name || ''}`;
                if (!unitsById.has(unitKey)) {
                    unitsById.set(unitKey, []);
                    unitOrder.push(unitKey);
                }
                unitsById.get(unitKey).push(row);
            });

            return unitOrder.map((unitKey) => {
                const unitRows = unitsById.get(unitKey);
                const firstRow = unitRows[0];
                const hasActiveLease = isLeaseActive(
                    firstRow.custrecord_bb1_lease_start_date, firstRow.custrecord_bb1_lease_end_date, referenceDate);

                // Only charge lines dated in the As of Date's month are summed below.
                const monthRows = unitRows.filter((row) => isSameMonth(row.custrecord_bb1_utilised_date, referenceDate));

                return CSV_ROW_COLUMNS.map((column) => {
                    if (!hasActiveLease) {
                        if (column === 'formula_6') return 'Vacant';
                        if (CSV_LEASE_DERIVED_COLUMNS.includes(column)) return '';
                    }

                    if (!CSV_SUM_COLUMNS.has(column)) {
                        const value = firstRow[column];
                        return value === null || value === undefined ? '' : value;
                    }

                    let sum = 0;
                    let hasValue = false;
                    monthRows.forEach((row) => {
                        const num = toNumberOrNull(row[column]);
                        if (num !== null) {
                            sum += num;
                            hasValue = true;
                        }
                    });

                    return hasValue ? sum : '';
                });
            });
        }

        // Sums a unit list into one Accommodation Type group's totals, dividing rates by Occupied Area.
        const summarizeUnitTotals = (units) => {
            const totals = {area: 0, occupiedArea: 0, currentRent: 0, amount: 0, grossIncome: 0, vacantUnits: 0, activeLeaseUnits: 0};

            units.forEach((unit) => {
                totals.area += unit.area;
                totals.currentRent += unit.currentRent;
                totals.amount += unit.amountSum;
                totals.grossIncome += unit.grossIncome;
                if (unit.occupied) totals.occupiedArea += unit.area;
                // Summed by unit.area, not += 1 per record - a single Unit record's counter can represent several
                // physical units/bays, so a record count would undercount occupancy. Keeps these on the same scale as totals.area for vacancyPercent/occupancyPercent below.
                if (unit.hasActiveLease) totals.activeLeaseUnits += unit.area;
                else totals.vacantUnits += unit.area;
            });

            totals.rentRate = totals.occupiedArea ? totals.currentRent / totals.occupiedArea : null;
            totals.rate = totals.occupiedArea ? totals.amount / totals.occupiedArea : null;
            totals.grossRate = totals.occupiedArea ? totals.grossIncome / totals.occupiedArea : null;

            return totals;
        }

        /**
         * PDF export rows, grouped by Building then Accommodation Type then Unit, with subtotals at each level.
         *
         * @param {Object} [filters] see buildQuery
         * @param {Date} [asOfDate] date to evaluate lease activity against - defaults to today
         * Returns: [{ building, totals: {...}, accommodationGroups: [{ accommodationType, totals: {...}, rows: [[...], ...] }] }]
         */
        LIB_FX.getPropertyGroups = (filters, asOfDate) => {
            const rows = runQuery(filters);
            const referenceDate = toDateOnly(asOfDate) || toDateOnly(new Date());

            // Group by Unit+Building, not Unit alone - a Unit's Block can link to more than one Building, so keying
            // on unit_id alone would merge/double-count charges across Buildings.
            const unitOrder = [];
            const unitsById = new Map();

            rows.forEach((row) => {
                const unitKey = `${row.unit_id}|${row.name || ''}`;

                if (!unitsById.has(unitKey)) {
                    unitsById.set(unitKey, {
                        buildingName: row.name || '',
                        accommodationType: row.accommodation_type_name || '',
                        area: toNumberOrNull(row.custrecord_bb1_unit_counter) || 0,
                        rows: []
                    });
                    unitOrder.push(unitKey);
                }

                unitsById.get(unitKey).rows.push(row);
            });

            // Rebuilds unit.rows into a header row plus one row per Type+Description+Charge Date charge group.
            unitOrder.forEach((unitKey) => {
                const unit = unitsById.get(unitKey);
                const firstRow = unit.rows[0];

                let currentRent = null;
                let amountSum = 0;
                let hasCharge = false;

                const chargeGroupOrder = [];
                const chargeGroupsByKey = new Map();

                unit.rows.forEach((row) => {
                    // Only Rent/charge lines dated in the As of Date's month contribute to Current Rent/Amount/Gross Income.
                    if (!isSameMonth(row.custrecord_bb1_utilised_date, referenceDate)) return;

                    const rent = toNumberOrNull(row.formula_1);
                    if (rent !== null) currentRent = rent;

                    // Rent lines carry no Type, so this also excludes them from charge grouping.
                    const isChargeLine = row.custrecord_bb1_utilised_type !== null
                        && row.custrecord_bb1_utilised_type !== undefined
                        && row.custrecord_bb1_utilised_type !== '';
                    if (!isChargeLine) return;

                    const amount = toNumberOrNull(row.custrecord_bb1_utilised_rate_ex_vat);
                    if (amount !== null) {
                        amountSum += amount;
                        hasCharge = true;
                    }

                    // Other Chargings prints the item (not the type), so lines are grouped by Item+Description+Charge Date.
                    const key = `${row.custrecord_bb1_utlised_item}|${row.custrecord_bb1_utilised_description || ''}|${row.custrecord_bb1_utilised_date || ''}`;
                    if (!chargeGroupsByKey.has(key)) {
                        chargeGroupsByKey.set(key, {
                            item: row.custrecord_bb1_utlised_item,
                            description: row.custrecord_bb1_utilised_description,
                            date: row.custrecord_bb1_utilised_date,
                            amount: 0
                        });
                        chargeGroupOrder.push(key);
                    }
                    if (amount !== null) chargeGroupsByKey.get(key).amount += amount;
                });

                unit.hasActiveLease = isLeaseActive(
                    firstRow.custrecord_bb1_lease_start_date, firstRow.custrecord_bb1_lease_end_date, referenceDate);

                if (!unit.hasActiveLease) {
                    // Vacant as of this date - drop charge rows and blank lease-derived columns below.
                    chargeGroupOrder.length = 0;
                    currentRent = null;
                    amountSum = 0;
                    hasCharge = false;
                }

                unit.occupied = currentRent !== null;
                unit.currentRent = currentRent || 0;
                unit.amountSum = amountSum;

                const grossIncome = (currentRent !== null || hasCharge) ? (currentRent || 0) + amountSum : null;
                unit.grossIncome = grossIncome || 0;
                const grossRate = (grossIncome !== null && unit.area) ? grossIncome / unit.area : null;

                // Header row: unit/lease info + Current Rent/Rate, with charge-line detail blanked.
                const headerRow = Object.assign({}, firstRow);
                CHARGE_LINE_COLUMNS.forEach((column) => { headerRow[column] = null; });
                // Blanked so the Building name (printed via the header row) doesn't repeat on every unit.
                headerRow.name = null;
                headerRow.formula_1 = unit.hasActiveLease ? currentRent : null;
                headerRow.formula_2 = (unit.hasActiveLease && currentRent !== null && unit.area)
                    ? currentRent / unit.area : null;

                if (!unit.hasActiveLease) {
                    LEASE_DERIVED_COLUMNS.forEach((column) => { headerRow[column] = null; });
                }

                // One row per charge group, with unit/lease info blanked and charge detail + summed Amount/Rate shown.
                const chargeRows = chargeGroupOrder.map((key) => {
                    const group = chargeGroupsByKey.get(key);
                    const row = {};
                    CONTINUATION_BLANK_COLUMNS.forEach((column) => { row[column] = null; });
                    row.custrecord_bb1_utilised_date = group.date;
                    row.custrecord_bb1_utlised_item = group.item;
                    row.custrecord_bb1_utilised_description = group.description;
                    row.custrecord_bb1_utilised_rate_ex_vat = group.amount;
                    row.formula_5 = unit.area ? group.amount / unit.area : null;
                    return row;
                });

                unit.rows = [headerRow, ...chargeRows];

                const lastRow = unit.rows[unit.rows.length - 1];
                lastRow.formula_3 = grossIncome;
                lastRow.formula_4 = grossRate;
            });

            // Group units by Building, then by Accommodation Type within each Building, in first-seen order.
            const buildingOrder = [];
            const buildingsByName = new Map();

            unitOrder.forEach((unitKey) => {
                const unit = unitsById.get(unitKey);

                if (!buildingsByName.has(unit.buildingName)) {
                    buildingsByName.set(unit.buildingName, {typeOrder: [], typesByName: new Map()});
                    buildingOrder.push(unit.buildingName);
                }

                const building = buildingsByName.get(unit.buildingName);
                if (!building.typesByName.has(unit.accommodationType)) {
                    building.typesByName.set(unit.accommodationType, []);
                    building.typeOrder.push(unit.accommodationType);
                }
                building.typesByName.get(unit.accommodationType).push(unit);
            });

            return buildingOrder.map((buildingName) => {
                const building = buildingsByName.get(buildingName);

                const accommodationGroups = building.typeOrder.map((accommodationType) => {
                    const units = building.typesByName.get(accommodationType);
                    const flatRows = units.reduce((acc, unit) => acc.concat(unit.rows), []);

                    return {
                        accommodationType,
                        totals: summarizeUnitTotals(units),
                        rows: flatRows.map(LIB_FX.mapRowToColumns)
                    };
                });

                return {
                    building: buildingName,
                    // Reuses the same totals call the Grand Totals row uses across every Building.
                    totals: LIB_FX.getPropertyTotals(accommodationGroups),
                    accommodationGroups
                };
            });
        }

        /**
         * Sums a list of groups into a "Property Totals" or "Grand Totals" row, including area-weighted vacancy/occupancy percentages.
         */
        LIB_FX.getPropertyTotals = (groups) => {
            const totals = {area: 0, currentRent: 0, amount: 0, grossIncome: 0, vacantUnits: 0, activeLeaseUnits: 0};

            groups.forEach((group) => {
                totals.area += group.totals.area;
                totals.currentRent += group.totals.currentRent;
                totals.amount += group.totals.amount;
                totals.grossIncome += group.totals.grossIncome;
                totals.vacantUnits += group.totals.vacantUnits;
                totals.activeLeaseUnits += group.totals.activeLeaseUnits;
            });

            totals.rentRate = totals.area ? totals.currentRent / totals.area : null;
            totals.rate = totals.area ? totals.amount / totals.area : null;
            totals.grossRate = totals.area ? totals.grossIncome / totals.area : null;

            totals.vacancyArea = totals.vacantUnits;
            totals.vacancyPercent = totals.area ? roundTo2((totals.vacantUnits / totals.area) * 100) : null;
            totals.occupancyArea = totals.activeLeaseUnits;
            totals.occupancyPercent = totals.area ? roundTo2((totals.activeLeaseUnits / totals.area) * 100) : null;

            return totals;
        }

        return {LIB_FX};
    });