const mysql = require('mysql2/promise');
const config = require('./config/db.config.js');
async function run() {
  const pool = mysql.createPool({ ...config, database: 'reportdb' });
  const year = 2026;
  const [rows] = await pool.query(
      `WITH RECURSIVE category_descendants (root_category_id, id, category_id) AS (
           SELECT category_id, id, category_id FROM account_categories WHERE level = '항'
           UNION ALL
           SELECT cd.root_category_id, ac.id, ac.category_id
           FROM account_categories ac
           JOIN category_descendants cd ON ac.parent_id = cd.id
       ),
       budget_agg AS (
           SELECT cd.root_category_id, SUM(b.budget_amount) as budget_amount
           FROM category_descendants cd
           JOIN budgets b ON cd.category_id = b.category_id
           WHERE b.year = ?
           GROUP BY cd.root_category_id
       )
       SELECT h.category_id, h.category_name, b.budget_amount
       FROM account_categories h
       LEFT JOIN budget_agg b ON h.category_id = b.root_category_id
       WHERE h.level = '항' AND h.category_id = 'ACC00120000'`,
      [year]
    );
  console.log(rows);
  process.exit(0);
}
run();
