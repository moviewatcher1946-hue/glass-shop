// Admin+ Pack: extra read-only tools (SQL, admin only) + a few safe action buttons. Mounted from server.js.
// Each entry: [group, title, path, kind, sql]. kind: l = list, s = stat, b = bars (aliases label,value). Nothing here can change data except the 'a' actions below.
const MNL = "(now() AT TIME ZONE 'Asia/Manila')::date", OD = "(o.created_at AT TIME ZONE 'Asia/Manila')::date", OK = "o.status<>'cancelled'";
const D = (d) => `o.created_at>now()-interval '${d} days'`;
const PACK = [
  // ---- Security
  ['Security', 'Staff accounts', 'sec-staff', 'l', "SELECT id,username,role,created_at FROM users WHERE role<>'customer' ORDER BY id"],
  ['Security', 'New staff accounts (30 days)', 'sec-staff-new', 'l', "SELECT id,username,role,created_at FROM users WHERE role<>'customer' AND created_at>now()-interval '30 days' ORDER BY id DESC"],
  ['Security', 'Accounts by role', 'sec-roles', 'b', 'SELECT role label,COUNT(*)::int value FROM users GROUP BY role ORDER BY value DESC'],
  ['Security', 'Admin actions (latest 50)', 'sec-admin-actions', 'l', "SELECT at,username,action,detail FROM audit_log WHERE role='admin' ORDER BY id DESC LIMIT 50"],
  ['Security', 'Activity, last 24 hours', 'sec-activity-24', 'l', "SELECT username,action,COUNT(*)::int times FROM audit_log WHERE at>now()-interval '24 hours' GROUP BY 1,2 ORDER BY times DESC LIMIT 50"],
  ['Security', 'Night-time actions (00-05, 7 days)', 'sec-night', 'l', "SELECT at,username,action,detail FROM audit_log WHERE at>now()-interval '7 days' AND EXTRACT(hour FROM at AT TIME ZONE 'Asia/Manila') BETWEEN 0 AND 4 ORDER BY id DESC LIMIT 50"],
  ['Security', 'Deletions (30 days)', 'sec-deletes', 'l', "SELECT at,username,action,detail FROM audit_log WHERE at>now()-interval '30 days' AND action ILIKE '%delete%' ORDER BY id DESC LIMIT 50"],
  ['Security', 'Restores and imports', 'sec-restores', 'l', "SELECT at,username,action,detail FROM audit_log WHERE action ILIKE '%restore%' OR action ILIKE '%import%' ORDER BY id DESC LIMIT 20"],
  ['Security', 'Password resets per user (30 days)', 'sec-resets', 'l', "SELECT u.username,COUNT(*)::int resets FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.created_at>now()-interval '30 days' GROUP BY 1 ORDER BY resets DESC LIMIT 30"],
  ['Security', 'Who reset the most passwords', 'sec-reset-by', 'l', "SELECT b.username,COUNT(*)::int resets FROM password_resets r JOIN users b ON b.id=r.by_id GROUP BY 1 ORDER BY resets DESC LIMIT 20"],
  ['Security', 'Sign-ups per day (14 days)', 'sec-signups', 'b', "SELECT to_char(d,'MM-DD') label,COUNT(u.id)::int value FROM generate_series(now()::date-13,now()::date,'1 day') d LEFT JOIN users u ON u.created_at::date=d::date GROUP BY d ORDER BY d"],
  ['Security', 'Sign-up bursts (5+ in an hour)', 'sec-signup-burst', 'l', "SELECT date_trunc('hour',created_at) hour_at,COUNT(*)::int accounts FROM users WHERE created_at>now()-interval '14 days' GROUP BY 1 HAVING COUNT(*)>=5 ORDER BY 1 DESC LIMIT 30"],
  ['Security', 'Shared sign-up address (3+)', 'sec-ip3', 'l', "SELECT signup_ip ip,COUNT(*)::int accounts FROM users WHERE signup_ip<>'' GROUP BY 1 HAVING COUNT(*)>=3 ORDER BY accounts DESC LIMIT 30"],
  ['Security', 'Unusually large orders (30 days)', 'sec-big-orders', 'l', `SELECT o.id,u.username,o.total::float total,o.status,o.created_at FROM orders o JOIN users u ON u.id=o.user_id WHERE ${D(30)} AND o.total>3*(SELECT COALESCE(AVG(total),0) FROM orders) ORDER BY o.total DESC LIMIT 30`],
  ['Security', 'Most cancellations (30 days)', 'sec-cancel-users', 'l', `SELECT u.username,COUNT(*)::int cancelled FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status='cancelled' AND ${D(30)} GROUP BY 1 ORDER BY cancelled DESC LIMIT 20`],
  ['Security', 'Order bursts (5+ in an hour)', 'sec-order-burst', 'l', `SELECT u.username,date_trunc('hour',o.created_at) hour_at,COUNT(*)::int orders FROM orders o JOIN users u ON u.id=o.user_id WHERE ${D(7)} GROUP BY 1,2 HAVING COUNT(*)>=5 ORDER BY orders DESC LIMIT 30`],
  ['Security', 'Zero-value orders', 'sec-zero-orders', 'l', `SELECT o.id,u.username,o.status,o.created_at FROM orders o JOIN users u ON u.id=o.user_id WHERE o.total=0 ORDER BY o.id DESC LIMIT 30`],
  ['Security', 'Staff with no activity (30 days)', 'sec-idle-staff', 'l', "SELECT u.id,u.username,u.role FROM users u WHERE u.role<>'customer' AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.user_id=u.id AND a.at>now()-interval '30 days') ORDER BY u.id"],
  ['Security', 'Blocked customers count', 'sec-blocks', 's', "SELECT COUNT(*)::int blocked,COUNT(*) FILTER (WHERE shop_wide)::int shop_wide FROM customer_blocks"],
  ['Security', 'Old accounts that never ordered (90 days+)', 'sec-ghosts', 's', "SELECT COUNT(*)::int accounts FROM users u WHERE u.role='customer' AND u.created_at<now()-interval '90 days' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id=u.id)"],
  // ---- Security, more
  ['Security', 'Sign-in activity (latest 50)', 'sec-logins', 'l', "SELECT at,username,action,detail FROM audit_log WHERE action ILIKE '%login%' OR action ILIKE '%sign%in%' ORDER BY id DESC LIMIT 50"],
  ['Security', 'Refusals and blocks (latest 50)', 'sec-denied', 'l', "SELECT at,username,action,detail FROM audit_log WHERE action ILIKE '%fail%' OR action ILIKE '%denied%' OR action ILIKE '%block%' OR action ILIKE '%forbid%' ORDER BY id DESC LIMIT 50"],
  ['Security', 'Password changes (latest 30)', 'sec-pw-changes', 'l', "SELECT at,username,action,detail FROM audit_log WHERE action ILIKE '%password%' ORDER BY id DESC LIMIT 30"],
  ['Security', 'Role changes (latest 30)', 'sec-role-changes', 'l', "SELECT at,username,action,detail FROM audit_log WHERE action ILIKE '%role%' OR action ILIKE '%promote%' OR action ILIKE '%demote%' ORDER BY id DESC LIMIT 30"],
  ['Security', 'Setting changes (latest 30)', 'sec-setting-changes', 'l', "SELECT at,username,action,detail FROM audit_log WHERE action ILIKE '%setting%' OR action ILIKE '%config%' ORDER BY id DESC LIMIT 30"],
  ['Security', 'Exports and backups (latest 30)', 'sec-exports', 'l', "SELECT at,username,action,detail FROM audit_log WHERE action ILIKE '%export%' OR action ILIKE '%backup%' ORDER BY id DESC LIMIT 30"],
  ['Security', 'Actions per person (7 days)', 'sec-by-user', 'b', "SELECT username label,COUNT(*)::int value FROM audit_log WHERE at>now()-interval '7 days' GROUP BY 1 ORDER BY value DESC LIMIT 12"],
  ['Security', 'Actions by hour (7 days)', 'sec-by-hour', 'b', "SELECT lpad(h::text,2,'0')||':00' label,COUNT(a.id)::int value FROM generate_series(0,23) h LEFT JOIN audit_log a ON EXTRACT(hour FROM a.at AT TIME ZONE 'Asia/Manila')=h AND a.at>now()-interval '7 days' GROUP BY h ORDER BY h"],
  ['Security', 'Orders placed 00-05 (14 days)', 'sec-night-orders', 'l', `SELECT o.id,u.username,o.total::float total,o.created_at FROM orders o JOIN users u ON u.id=o.user_id WHERE ${D(14)} AND EXTRACT(hour FROM o.created_at AT TIME ZONE 'Asia/Manila') BETWEEN 0 AND 4 ORDER BY o.id DESC LIMIT 30`],
  ['Security', 'Heavily discounted orders (over 30%)', 'sec-discounts', 'l', `SELECT o.id,u.username,o.total::float total,o.discount::float discount,o.created_at FROM orders o JOIN users u ON u.id=o.user_id WHERE ${OK} AND o.discount>0 AND o.discount/NULLIF(o.total+o.discount,0)>0.3 ORDER BY o.id DESC LIMIT 30`],
  ['Security', 'Usernames that differ only by case', 'sec-dup-names', 'l', "SELECT lower(username) name,COUNT(*)::int accounts FROM users GROUP BY 1 HAVING COUNT(*)>1 LIMIT 30"],
  ['Security', 'Sign-ups today', 'sec-signups-today', 's', "SELECT COUNT(*)::int today,COUNT(*) FILTER (WHERE created_at>now()-interval '1 hour')::int last_hour FROM users WHERE created_at>now()-interval '1 day'"],
  ['Security', 'Admin accounts count', 'sec-admin-count', 's', "SELECT COUNT(*)::int admins FROM users WHERE role='admin'"],
  ['Security', 'Customers blocked, newest first', 'sec-block-list', 'l', "SELECT u.username,b.shop_wide,b.reason,b.created_at FROM customer_blocks b JOIN users u ON u.id=b.user_id ORDER BY b.id DESC LIMIT 30"],
  // ---- Data health
  ['Data health', 'Database size', 'dh-size', 's', "SELECT pg_size_pretty(pg_database_size(current_database())) database_size,(SELECT COUNT(*)::int FROM pg_stat_activity WHERE datname=current_database()) connections"],
  ['Data health', 'Table sizes (MB)', 'dh-tables', 'b', "SELECT relname label,ROUND(pg_total_relation_size(relid)/1048576.0,2)::float value FROM pg_stat_user_tables ORDER BY value DESC LIMIT 15"],
  ['Data health', 'Row counts', 'dh-rows', 'l', "SELECT relname table_name,n_live_tup::int rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 30"],
  ['Data health', 'Heaviest product photos', 'dh-photos', 'l', "SELECT id,title,ROUND(octet_length(image_data)/1024.0)::int kb FROM products WHERE image_data IS NOT NULL ORDER BY octet_length(image_data) DESC LIMIT 20"],
  ['Data health', 'Photos over 500 KB', 'dh-big-photos', 'l', "SELECT id,title,ROUND(octet_length(image_data)/1024.0)::int kb FROM products WHERE octet_length(image_data)>512000 ORDER BY octet_length(image_data) DESC LIMIT 50"],
  ['Data health', 'Total photo storage', 'dh-photo-total', 's', "SELECT COUNT(image_data)::int photos,ROUND(COALESCE(SUM(octet_length(image_data)),0)/1048576.0,1)::float total_mb FROM products"],
  ['Data health', 'Products without a photo', 'dh-no-photo', 'l', "SELECT id,title FROM products WHERE image_data IS NULL ORDER BY id LIMIT 100"],
  ['Data health', 'Duplicate product names', 'dh-dup-titles', 'l', "SELECT lower(title) title,COUNT(*)::int copies FROM products GROUP BY 1 HAVING COUNT(*)>1 ORDER BY copies DESC LIMIT 30"],
  ['Data health', 'Negative stock', 'dh-neg-stock', 'l', "SELECT id,title,stock FROM products WHERE stock<0 ORDER BY stock LIMIT 50"],
  ['Data health', 'Products priced at zero', 'dh-zero-price', 'l', "SELECT id,title FROM products WHERE price=0 ORDER BY id LIMIT 50"],
  ['Data health', 'Products with no category', 'dh-no-cat', 'l', "SELECT id,title FROM products WHERE category IS NULL OR category='' ORDER BY id LIMIT 50"],
  ['Data health', 'Order lines whose product is gone', 'dh-orphans', 's', "SELECT COUNT(*)::int lines FROM order_items WHERE product_id IS NULL"],
  ['Data health', 'Orders with no items', 'dh-empty-orders', 'l', "SELECT o.id,o.status,o.total::float total,o.created_at FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id) ORDER BY o.id DESC LIMIT 30"],
  ['Data health', 'Activity log size', 'dh-audit', 's', "SELECT COUNT(*)::int rows,COUNT(*) FILTER (WHERE at<now()-interval '180 days')::int older_than_180_days FROM audit_log"],
  ['Data health', 'Database connections', 'dh-conns', 'l', "SELECT COALESCE(state,'other') state,COUNT(*)::int connections FROM pg_stat_activity WHERE datname=current_database() GROUP BY 1 ORDER BY 2 DESC"],
  ['Data health', 'Queries running over 5 seconds', 'dh-slow-now', 'l', "SELECT pid,ROUND(EXTRACT(epoch FROM now()-query_start))::int seconds,LEFT(query,80) query FROM pg_stat_activity WHERE state='active' AND now()-query_start>interval '5 seconds' AND pid<>pg_backend_pid() LIMIT 20"],
  ['Data health', 'Cache hit rate', 'dh-cache', 's', "SELECT ROUND(SUM(heap_blks_hit)*100.0/NULLIF(SUM(heap_blks_hit+heap_blks_read),0),1)::float hit_percent FROM pg_statio_user_tables"],
  ['Data health', 'Unused indexes', 'dh-idx', 'l', "SELECT relname table_name,indexrelname index_name,pg_size_pretty(pg_relation_size(indexrelid)) size FROM pg_stat_user_indexes WHERE idx_scan=0 ORDER BY pg_relation_size(indexrelid) DESC LIMIT 20"],
  ['Data health', 'Backup age', 'dh-backup-age', 's', "SELECT COUNT(*)::int saved,ROUND(EXTRACT(epoch FROM now()-MAX(created_at))/3600)::int hours_since_last,ROUND(COALESCE(SUM(size),0)/1048576.0,1)::float total_mb FROM backups"],
  ['Data health', 'Database version', 'dh-version', 's', "SELECT split_part(version(),' on ',1) version"],
  // ---- Orders+
  ['Orders+', 'Orders by status', 'ord-status', 'b', 'SELECT status label,COUNT(*)::int value FROM orders GROUP BY status ORDER BY value DESC'],
  ['Orders+', 'Oldest pending orders', 'ord-oldest-pending', 'l', "SELECT o.id,u.username,o.total::float total,o.created_at FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status='pending' ORDER BY o.id LIMIT 30"],
  ['Orders+', 'Pending for over a day', 'ord-stale', 's', "SELECT COUNT(*)::int orders FROM orders WHERE status='pending' AND created_at<now()-interval '1 day'"],
  ['Orders+', 'Average order (30 days)', 'ord-aov', 's', `SELECT ROUND(COALESCE(AVG(o.total),0),2)::float average,COUNT(*)::int orders FROM orders o WHERE ${OK} AND ${D(30)}`],
  ['Orders+', 'Cancel rate (30 days)', 'ord-cancel-rate', 's', `SELECT ROUND(COUNT(*) FILTER (WHERE o.status='cancelled')*100.0/NULLIF(COUNT(*),0),1)::float cancel_percent,COUNT(*)::int orders FROM orders o WHERE ${D(30)}`],
  ['Orders+', 'Revenue per day (30 days)', 'ord-rev-30', 'b', `SELECT to_char(d,'MM-DD') label,COALESCE(SUM(o.total),0)::float value FROM generate_series(${MNL}-29,${MNL},'1 day') d LEFT JOIN orders o ON ${OD}=d::date AND ${OK} GROUP BY d ORDER BY d`],
  ['Orders+', 'Orders by weekday (30 days)', 'ord-weekday', 'b', `SELECT to_char(o.created_at AT TIME ZONE 'Asia/Manila','Dy') label,COUNT(*)::int value FROM orders o WHERE ${OK} AND ${D(30)} GROUP BY 1,EXTRACT(isodow FROM o.created_at AT TIME ZONE 'Asia/Manila') ORDER BY EXTRACT(isodow FROM o.created_at AT TIME ZONE 'Asia/Manila')`],
  ['Orders+', 'Peak hours (30 days)', 'ord-hours', 'b', `SELECT lpad(h::text,2,'0')||':00' label,COUNT(o.id)::int value FROM generate_series(0,23) h LEFT JOIN orders o ON EXTRACT(hour FROM o.created_at AT TIME ZONE 'Asia/Manila')=h AND ${OK} AND ${D(30)} GROUP BY h ORDER BY h`],
  ['Orders+', 'Top products (30 days)', 'ord-top-30', 'b', `SELECT i.title label,SUM(i.quantity)::int value FROM order_items i JOIN orders o ON o.id=i.order_id AND ${OK} AND ${D(30)} GROUP BY i.title ORDER BY value DESC LIMIT 10`],
  ['Orders+', 'Items per order (30 days)', 'ord-items-avg', 's', `SELECT ROUND(AVG(n),2)::float items_per_order FROM (SELECT SUM(i.quantity) n FROM order_items i JOIN orders o ON o.id=i.order_id AND ${OK} AND ${D(30)} GROUP BY o.id) x`],
  ['Orders+', 'Biggest orders today', 'ord-biggest-today', 'l', `SELECT o.id,u.username,o.total::float total,o.status FROM orders o JOIN users u ON u.id=o.user_id WHERE ${OD}=${MNL} ORDER BY o.total DESC LIMIT 10`],
  ['Orders+', 'Repeat customers (30 days)', 'ord-repeat', 's', `SELECT COUNT(*) FILTER (WHERE n>1)::int repeat_customers,COUNT(*)::int customers FROM (SELECT user_id,COUNT(*) n FROM orders o WHERE ${OK} AND ${D(30)} GROUP BY user_id) x`],
  ['Orders+', 'Cancelled orders (latest 30)', 'ord-cancelled', 'l', "SELECT o.id,u.username,o.total::float total,o.created_at FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status='cancelled' ORDER BY o.id DESC LIMIT 30"],
  // ---- Catalog+
  ['Catalog+', 'Products per category', 'cat-by-cat', 'b', "SELECT COALESCE(NULLIF(category,''),'none') label,COUNT(*)::int value FROM products GROUP BY 1 ORDER BY value DESC"],
  ['Catalog+', 'Newest products', 'cat-new', 'l', "SELECT id,title,price::float price,created_at FROM products ORDER BY id DESC LIMIT 20"],
  ['Catalog+', 'Most expensive products', 'cat-top-price', 'l', "SELECT id,title,price::float price FROM products ORDER BY price DESC LIMIT 15"],
  ['Catalog+', 'Cheapest products', 'cat-low-price', 'l', "SELECT id,title,price::float price FROM products WHERE price>0 ORDER BY price LIMIT 15"],
  ['Catalog+', 'Sold-out products', 'cat-soldout', 'l', "SELECT id,title FROM products WHERE is_sold_out ORDER BY id LIMIT 100"],
  ['Catalog+', 'Never ordered', 'cat-never', 'l', "SELECT p.id,p.title,p.created_at FROM products p WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.product_id=p.id) ORDER BY p.id LIMIT 50"],
  ['Catalog+', 'Stock value', 'cat-stock-value', 's', "SELECT COALESCE(SUM(price*stock),0)::float retail_value,COUNT(*) FILTER (WHERE stock IS NOT NULL)::int tracked_products FROM products WHERE stock>0"],
  ['Catalog+', 'Products with no owner', 'cat-no-owner', 'l', "SELECT id,title FROM products WHERE owner_id IS NULL ORDER BY id LIMIT 50"],
  ['Catalog+', 'Most hearted products', 'cat-hearts', 'b', "SELECT p.title label,COUNT(*)::int value FROM favorites f JOIN products p ON p.id=f.product_id GROUP BY p.title ORDER BY value DESC LIMIT 10"],
  ['Catalog+', 'Profit by product (30 days)', 'cat-profit', 'b', `SELECT i.title label,ROUND(SUM(i.quantity*(i.unit_price-p.cost)))::float value FROM order_items i JOIN orders o ON o.id=i.order_id AND ${OK} AND ${D(30)} JOIN products p ON p.id=i.product_id WHERE p.cost IS NOT NULL GROUP BY i.title ORDER BY value DESC LIMIT 10`],
  // ---- People+
  ['People+', 'Customers, total', 'ppl-count', 's', "SELECT COUNT(*) FILTER (WHERE role='customer')::int customers,COUNT(*) FILTER (WHERE created_at>now()-interval '7 days')::int joined_7d FROM users"],
  ['People+', 'Best customers, all time', 'ppl-top-all', 'l', `SELECT u.username,COUNT(*)::int orders,ROUND(SUM(o.total))::float spent FROM orders o JOIN users u ON u.id=o.user_id WHERE ${OK} GROUP BY 1 ORDER BY spent DESC LIMIT 20`],
  ['People+', 'Gone quiet (no order in 30 days)', 'ppl-quiet', 'l', `SELECT u.username,MAX(o.created_at) last_order_at,COUNT(*)::int orders FROM orders o JOIN users u ON u.id=o.user_id WHERE ${OK} GROUP BY 1 HAVING MAX(o.created_at)<now()-interval '30 days' ORDER BY MAX(o.created_at) DESC LIMIT 30`],
  ['People+', 'Registered, never ordered', 'ppl-never', 'l', "SELECT u.id,u.username,u.created_at FROM users u WHERE u.role='customer' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id=u.id) ORDER BY u.id DESC LIMIT 30"],
  ['People+', 'Seller sales (30 days)', 'ppl-seller-30', 'b', `SELECT COALESCE(s.username,'shop') label,ROUND(SUM(i.quantity*i.unit_price))::float value FROM order_items i JOIN orders o ON o.id=i.order_id AND ${OK} AND ${D(30)} LEFT JOIN products p ON p.id=i.product_id LEFT JOIN users s ON s.id=p.owner_id GROUP BY 1 ORDER BY value DESC LIMIT 10`],
  ['People+', 'Customers with the most hearts', 'ppl-hearts', 'l', "SELECT u.username,COUNT(*)::int hearts FROM favorites f JOIN users u ON u.id=f.user_id GROUP BY 1 ORDER BY hearts DESC LIMIT 20"],
  ['People+', 'Customer notes (latest 20)', 'ppl-notes', 'l', "SELECT u.username,LEFT(n.note,80) note,n.updated_at FROM customer_notes n JOIN users u ON u.id=n.user_id WHERE n.note<>'' ORDER BY n.updated_at DESC LIMIT 20"],
  // ---- Insights+
  ['Insights+', 'Revenue by month (12)', 'ins-months', 'b', `SELECT to_char(date_trunc('month',o.created_at AT TIME ZONE 'Asia/Manila'),'YY-MM') label,ROUND(SUM(o.total))::float value FROM orders o WHERE ${OK} AND o.created_at>now()-interval '12 months' GROUP BY 1 ORDER BY 1`],
  ['Insights+', 'Profit (30 days, products with a cost)', 'ins-profit', 's', `SELECT ROUND(COALESCE(SUM(i.quantity*(i.unit_price-p.cost)),0))::float profit,ROUND(COALESCE(SUM(i.quantity*i.unit_price),0))::float revenue FROM order_items i JOIN orders o ON o.id=i.order_id AND ${OK} AND ${D(30)} JOIN products p ON p.id=i.product_id WHERE p.cost IS NOT NULL`],
  ['Insights+', 'Growth, 30 days vs previous 30', 'ins-growth', 's', `SELECT COALESCE(SUM(o.total) FILTER (WHERE ${D(30)}),0)::float last_30,COALESCE(SUM(o.total) FILTER (WHERE o.created_at<=now()-interval '30 days'),0)::float previous_30 FROM orders o WHERE ${OK} AND o.created_at>now()-interval '60 days'`],
  ['Insights+', 'Custom requests by status', 'ins-requests', 'b', 'SELECT status label,COUNT(*)::int value FROM custom_requests GROUP BY status ORDER BY value DESC'],
  ['Insights+', 'Average quoted price (custom)', 'ins-quote', 's', "SELECT ROUND(COALESCE(AVG(quoted_price),0),2)::float average_quote,COUNT(quoted_price)::int quotes FROM custom_requests"],
  ['Insights+', 'Promo codes used most', 'ins-promos', 'b', "SELECT code label,used_count value FROM promo_codes ORDER BY used_count DESC LIMIT 10"],
  ['Insights+', 'Today so far', 'ins-today', 's', `SELECT COUNT(*)::int orders,COALESCE(SUM(o.total),0)::float revenue FROM orders o WHERE ${OD}=${MNL} AND ${OK}`],
  ['Insights+', 'Items sold per category (30 days)', 'ins-cat-items', 'b', `SELECT COALESCE(NULLIF(p.category,''),'none') label,SUM(i.quantity)::int value FROM order_items i JOIN orders o ON o.id=i.order_id AND ${OK} AND ${D(30)} JOIN products p ON p.id=i.product_id GROUP BY 1 ORDER BY value DESC`],
  ['Insights+', 'Messages sent (last 24 hours)', 'msg-today', 's', "SELECT COUNT(*)::int messages,COUNT(DISTINCT sender_id)::int senders FROM dm_messages WHERE created_at>now()-interval '24 hours'"],
  ['Insights+', 'Messages per day (14 days)', 'msg-days', 'b', "SELECT to_char(d,'MM-DD') label,COUNT(m.id)::int value FROM generate_series(now()::date-13,now()::date,interval '1 day') d LEFT JOIN dm_messages m ON m.created_at::date=d::date GROUP BY d ORDER BY d"],
  ['Insights+', 'Top message senders (7 days)', 'msg-top', 'l', "SELECT u.username,u.role,COUNT(*)::int sent FROM dm_messages m JOIN users u ON u.id=m.sender_id WHERE m.created_at>now()-interval '7 days' AND NOT m.broadcast GROUP BY 1,2 ORDER BY sent DESC LIMIT 20"],
  ['Insights+', 'Message reports (open first)', 'msg-reports', 'l', "SELECT r.id,r.status,a.username reporter,b.username reported,LEFT(r.excerpt,80) excerpt,r.reason,r.created_at FROM dm_reports r LEFT JOIN users a ON a.id=r.reporter_id LEFT JOIN users b ON b.id=r.reported_id ORDER BY (r.status='open') DESC,r.id DESC LIMIT 50"],
  ['System+', 'Messaging diagnostics', 'msg-diag', 's', "SELECT (SELECT COUNT(*)::int FROM dm_messages) messages,(SELECT COUNT(*)::int FROM dm_messages WHERE read_at IS NULL) unread_backlog,(SELECT COUNT(*)::int FROM dm_scheduled) scheduled_waiting,(SELECT COUNT(*)::int FROM dm_reports WHERE status='open') open_reports,(SELECT COUNT(*)::int FROM dm_blocks) blocks,(SELECT COUNT(*)::int FROM dm_prefs WHERE auto_reply_on) auto_replies_on,(SELECT COUNT(*)::int FROM dm_messages WHERE kind='image') pictures"],
];
// Safe actions (POST, admin only, each logged). They only tidy up; none touches orders, products or accounts.
const ACTIONS = [
  ['System+', 'Refresh database statistics (ANALYZE)', 'act-analyze', async (q) => { await q('ANALYZE'); return 'Statistics refreshed.'; }],
  ['System+', 'Delete activity log older than 180 days', 'act-trim-audit', async (q) => `Removed ${(await q("DELETE FROM audit_log WHERE at<now()-interval '180 days'")).rowCount} rows.`],
  ['System+', 'Delete password-reset records older than 90 days', 'act-trim-resets', async (q) => `Removed ${(await q("DELETE FROM password_resets WHERE created_at<now()-interval '90 days'")).rowCount} rows.`],
];

