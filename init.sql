truncate table approval_files;
truncate table approval_items;
truncate table approval_requests;
truncate table expense_details;
truncate table approval_history;
truncate table user_signatures;

ALTER TABLE reportdb.approval_files AUTO_INCREMENT=1;
ALTER TABLE reportdb.approval_items AUTO_INCREMENT=1;
ALTER TABLE reportdb.approval_requests AUTO_INCREMENT=1;
ALTER TABLE reportdb.expense_details AUTO_INCREMENT=1;
ALTER TABLE reportdb.approval_history AUTO_INCREMENT=1;
ALTER TABLE reportdb.user_signatures AUTO_INCREMENT=1;



