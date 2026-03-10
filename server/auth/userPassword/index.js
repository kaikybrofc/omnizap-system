import { executeQuery, TABLES } from '../../../database/index.js';
import logger from '@kaikybrofc/logger-module';

import { createUserPasswordAuthService } from './userPasswordAuthService.js';

const userPasswordAuthService = createUserPasswordAuthService({
  executeQuery,
  tables: TABLES,
  logger,
});

export default userPasswordAuthService;
export { createUserPasswordAuthService };
export { DEFAULT_USER_PASSWORD_POLICY, hashUserPassword, resolveUserPasswordPolicy, validateUserPassword, verifyUserPasswordHash } from './userPasswordCrypto.js';
