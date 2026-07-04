const mysql = require('mysql2/promise');
const config = require('./config/db.config.js');

async function run() {
  const pool = mysql.createPool({ ...config, database: 'reportdb' });
  const year = 2026;
  const conditions = ["d.parent_dept_id IS NOT NULL"];
  const params = [year, year];
  const [rows] = await pool.query(
      `
      WITH RECURSIVE category_descendants (root_id, root_category_id, id, category_id) AS (
          SELECT id, category_id, id, category_id FROM account_categories
          UNION ALL
          SELECT cd.root_id, cd.root_category_id, ac.id, ac.category_id
          FROM account_categories ac
          JOIN category_descendants cd ON ac.parent_id = cd.id
      ),
      budget_agg AS (
          SELECT cd.root_category_id, SUM(b.budget_amount) as total_budget
          FROM category_descendants cd
          JOIN budgets b ON cd.category_id = b.category_id
          WHERE b.year = ?
          GROUP BY cd.root_category_id
      ),
      expense_agg AS (
          SELECT cd.root_category_id, ed.dept_id, SUM(ed.amount) as total_expense
          FROM category_descendants cd
          JOIN expense_details ed ON cd.category_id = ed.category_id
          WHERE ed.year = ?
          GROUP BY cd.root_category_id, ed.dept_id
      )
      SELECT 
          hang.category_id AS hang_category_id,
          hang.category_name AS hang_name,
          MAX(COALESCE(b_full.total_budget,0)) as hang_total_budget
      FROM departments d
      INNER JOIN account_category_departments acd ON acd.dept_id = d.id
      INNER JOIN account_categories hang ON hang.id = acd.account_category_id AND hang.level = '항'
      LEFT JOIN budget_agg b_full ON b_full.root_category_id = hang.category_id
      WHERE hang.category_id = 'ACC00120000'
      GROUP BY hang.category_id, hang.category_name
      `,
      params
    );
  console.log(rows);
  process.exit(0);
}
run();
