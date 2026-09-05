CREATE TRIGGER audit_logs_immutable_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_LOG_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_LOG_IMMUTABLE');
END;
