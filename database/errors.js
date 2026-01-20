export class DatabaseError extends Error {
  constructor(message, originalError, sql, params) {
    super(message);
    this.name = 'DatabaseError';
    this.originalError = originalError;
    this.sql = sql;
    this.params = params;
    this.errorCode = originalError?.code;
    this.errorNumber = originalError?.errno;
    this.sqlState = originalError?.sqlState;
  }
}