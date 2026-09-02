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
 * 08/26/2026     Jared Espineli        Added Accommodation Type id 7 to the temporary test filter
 * 08/26/2026     Jared Espineli        Added getPropertyTotals() for the grand Property Totals row (Vacancy/Occupancy TBD)
 * 08/27/2026     Jared Espineli        Replaced the temporary hardcoded Accommodation Type filter with real Suitelet-driven
 *                                      filters: Property Portfolio, Building/Block/Floor/Unit (hierarchical) and Accommodation Type
 * 08/27/2026     Jared Espineli        Added active-lease detection (Starts/Expires Date vs. today) and Total Vacancy/Occupancy
 *                                      figures in getPropertyTotals()
 * 08/28/2026     Jared Espineli        Fixed toDateOnly() misparsing this account's DD/MM/YYYY dates as MM/DD/YYYY (every
 *                                      lease was reading as expired/dateless, so every unit showed as vacant)
 * 08/28/2026     Jared Espineli        Replaced getFlatRows() with getCsvRows(), sourced from the updated CSV workbook
 *                                      query (buildCsvQuery) - raw data, one row per Unit, charge-line amounts summed
 * 08/28/2026     Jared Espineli        As of Date now drives per-row lease activity in both getAccommodationGroups (PDF)
 *                                      and getCsvRows (CSV), not just the Vacancy/Occupancy totals - a unit whose lease
 *                                      isn't active as of that date reads as vacant. toDateOnly exposed via LIB_FX so the
 *                                      PDF/CSV builders parse the As of Date param with the same DD/MM/YYYY-aware logic
 * 08/28/2026     Jared Espineli        isLeaseActive now also checks the Starts Date isn't in the future relative to the
 *                                      As of Date - a lease active = Starts <= As of Date AND (no Expires OR As of Date < Expires)
 * 08/28/2026     Jared Espineli        buildCsvQuery updated for 3 new workbook columns - custrecord_bb1_lease_future,
 *                                      the tenant's entityid and custentity_bb1_group_tenant - CSV export only, per updated
 *                                      workbook query
 * 09/02/2026     Jared Espineli        Added custrecord_bb1_utilised_date (Charge Date) to buildQuery/ROW_COLUMNS -
 *                                      new PDF column, between Review and Months Option. Charge-line-level like Type/
 *                                      Description, so left out of CONTINUATION_BLANK_COLUMNS (prints on every charge
 *                                      row, not just the unit's first)
 * 09/02/2026     Jared Espineli        getAccommodationGroups reworked: Rent lines (no Type/Description) no longer
 *                                      print their own near-empty row - their Current Rent is folded into a single
 *                                      header row per unit. Remaining charge lines are grouped by Type+Description+
 *                                      Charge Date and summed into one row per group, instead of one row per raw
 *                                      charge-line record (e.g. two Effluent charges both dated 04/01/2027 now total
 *                                      into a single 04/01/2027 Effluent row)
 * 09/02/2026     Jared Espineli        Report now scoped to the single calendar month covered by the As of Date -
 *                                      added isSameMonth() and used it to skip Rent/charge lines whose Charge Date
 *                                      falls outside that month in both getAccommodationGroups (PDF) and getCsvRows
 *                                      (CSV), so e.g. As of Date = 02/09/2026 only totals September 2026 rent/charges.
 *                                      buildCsvQuery updated to also select custrecord_bb1_utilised_date (Charge
 *                                      Date), needed for this filter but not added to CSV_ROW_COLUMNS/output
 * 09/02/2026     Jared Espineli        Removed custrecord_bb1_utilised_date (Charge Date) from ROW_COLUMNS - no
 *                                      longer printed as its own PDF column. Still selected by buildQuery/
 *                                      buildCsvQuery and used internally by isSameMonth and the charge-line
 *                                      grouping key, just excluded from the mapped output row
 *
 * Copyright (c) 2022 BlueBridge One Business Solutions, All Rights Reserved [Replace appropriately]
 * support@bluebridgeone.com, +44 (0)1932 300007
 */
define(['N/query'],
    /**
     * @param{query} query
     */
    (query) => {

        // Maps each PDF column to its query field. Gross Income/Gross Rate
        // (formula_3/formula_4) are computed in JS, not SQL - see
        // getAccommodationGroups. Area uses the unit counter field, not
        // custrecord_bb1_unit_area (that field is empty here). PDF-only -
        // see CSV_ROW_COLUMNS below for the CSV export's own column set.
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
        // once per unit in the PDF (not used by the CSV path below).
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

        // ROW_COLUMNS entries that come from the Lease/Tenant/Utilised
        // Charge join, not the Unit record itself. When a unit's lease
        // isn't active as of the As of Date (see isLeaseActive below), these
        // are blanked so the unit reads as vacant for that date - only
        // Premises/Area/Units-Parking/Budget Rate (Unit-level fields) stay.
        const LEASE_DERIVED_COLUMNS = ROW_COLUMNS.filter((column) =>
            !['name', 'custrecord_bb1_unit_counter', 'name_1', 'custrecord_bb1_unit_budget_rate'].includes(column));

        // ROW_COLUMNS entries that only ever hold charge-line detail (Other
        // Chargings/Description/Amount/Rate) - blanked on a unit's header
        // row in getAccommodationGroups, which carries the unit/lease info +
        // Current Rent instead. Gross Income/Gross Rate (formula_3/
        // formula_4) are handled separately (attached to the unit's last
        // row), so they're excluded here too.
        const CHARGE_LINE_COLUMNS = ROW_COLUMNS.filter((column) =>
            !CONTINUATION_BLANK_COLUMNS.includes(column) && column !== 'formula_3' && column !== 'formula_4');

        // CSV export columns, in the order they're printed - one query field
        // per CSV column, per the updated workbook (see buildCsvQuery). Type/
        // Description are deliberately excluded: they're per-charge-line text
        // (e.g. "Fixed"/"Fixed Effluent") that can't collapse into a single
        // value once a unit's charge lines are merged into one CSV row.
        const CSV_ROW_COLUMNS = [
            'name', 'addr1', 'addr2', 'zip', 'city', 'dropdownstate', 'country',
            'custrecord_bb1_unit_counter', 'custrecord_bb1_unit_area', 'custrecord_bb1_unit_status',
            'custrecord_bb1_building_portfolio', 'custrecord_bb1_unit_accommodation_type', 'name_1',
            'formula_6', 'cseg_bb1_bed', 'name_2',
            'custrecord_bb1_lease_future', 'entityid',
            'fullname', 'custentity_bb1_group_tenant', 'email', 'phone', 'addressbookaddress', 'addr1_1', 'addr2_1', 'zip_1', 'city_1',
            'dropdownstate_1', 'country_1',
            'custrecord_bb1_lease_start_date', 'custrecord_bb1_lease_end_date', 'custrecord_bb1_lease_review_date',
            'custrecord_bb1_lease_opt_months', 'custrecord_bb1_lease_rent_escalation',
            'formula_1', 'formula_2', 'custrecord_bb1_utilised_rateareaexcl_vat', 'custrecord_bb1_utilised_rate_ex_vat',
            'formula_5', 'custrecord_bb1_utilised_amt_inclusiv_vat', 'formula_3', 'formula_4',
            'custrecord_bb1_unit_budget_rate'
        ];

        // These CSV columns are per-charge-line amounts (sourced from the
        // Utilised Charges join) - when a unit has multiple charge lines,
        // they're summed into that unit's single CSV row. Every other
        // CSV_ROW_COLUMNS entry is a Unit/Lease/Tenant-level field that's
        // identical across all of a unit's charge lines, so it's just read
        // off the first row.
        const CSV_SUM_COLUMNS = new Set([
            'formula_1', 'formula_2', 'custrecord_bb1_utilised_rateareaexcl_vat',
            'custrecord_bb1_utilised_rate_ex_vat', 'formula_5', 'custrecord_bb1_utilised_amt_inclusiv_vat',
            'formula_3', 'formula_4'
        ]);

        // CSV_ROW_COLUMNS entries that come from the Unit/Building record
        // itself, not the Lease/Tenant/Utilised Charge join - these stay on
        // the row regardless of whether the unit's lease is active as of
        // the As of Date. Everything else in CSV_ROW_COLUMNS is lease-
        // derived and gets blanked when the lease isn't active (formula_6,
        // the Occupancy column, is handled separately - see getCsvRows).
        const CSV_UNIT_LEVEL_COLUMNS = new Set([
            'name', 'addr1', 'addr2', 'zip', 'city', 'dropdownstate', 'country',
            'custrecord_bb1_unit_counter', 'custrecord_bb1_unit_area', 'custrecord_bb1_unit_status',
            'custrecord_bb1_building_portfolio', 'custrecord_bb1_unit_accommodation_type', 'name_1',
            'custrecord_bb1_unit_budget_rate'
        ]);
        const CSV_LEASE_DERIVED_COLUMNS = CSV_ROW_COLUMNS.filter((column) =>
            column !== 'formula_6' && !CSV_UNIT_LEVEL_COLUMNS.has(column));

        // Builds an "AND <column> IN (?, ?, ...)" fragment for a filter's id
        // list and pushes those ids onto params in the same order. Must be
        // called in the exact order its fragment appears in the query text,
        // left to right, so the '?' placeholders line up with params.
        // Returns '' (no params pushed) when the filter has no ids selected.
        const buildInFilter = (params, column, ids) => {
            if (!ids || !ids.length) return '';
            params.push(...ids);
            return ` AND ${column} IN (${ids.map(() => '?').join(', ')})`;
        }

        /**
         * Builds the parameterized SuiteQL query + its params array for the
         * given filters. Every filter is optional - an empty/missing list
         * means "no restriction" at that level.
         *
         * Building/Block/Floor are filtered where each record's own table is
         * joined (deep inside the nested Unit->Floor->Block->Building
         * lookup), so a Building/Block/Floor filter restricts Units to those
         * under the selected record, matching the Suitelet's cascading
         * Building -> Block -> Floor -> Unit filters. Unit, Property
         * Portfolio (linked to the Building record) and Accommodation Type
         * are filtered on the outer query, against the Unit record.
         *
         * derived from this workbook: https://11536405.app.netsuite.com/app/common/report/report.nl?workbook=9
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

            // order matches the left-to-right order these fragments appear
            // in the query text below - keep both in sync
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
                  accommodation_type_name,
                  name_1,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN 0 ELSE 1 END,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_description
            `;

            return {sql, params};
        }

        /**
         * Builds the parameterized SuiteQL query + its params array for the
         * CSV export's updated workbook (Building/Unit/Tenant address
         * details, Occupied/Vacant, Bed). Same cascading Building -> Block ->
         * Floor -> Unit filter structure as buildQuery, applied at the same
         * joins, so the CSV honors the Suitelet's filters exactly like the
         * PDF does. unit_id is added (not part of the workbook export) so
         * getCsvRows can group a unit's charge lines into one row.
         *
         * @param {Object} [filters] see buildQuery
         * @returns {{sql: string, params: Array}}
         */
        const buildCsvQuery = (filters) => {
            const f = filters || {};
            const params = [];

            // order matches the left-to-right order these fragments appear
            // in the query text below - keep both in sync
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
                  CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_status AS custrecord_bb1_unit_status,
                  MAP_customrecord_cseg_bb1_unit_cseg_bb1_unit_filterby_cseg_bb1_floor_SUB.custrecord_bb1_building_portfolio_0_0_0_0_0 AS custrecord_bb1_building_portfolio,
                  CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_accommodation_type AS custrecord_bb1_unit_accommodation_type,
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
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_lease_rent_escalation AS custrecord_bb1_lease_rent_escalation,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_date AS custrecord_bb1_utilised_date,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) END AS formula_1,
                  CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) / CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_counter END AS formula_2,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rateareaexcl_vat AS custrecord_bb1_utilised_rateareaexcl_vat,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat AS custrecord_bb1_utilised_rate_ex_vat,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat / CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_counter AS formula_5,
                  CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_amt_inclusiv_vat AS custrecord_bb1_utilised_amt_inclusiv_vat,
                  TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) + CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) END AS formula_3,
                  (TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) + CASE WHEN BUILTIN.DF(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_type) = 'Rent' THEN TO_NUMBER(CUSTOMRECORD_BB1_LEASE_CONTRACT_SUB.custrecord_bb1_utilised_rate_ex_vat) END) / CUSTOMRECORD_CSEG_BB1_UNIT.custrecord_bb1_unit_counter AS formula_4,
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
                    CUSTOMRECORD_BB1_LEASE_CONTRACT.custrecord_bb1_lease_rent_escalation AS custrecord_bb1_lease_rent_escalation,
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
                    CUSTOMRECORD_CSEG_BB1_FLOOR_SUB.custrecord_bb1_building_portfolio_0_0_0_0 AS custrecord_bb1_building_portfolio_0_0_0_0_0
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
                      MAP_customrecord_cseg_bb1_floor_cseg_bb1_floor_filterby_cseg_bb1_block_SUB.custrecord_bb1_building_portfolio_0_0_0 AS custrecord_bb1_building_portfolio_0_0_0_0
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
                        CUSTOMRECORD_CSEG_BB1_BLOCK_SUB.custrecord_bb1_building_portfolio_0_0 AS custrecord_bb1_building_portfolio_0_0_0
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
                          MAP_customrecord_cseg_bb1_block_cseg_bb1_block_filterby_cseg_bb1_building_SUB.custrecord_bb1_building_portfolio_0 AS custrecord_bb1_building_portfolio_0_0
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
                            CUSTOMRECORD_CSEG_BB1_BUILDING_SUB.custrecord_bb1_building_portfolio AS custrecord_bb1_building_portfolio_0
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
                              CUSTOMRECORD_CSEG_BB1_BUILDING.custrecord_bb1_building_portfolio AS custrecord_bb1_building_portfolio
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
                                  SubsidiaryMainAddress.dropdownstate AS dropdownstate,
                                  SubsidiaryMainAddress.country AS country
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

        // SuiteQL date columns come back as plain strings in the account's
        // date format (this account: DD/MM/YYYY, e.g. "26/08/2026") - NOT
        // ISO. JS's native Date parser assumes MM/DD/YYYY for that shape, so
        // any day > 12 (e.g. "26/08/2026") silently misparses to Invalid
        // Date. Parse DD/MM/YYYY explicitly instead of trusting new Date().
        const DATE_DMY_PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

        // The Suitelet's As of Date param arrives as "YYYY-MM-DD" (see
        // buildReportUrl in lib_helper.js - sent this way specifically to
        // avoid timezone ambiguity). Parsed explicitly here too: plain
        // `new Date("YYYY-MM-DD")` treats that shape as UTC midnight, which
        // - once broken back into Y/M/D using this runtime's local
        // timezone - can land on the wrong calendar day.
        const DATE_YMD_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;

        // Strips the time portion off a date value (SuiteQL date string,
        // the As of Date param, or a Date), for date-only comparisons.
        // Returns null if unparseable.
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

        // Exposed so the PDF/CSV builders can parse the Suitelet's As of
        // Date param with the same DD/MM/YYYY-aware logic as the lease
        // dates - it's the same account-formatted date string shape, so the
        // same MM/DD/YYYY misparse risk applies if parsed with plain
        // `new Date(...)`. Returns null if unparseable/empty.
        LIB_FX.toDateOnly = toDateOnly;

        const roundTo2 = (num) => Math.round(num * 100) / 100;

        // A unit's lease is "active" as of a given date when its Starts Date
        // exists and isn't in the future relative to that date, AND either
        // there's no Expires Date (open-ended/month-to-month lease with no
        // end) or that date is before the Expires Date.
        const isLeaseActive = (startDateValue, endDateValue, asOfDate) => {
            const start = toDateOnly(startDateValue);
            if (!start || start.getTime() > asOfDate.getTime()) return false;

            const end = toDateOnly(endDateValue);
            return !end || asOfDate.getTime() < end.getTime();
        }

        // True when a Utilised Charge's Charge Date falls in the same
        // calendar month/year as the As of Date - e.g. As of Date =
        // 02/09/2026 only matches charge lines dated in September 2026.
        // Drives the report's "one month at a time" scope: Rent/charge
        // lines dated outside that month don't contribute to Current
        // Rent/Amount/Gross Income (see getAccommodationGroups/getCsvRows).
        // Returns false for a missing/unparseable Charge Date (e.g. a
        // vacant unit's outer-joined charge columns).
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

        // Runs the query - one row per unit/charge line, ordered by
        // Accommodation Type, then Unit, then Rent line first.
        const runQuery = (filters) => {
            const {sql, params} = buildQuery(filters);
            return query.runSuiteQL({query: sql, params: params}).asMappedResults();
        }

        /**
         * CSV export rows, from the updated workbook query (buildCsvQuery) -
         * raw data, one row per Unit (not per charge line). A unit with
         * multiple charge lines (Rent + Fixed Effluent + Fixed Refuse, etc.)
         * has its CSV_SUM_COLUMNS amounts summed across those lines into a
         * single row; every other CSV_ROW_COLUMNS field is read off the
         * first charge line, since it's identical across all of a unit's
         * charge lines (Unit/Lease/Tenant-level data, not charge-level).
         *
         * As of Date drives the same active-lease check as the PDF (see
         * getAccommodationGroups): when a unit's lease isn't active as of
         * that date, its CSV_LEASE_DERIVED_COLUMNS (Tenant/Starts/Expires/
         * amounts/etc.) are blanked and its Occupancy column (formula_6)
         * reads 'Vacant', overriding the workbook's own Occupied/Vacant
         * value (which only checks whether a Tenant exists, not dates).
         *
         * The report is also scoped to the single calendar month the As of
         * Date falls in: only Rent/charge lines dated in that month (see
         * isSameMonth) are included in the CSV_SUM_COLUMNS totals - e.g. As
         * of Date = 02/09/2026 sums September 2026 rent/charges only, even
         * if the lease has charge lines dated in other months.
         *
         * @param {Object} [filters] see buildQuery
         * @param {Date} [asOfDate] date to evaluate lease activity/month scope against - defaults to today
         * Returns: [ [...CSV_ROW_COLUMNS order values...], ... ]
         */
        LIB_FX.getCsvRows = (filters, asOfDate) => {
            const {sql, params} = buildCsvQuery(filters);
            const rows = query.runSuiteQL({query: sql, params: params}).asMappedResults();
            const referenceDate = toDateOnly(asOfDate) || toDateOnly(new Date());

            const unitOrder = [];
            const unitsById = new Map();

            rows.forEach((row) => {
                const unitId = row.unit_id;
                if (!unitsById.has(unitId)) {
                    unitsById.set(unitId, []);
                    unitOrder.push(unitId);
                }
                unitsById.get(unitId).push(row);
            });

            return unitOrder.map((unitId) => {
                const unitRows = unitsById.get(unitId);
                const firstRow = unitRows[0];
                const hasActiveLease = isLeaseActive(
                    firstRow.custrecord_bb1_lease_start_date, firstRow.custrecord_bb1_lease_end_date, referenceDate);

                // Report scope is one calendar month at a time - only
                // Rent/charge lines dated in the As of Date's month get
                // summed into CSV_SUM_COLUMNS below, same restriction as
                // the PDF (see getAccommodationGroups).
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

        /**
         * PDF export rows: groups by Unit first (to compute each unit's
         * Gross Income/Gross Rate, shown on its last row only), then by
         * Accommodation Type (to compute that type's subtotal row).
         * A unit is "occupied" if it has a Current Rent value - only
         * occupied units' area counts as "Occupied Area", which Rent
         * Rate/Rate/Gross Rate divide by instead of the type's full area.
         *
         * Each unit prints as: one header row (Premises/Area/Tenant/Starts/
         * Expires/Review/Months Option/Rent Esc%/Current Rent/Rent
         * Rate/Budget Rate), followed by one row per distinct Type+
         * Description+Charge Date charge group, each showing that group's
         * summed Amount/Rate - so e.g. two Effluent charges both dated
         * 04/01/2027 print as a single 04/01/2027 Effluent row totalling
         * both. Rent lines (the ones with no Type/Description - see
         * buildQuery) never get their own row: their value is already
         * folded into the header row's Current Rent, so printing them added
         * rows with nothing to show but a Charge Date.
         *
         * A unit "has an active lease contract" as of the As of Date when
         * its Starts Date isn't in the future relative to that date, AND
         * either there's no Expires Date or that date is before the Expires
         * Date (see isLeaseActive). This drives the Total Vacancy/Occupancy
         * figures (see getPropertyTotals) AND the row
         * data itself: a unit whose lease isn't active as of the As of Date
         * reads as vacant on the report - its lease-derived columns
         * (LEASE_DERIVED_COLUMNS) are blanked and it prints only its header
         * row (no charge groups), so it no longer contributes to Current
         * Rent/Amount/Gross Income and no longer counts as "occupied" above
         * either.
         *
         * The report is also scoped to the single calendar month the As of
         * Date falls in: a Rent/charge line only contributes to Current
         * Rent/Amount/Gross Income (and to the charge groups above) when its
         * Charge Date is in that same month (see isSameMonth) - e.g. As of
         * Date = 02/09/2026 shows September 2026 rent/charges only, even for
         * an active lease with charge lines dated in other months.
         *
         * @param {Object} [filters] see buildQuery
         * @param {Date} [asOfDate] date to evaluate lease activity against - defaults to today
         * Returns: [{ accommodationType, totals: {...}, rows: [[...], ...] }]
         */
        LIB_FX.getAccommodationGroups = (filters, asOfDate) => {
            const rows = runQuery(filters);
            const referenceDate = toDateOnly(asOfDate) || toDateOnly(new Date());

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
            // Gross Rate, then rebuild unit.rows as: one header row (unit/
            // lease info + Current Rent/Rate) followed by one row per
            // distinct Type+Description+Charge Date charge group, each
            // summing that group's Amount - e.g. two Effluent charges both
            // dated 04/01/2027 collapse into a single 04/01/2027 Effluent
            // row totalling both amounts. Rent lines (no Type/Description -
            // see buildQuery) are dropped from the printed rows entirely:
            // their contribution is already captured via Current Rent on
            // the header row, so printing them added rows with nothing but
            // a Charge Date to show. Gross figures are attached to the
            // unit's last row (header row if it ends up with no charges).
            unitOrder.forEach((unitId) => {
                const unit = unitsById.get(unitId);
                const firstRow = unit.rows[0];

                let currentRent = null;
                let amountSum = 0;
                let hasCharge = false;

                const chargeGroupOrder = [];
                const chargeGroupsByKey = new Map();

                unit.rows.forEach((row) => {
                    // Report scope is one calendar month at a time - only
                    // Rent/charge lines dated in the As of Date's month
                    // contribute to Current Rent/Amount/Gross Income; a
                    // charge dated in a different month (e.g. a future
                    // Effluent charge) is skipped entirely for this run.
                    if (!isSameMonth(row.custrecord_bb1_utilised_date, referenceDate)) return;

                    const rent = toNumberOrNull(row.formula_1);
                    if (rent !== null) currentRent = rent;

                    // Rent lines carry no Type (only non-Rent charge lines
                    // do - see buildQuery's CASE WHEN <> 'Rent'), so this
                    // also excludes them from the charge grouping below.
                    const isChargeLine = row.custrecord_bb1_utilised_type !== null
                        && row.custrecord_bb1_utilised_type !== undefined
                        && row.custrecord_bb1_utilised_type !== '';
                    if (!isChargeLine) return;

                    const amount = toNumberOrNull(row.custrecord_bb1_utilised_rate_ex_vat);
                    if (amount !== null) {
                        amountSum += amount;
                        hasCharge = true;
                    }

                    const key = `${row.custrecord_bb1_utilised_type}|${row.custrecord_bb1_utilised_description || ''}|${row.custrecord_bb1_utilised_date || ''}`;
                    if (!chargeGroupsByKey.has(key)) {
                        chargeGroupsByKey.set(key, {
                            type: row.custrecord_bb1_utilised_type,
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
                    // Reads as vacant for this As of Date: no charge rows,
                    // just the header row below with every lease-derived
                    // column blanked.
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

                // Header row: unit/lease info + Current Rent/Rate, no
                // charge-line detail (CHARGE_LINE_COLUMNS blanked).
                const headerRow = Object.assign({}, firstRow);
                CHARGE_LINE_COLUMNS.forEach((column) => { headerRow[column] = null; });
                headerRow.formula_1 = unit.hasActiveLease ? currentRent : null;
                headerRow.formula_2 = (unit.hasActiveLease && currentRent !== null && unit.area)
                    ? currentRent / unit.area : null;

                if (!unit.hasActiveLease) {
                    LEASE_DERIVED_COLUMNS.forEach((column) => { headerRow[column] = null; });
                }

                // One row per charge group: unit/lease info blanked
                // (CONTINUATION_BLANK_COLUMNS), charge detail + summed
                // Amount/Rate shown.
                const chargeRows = chargeGroupOrder.map((key) => {
                    const group = chargeGroupsByKey.get(key);
                    const row = {};
                    CONTINUATION_BLANK_COLUMNS.forEach((column) => { row[column] = null; });
                    row.custrecord_bb1_utilised_date = group.date;
                    row.custrecord_bb1_utilised_type = group.type;
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
                const totals = {area: 0, occupiedArea: 0, currentRent: 0, amount: 0, grossIncome: 0, vacantUnits: 0, activeLeaseUnits: 0};

                units.forEach((unit) => {
                    totals.area += unit.area;
                    totals.currentRent += unit.currentRent;
                    totals.amount += unit.amountSum;
                    totals.grossIncome += unit.grossIncome;
                    if (unit.occupied) totals.occupiedArea += unit.area;
                    if (unit.hasActiveLease) totals.activeLeaseUnits += 1;
                    else totals.vacantUnits += 1;
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

        /**
         * Grand "Property Totals" row: sums each Accommodation Type group's
         * totals (from getAccommodationGroups) across the whole property.
         * Unlike the per-group subtotals, Rent Rate/Rate/Gross Rate here
         * divide by total Area (not Occupied Area), per the report spec.
         *
         * Also computes the Total Vacancy/Total Occupancy figures:
         *  - vacancyArea = count of units without an active lease contract
         *  - vacancyPercent = vacancyArea / Property Totals Area * 100, rounded to 2 decimals
         *  - occupancyArea = count of units with an active lease contract
         *  - occupancyTenant = Property Totals Area - vacancyArea
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
            totals.occupancyTenant = totals.area - totals.vacantUnits;

            return totals;
        }

        return {LIB_FX};
    });