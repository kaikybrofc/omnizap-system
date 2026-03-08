import { executeQuery, TABLES } from '../../../database/index.js';
import logger from '../../../utils/logger/loggerModule.js';

import { createUserPasswordAuthService } from './userPasswordAuthService.js';

const userPasswordAuthService = createUserPasswordAuthService({
  executeQuery,
  tables: TABLES,
  logger,
});

export default userPasswordAuthService;
export { createUserPasswordAuthService };
export { DEFAULT_USER_PASSWORD_POLICY, hashUserPassword, resolveUserPasswordPolicy, validateUserPassword, verifyUserPasswordHash } from './userPasswordCrypto.js';