module.exports = function mount(app, { pool, auth, admin, wrap }) {
  const A = [auth, admin], q = (s, p) => pool.query(s, p);
  app.get('/api/plus/pack', ...A, (req, res) => res.json({
    tools: PACK.map(([g, t, p, k]) => ({ g, t, u: '/api/plus/p/' + p, k })).concat(ACTIONS.map(([g, t, p]) => ({ g, t, u: '/api/plus/p/' + p, k: 'a' })),
      [{ g: 'Security', t: 'DDoS guard: status', u: '/api/plus/p/ddos-status', k: 's' }, { g: 'Security', t: 'DDoS guard: banned addresses', u: '/api/plus/p/ddos-bans', k: 'l' }, { g: 'Security', t: 'DDoS guard: lift all bans', u: '/api/plus/p/act-ddos-unban', k: 'a' }, { g: 'Security', t: 'DDoS guard: force attack mode on/off', u: '/api/plus/p/act-ddos-toggle', k: 'a' },
        { g: 'Security', t: 'Data guard: status', u: '/api/plus/p/data-protect', k: 's' }, { g: 'Security', t: 'Data guard: row counts vs 24h high', u: '/api/plus/p/data-rows', k: 'l' }, { g: 'Security', t: 'Data guard: reset baseline', u: '/api/plus/p/act-data-reset-baseline', k: 'a' },
        { g: 'System+', t: 'Server memory now', u: '/api/plus/p/mem-now', k: 's' }, { g: 'System+', t: 'Clear the picture cache (frees memory)', u: '/api/plus/p/act-clear-pictures', k: 'a' }]),
  }));
  for (const [, , path, , sql] of PACK) app.get('/api/plus/p/' + path, ...A, wrap(async (req, res) => { res.set('Cache-Control', 'no-store'); res.json((await q(sql)).rows); }));
  for (const [, title, path, fn] of ACTIONS) app.post('/api/plus/p/' + path, ...A, wrap(async (req, res) => {
    const message = await fn(q);
    q('INSERT INTO audit_log (user_id, username, role, action, detail) VALUES ($1,$2,$3,$4,$5)', [req.user.id, req.user.username, req.user.role, 'admin-pack', title]).catch(() => {});
    res.json({ message });
  }));
};
